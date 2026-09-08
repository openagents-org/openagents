/**
 * Base adapter for OpenAgents workspace.
 *
 * Extracts the common connectivity logic shared by all adapters:
 * - Event cursor management and skip-existing-events on startup
 * - Heartbeat loop (30s)
 * - Adaptive poll loop with deduplication
 * - Control event polling (mode changes, stop)
 * - Per-channel task dispatch with queuing
 * - Auto-titling of new channels
 * - Graceful shutdown with disconnect
 *
 * Subclasses must implement _handleMessage(msg).
 *
 * Direct port of Python: sdk/src/openagents/adapters/base.py
 */

'use strict';

const { WorkspaceClient, SessionRevokedError } = require('../workspace-client');
const {
  generateSessionTitle,
  redactSensitiveHeaders,
  SESSION_DEFAULT_RE,
} = require('./utils');
const { defaultAgentWorkdir } = require('../paths');
const {
  decisionLogTitle,
  glossaryTitle,
  WORKSPACE_GLOSSARY_TITLE,
  pickEntryByTitle,
} = require('./decision-log');
const {
  REASON,
  classifyJoinError,
  classifyHeartbeatError,
  httpStatusOf,
} = require('./health-status');

const DEFAULT_ENDPOINT = 'https://workspace-endpoint.openagents.org';

// Heartbeat runs every 30s. A SINGLE failure is usually a transient blip (brief
// network hiccup, server redeploy) that the next tick recovers from — surfacing
// it as a hard 'error' would make the agent flap red for no real reason. Only
// after this many CONSECUTIVE failures (~60s+ of real downtime) do we report
// heartbeat_failed up to the daemon. A success resets the streak immediately.
const HEARTBEAT_ERROR_THRESHOLD = 2;

class BaseAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.workspaceId
   * @param {string} opts.channelName - default/initial channel
   * @param {string} opts.token
   * @param {string} opts.agentName
   * @param {string} [opts.endpoint]
   */
  constructor({ workspaceId, channelName, token, agentName, endpoint, agentEnv, agentType, workingDir, onStatus }) {
    this.workspaceId = workspaceId;
    this.channelName = channelName;
    this.token = token;
    this.agentName = agentName;
    this.endpoint = endpoint || DEFAULT_ENDPOINT;
    this.agentEnv = agentEnv || process.env;
    this.agentType = agentType;
    this.workingDir = workingDir || undefined;
    // Optional callback the daemon supplies to surface live runtime/connectivity
    // status (reason + redacted message) into daemon.status.json so the Agents
    // list / TUI can show the REAL failure instead of a swallowed log line. A
    // null reason means "healthy again" (clears any prior error).
    this._onStatus = typeof onStatus === 'function' ? onStatus : null;
    this._lastReportedStatusKey = null;
    // Consecutive heartbeat failures — a transient single blip must not flip the
    // agent to a hard error (see HEARTBEAT_ERROR_THRESHOLD).
    this._heartbeatFailStreak = 0;
    // Structured terminal exit reason ({ reason, message }) read by the daemon
    // after run() returns, to distinguish a clean stop from a real failure.
    this._exitInfo = null;
    // Set when the user explicitly stops this adapter (vs an error/revoke), so a
    // clean stop is never mislabeled as an error.
    this._stopRequested = false;
    this.client = new WorkspaceClient(this.endpoint);
    this._lastEventId = null;
    this._running = false;
    this._sessionId = null;  // issued by server on /v1/join; used to prove liveness
    this._processedIds = new Set();
    this._titledSessions = new Set();
    this._mode = 'execute';
    // Workspace-selected model id (WorkspaceMember.model). Synced from
    // discover at startup and via the `model.set` control event; null means
    // the agent CLI runs with its own default.
    this.workspaceModel = null;
    this._lastControlId = null;
    this._controlWake = null;
    // Per-channel task tracking for parallel execution
    this._channelBusy = new Set();
    this._channelQueues = {};
    // Cached workspace.browser_enabled. Populated lazily on first read so we
    // don't pay an HTTP roundtrip per message — adapters that toggle the
    // workspace flag must reconnect/restart to pick up the change (matches
    // the Python adapter behavior in workspace_prompt.py).
    this._browserEnabledCache = null;
    // ── Knowledge pinning (decision log + glossary) ──
    // Entry-id caches make the steady state a single GET per pinned entry;
    // reads happen on EVERY message, so they get a hard short deadline
    // instead of the client's default 15s — a workspace hiccup must cost the
    // turn a couple of seconds, not half a minute.
    this._decisionEntryIds = {}; // channel → knowledge entry id of its decision log
    this._glossaryEntryIds = {}; // channel → knowledge entry id of its glossary
    this._DECISION_FETCH_TIMEOUT_MS = 2000;
    this._warnedKnowledgeDisabled = false;
    this._pinnedStatusWarned = new Set(); // channels already told pinning is inactive
    // Subclasses whose sync prompt builders consume pinnedPromptOpts() set
    // this true; the channel worker then refreshes _pinnedContext before
    // every _handleMessage call. Adapters with their own pinning flow
    // (Claude) fetch directly instead and leave it false.
    this._usesPinnedContext = false;
    this._pinnedContext = {}; // channel → { decisions, glossary }
    // Wall-clock timestamp of adapter init, used by the `status` control
    // action to report uptime back to the channel. Reset on reinstantiation
    // (e.g. after a `restart` IPC bounce) so uptime tracks "time since last
    // restart" rather than the long-running daemon's process uptime.
    this._startedAt = Date.now();
    this._log = (msg) => {
      const ts = new Date().toISOString();
      console.log(`${ts} INFO adapter [${this.agentName}]: ${msg}`);
    };
  }

  // ------------------------------------------------------------------
  // Runtime status reporting (daemon surfaces this in daemon.status.json)
  // ------------------------------------------------------------------

  /**
   * Surface a live status transition to the daemon. `reason` null/'' means the
   * agent is healthy again (clears any prior error). Deduped so a repeated
   * failure (e.g. heartbeat every 30s on a down workspace) writes the status
   * file once, not on every tick. Never throws — status is best-effort.
   */
  _reportStatus(reason, message) {
    const key = `${reason || ''}|${message || ''}`;
    if (key === this._lastReportedStatusKey) return;
    this._lastReportedStatusKey = key;
    if (!this._onStatus) return;
    try {
      this._onStatus({ reason: reason || null, message: message || null });
    } catch { /* status is best-effort */ }
  }

  /** Record the FIRST terminal failure reason; later teardown noise can't mask it. */
  _setExitInfo(reason, message) {
    if (!this._exitInfo) this._exitInfo = { reason, message };
  }

  /** Read by the daemon after run() returns. null = clean exit. */
  getExitInfo() {
    return this._exitInfo;
  }

  /** True when stop() was called explicitly (a clean user stop, not a failure). */
  wasStopRequested() {
    return this._stopRequested === true;
  }

  /**
   * Preflight gate, run by the daemon BEFORE join. Default: always runnable.
   * Subclasses whose agent needs a resolvable CLI binary override this to return
   * { ok:false, reason:'runtime_missing', message } so the daemon surfaces a
   * precise reason and skips the workspace join (no pointless join loop).
   */
  preflight() {
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  /**
   * Announce this agent to the workspace (/v1/join). Returns true on success.
   * On failure surfaces the REAL reason (e.g. "Workspace join failed: HTTP 401")
   * to the daemon status instead of only logging it — non-fatal, the poll/
   * heartbeat loops keep retrying and a later success clears it. Extracted from
   * run() so the failure-reporting can be unit-tested without the poll loop.
   */
  async _joinWorkspace() {
    try {
      const joinResult = await this.client.joinNetwork(this.agentName, this.token, {
        network: this.workspaceId,
        agentType: this.agentType || 'agent',
        serverHost: require('os').hostname(),
        workingDir: this.workingDir || defaultAgentWorkdir(this.agentName),
      });
      this._sessionId = (joinResult && joinResult.session_id) || null;
      this._log(`Joined workspace ${this.workspaceId}${this._sessionId ? ` (session ${this._sessionId.slice(0, 8)})` : ''}`);
      this._reportStatus(null); // joined OK → clear any prior error
      return true;
    } catch (e) {
      const { reason, message } = classifyJoinError(e);
      this._log(`${message} (status: ${e && e.statusCode != null ? e.statusCode : 'n/a'})`);
      this._reportStatus(reason, message);
      return false;
    }
  }

  async run() {
    this._running = true;

    // Announce agent to workspace
    await this._joinWorkspace();

    // Sync workspace-managed skills into disabledModules
    try {
      const agents = await Promise.race([
        this.client.getAgents(this.workspaceId, this.token),
        new Promise((_, reject) => setTimeout(() => reject(new Error('skill sync timed out (10s)')), 10000)),
      ]);
      const self = agents.find((a) => a.agentName === this.agentName);
      if (self && self.enabledSkills) {
        const { skillsToDisabledModules } = require('../skill-catalog');
        this.disabledModules = skillsToDisabledModules(self.enabledSkills);
        this._log(`Synced skills from workspace: disabled=[${[...this.disabledModules].join(',')}]`);
      }
      if (self && self.model) {
        this.workspaceModel = self.model;
        this._log(`Synced model from workspace: ${this.workspaceModel}`);
      }
    } catch (e) {
      this._log(`Warning: skill sync failed (non-fatal): ${e.message}`);
    }

    // Fast-path operations (control-event cursor + heartbeat + control poll)
    // run BEFORE the message-cursor advance. Even though _skipExistingEvents
    // is fast on a healthy backend, we don't want slash commands gated on
    // its success — keeping these paths independent makes /restart and
    // /status responsive immediately after join.
    await this._skipExistingControlEvents();
    const heartbeatInterval = setInterval(() => this._heartbeat(), 30000);
    const controlPoller = this._controlPollerLoop();

    try {
      // Send initial heartbeat
      try { await this._heartbeat(); } catch (e) {
        this._log(`Heartbeat failed (non-fatal): ${e.message}`);
      }
      // Slow path: only the message-poll loop waits for this.
      await this._skipExistingEvents();
      this._log('Starting poll loop...');
      await this._pollLoop();
    } finally {
      this._running = false;
      this._wakeControlPoller();
      clearInterval(heartbeatInterval);
      try { await controlPoller; } catch {}
      try {
        await this.client.disconnect(this.workspaceId, this.agentName, this.token);
      } catch {}
    }
  }

  stop() {
    this._stopRequested = true;
    this._running = false;
  }

  // ------------------------------------------------------------------
  // Event cursor / skip existing
  // ------------------------------------------------------------------

  async _skipExistingEvents() {
    // Jump straight to the head with one server call. Pagination from the
    // start was slow and brittle: on a busy workspace it could take many
    // minutes to chew through historical events 200 at a time, leaving the
    // agent silently behind, and a transient mid-paginate empty response
    // (e.g. shared-cache race) would strand the cursor at a non-head id.
    const head = await this.client.getHeadEventId(this.workspaceId, this.token);
    if (head) {
      this._lastEventId = head;
      this._log(`Skipped existing events, cursor at ${head}`);
    }
  }

  // ------------------------------------------------------------------
  // Heartbeat
  // ------------------------------------------------------------------

  async _heartbeat() {
    try {
      await this.client.heartbeat(this.workspaceId, this.agentName, this.token, this._sessionId);
      this._heartbeatFailStreak = 0;
      this._reportStatus(null); // alive → clear any prior connectivity error
    } catch (e) {
      if (e instanceof SessionRevokedError) {
        this._log(`SESSION REVOKED: another client joined as '${this.agentName}'. Stopping adapter.`);
        // Terminal (not a user stop): record so the daemon can show why it ended.
        this._setExitInfo(REASON.SESSION_REVOKED, 'Workspace session revoked — another client joined with the same agent name');
        this._reportStatus(REASON.SESSION_REVOKED, 'Workspace session revoked');
        this._running = false;
        return;
      }
      // Only surface a hard error after repeated consecutive failures, so a
      // single transient blip (or an expected brief reconnect) isn't mislabeled.
      this._heartbeatFailStreak++;
      const { reason, message } = classifyHeartbeatError(e);
      this._log(`${message} (consecutive failures: ${this._heartbeatFailStreak})`);
      if (this._heartbeatFailStreak >= HEARTBEAT_ERROR_THRESHOLD) {
        this._reportStatus(reason, message);
      }
    }
  }

  // ------------------------------------------------------------------
  // Control polling
  // ------------------------------------------------------------------

  /**
   * Advance `_lastControlId` past any pending control events for this agent
   * so we don't re-process them after a respawn. Without this, /restart
   * triggers a daemon bounce, the new adapter starts with _lastControlId=null,
   * polls and re-finds the same /restart event, bounces again — restart loop.
   */
  async _skipExistingControlEvents() {
    try {
      const events = await this.client.pollControl(
        this.workspaceId, this.agentName, this.token,
        { after: null }
      );
      if (events.length > 0) {
        // pollControl returns ascending-by-timestamp; take the latest.
        this._lastControlId = events[events.length - 1].id;
        this._log(`Skipped ${events.length} existing control event(s), cursor at ${this._lastControlId}`);
      }
    } catch {}
  }

  async _pollControl() {
    try {
      const events = await this.client.pollControl(
        this.workspaceId, this.agentName, this.token,
        { after: this._lastControlId }
      );
      for (const ev of events) {
        if (ev.id) this._lastControlId = ev.id;
        const payload = ev.payload || {};
        const action = payload.action;
        if (action === 'set_mode') {
          const newMode = payload.mode || 'execute';
          if ((newMode === 'execute' || newMode === 'plan') && newMode !== this._mode) {
            const oldMode = this._mode;
            this._mode = newMode;
            this._log(`Mode changed: ${oldMode} -> ${newMode}`);
          }
        } else {
          await this._onControlAction(action, payload);
        }
      }
    } catch {}
  }

  /**
   * Handle adapter-specific control actions. Override in subclasses to add
   * per-adapter actions (`stop`, `restart`, …); always call
   * `await super._onControlAction(action, payload)` from the override for
   * actions you don't recognize, so shared actions like `status` keep
   * working uniformly across adapter types.
   */
  async _onControlAction(action, payload) {
    if (action === 'status') {
      await this._postStatusReport(payload);
    } else if (action === 'routines') {
      await this._postRoutinesReport(payload);
    } else if (action === 'skill.install') {
      await this._handleSkillInstall(payload);
    } else if (action === 'skill.uninstall') {
      await this._handleSkillUninstall(payload);
    } else if (action === 'model.set') {
      // Adapters read workspaceModel when (re)spawning their CLI; ones with
      // a staleness check (claude.js) respawn on the next message.
      this.workspaceModel = (payload && payload.model) || null;
      this._log(`Workspace model set to ${this.workspaceModel || '(default)'}`);
    }
  }

  /**
   * Install a Skill Hub catalog skill into this agent's local skills
   * directory, then report the result back to the workspace so the UI can
   * show installing → installed / failed. Errors are logged loudly and
   * surfaced as a `failed` status — never swallowed.
   *
   * payload: { action: "skill.install", skill: { id, name, source_repo, source_path } }
   */
  async _handleSkillInstall(payload) {
    const installer = require('../skill-installer');
    const skill = (payload && payload.skill) || null;
    const skillId = skill && (skill.id || skill.skill_id);
    if (!skillId) {
      this._log('skill.install: missing skill metadata in payload — ignoring');
      return;
    }
    this._log(`skill.install: starting install of "${skillId}" (type=${this.agentType}, dir=${this.workingDir || defaultAgentWorkdir(this.agentName)})`);

    // Best-effort "installing" ping so the UI flips immediately even if the
    // initial DB write from the request hasn't propagated to this client.
    try {
      await this.client.reportSkillStatus(this.workspaceId, this.agentName, this.token, {
        skillId, state: 'installing',
      });
    } catch (e) {
      this._log(`skill.install: could not report 'installing' (non-fatal): ${e && e.message ? e.message : e}`);
    }

    try {
      // Custom (uploaded) skills carry source_type=workspace_file + a file_id.
      // Download the package bytes here (async), then hand them to the sync
      // installer. Catalog skills keep their existing fetch-by-source path.
      const sourceType = skill && (skill.source_type || skill.sourceType);
      let result;
      if (sourceType === 'workspace_file') {
        const fileId = skill.file_id || skill.fileId;
        if (!fileId) throw new Error('workspace_file skill is missing file_id');
        this._log(`skill.install: downloading uploaded package (file_id=${fileId})`);
        const buffer = await this.client.readFile(this.workspaceId, this.token, fileId);
        if (!buffer || buffer.length === 0) throw new Error('uploaded skill file is empty');
        result = installer.installUploadedSkill({
          skill, buffer,
          agentType: this.agentType,
          workingDir: this.workingDir,
          log: (m) => this._log(`skill.install: ${m}`),
        });
      } else {
        result = installer.installSkill({
          skill,
          agentType: this.agentType,
          workingDir: this.workingDir,
          log: (m) => this._log(`skill.install: ${m}`),
        });
      }
      try {
        await this.client.reportSkillStatus(this.workspaceId, this.agentName, this.token, {
          skillId, state: 'installed', path: result.path, partial: result.partial === true,
        });
      } catch (e) {
        this._log(`skill.install: installed on disk but failed to report 'installed': ${e && e.message ? e.message : e}`);
      }
      this._log(`skill.install: SUCCESS "${skillId}" → ${result.path}${result.partial ? ' (partial)' : ''}`);
      await this._onSkillsChanged();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      this._log(`skill.install: FAILED "${skillId}": ${msg}`);
      try {
        await this.client.reportSkillStatus(this.workspaceId, this.agentName, this.token, {
          skillId, state: 'failed', error: msg,
        });
      } catch (e2) {
        this._log(`skill.install: also failed to report 'failed': ${e2 && e2.message ? e2.message : e2}`);
      }
    }
  }

  /**
   * Remove a previously-installed skill from disk and report `uninstalled`.
   */
  async _handleSkillUninstall(payload) {
    const installer = require('../skill-installer');
    const skill = (payload && payload.skill) || null;
    const skillId = skill && (skill.id || skill.skill_id);
    if (!skillId) {
      this._log('skill.uninstall: missing skill metadata in payload — ignoring');
      return;
    }
    try {
      const result = installer.uninstallSkill({
        skill,
        agentType: this.agentType,
        workingDir: this.workingDir,
        log: (m) => this._log(`skill.uninstall: ${m}`),
      });
      this._log(`skill.uninstall: "${skillId}" removed=${result.removed}`);
      try {
        await this.client.reportSkillStatus(this.workspaceId, this.agentName, this.token, {
          skillId, state: 'uninstalled',
        });
      } catch (e) {
        this._log(`skill.uninstall: failed to report status: ${e && e.message ? e.message : e}`);
      }
      await this._onSkillsChanged();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      this._log(`skill.uninstall: FAILED "${skillId}": ${msg}`);
    }
  }

  /**
   * Hook for subclasses to react to a change in the installed-skills set
   * (e.g. rebuild prompt context). Default: no-op.
   */
  async _onSkillsChanged() {}

  /**
   * Post a chat message back to the requesting channel summarizing agent
   * name, type, agent-launcher version, uptime, and network. Used by the
   * `/status` slash command.
   */
  async _postStatusReport(payload) {
    const channel = (payload && typeof payload === 'object') ? payload.channel : null;
    if (!channel) return;

    let pkgVersion = 'unknown';
    try {
      const path = require('path');
      const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
      pkgVersion = pkg.version || 'unknown';
    } catch {}

    const uptimeMs = Math.max(0, Date.now() - this._startedAt);
    const totalSec = Math.floor(uptimeMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    let uptime;
    if (days > 0) uptime = `${days}d ${hours}h ${minutes}m`;
    else if (hours > 0) uptime = `${hours}h ${minutes}m`;
    else if (minutes > 0) uptime = `${minutes}m ${seconds}s`;
    else uptime = `${seconds}s`;

    const adapterType = this.agentType || 'unknown';
    const content =
      `**Agent status**\n` +
      `- Name: \`${this.agentName}\` (${adapterType})\n` +
      `- Version: agent-launcher \`${pkgVersion}\`\n` +
      `- Uptime: ${uptime}\n` +
      `- Network: \`${this.workspaceId}\``;

    try {
      await this.client.sendMessage(this.workspaceId, channel, this.token, content, {
        senderType: 'agent',
        senderName: this.agentName,
        messageType: 'chat',
        metadata: { agent_mode: this._mode },
        sessionId: this._sessionId,
      });
    } catch (e) {
      this._log(`Status: failed to post: ${e && e.message ? e.message : e}`);
    }
  }

  /**
   * Post a markdown table of the agent's active routines back to the
   * requesting channel. Used by the `/routines` slash command. Each agent
   * reports only routines it owns (created_by === openagents:<agentName>)
   * so the user sees a clear "my routines" view per agent, mirroring how
   * /status reports per-agent uptime.
   */
  async _postRoutinesReport(payload) {
    const channel = (payload && typeof payload === 'object') ? payload.channel : null;
    if (!channel) return;

    let routines = [];
    try {
      const data = await this.client.listRoutines(this.workspaceId, channel, this.token);
      // Accept both the canonical `openagents:<name>` source and the bare
      // `<name>` form. Agents that follow the workspace prompt verbatim
      // produce the prefixed form, but some agents send the bare name when
      // they construct the POST body themselves.
      const prefixed = `openagents:${this.agentName}`;
      routines = ((data && data.routines) || []).filter(
        (r) => r.created_by === prefixed || r.created_by === this.agentName,
      );
    } catch (e) {
      this._log(`Routines: failed to list: ${e && e.message ? e.message : e}`);
      try {
        await this.client.sendMessage(
          this.workspaceId, channel, this.token,
          `**Routines for \`${this.agentName}\`**\n\n_Failed to fetch routines._`,
          { senderType: 'agent', senderName: this.agentName, messageType: 'chat', sessionId: this._sessionId },
        );
      } catch {}
      return;
    }

    let content;
    if (!routines.length) {
      content = `**Routines for \`${this.agentName}\`**\n\n_No active routines._`;
    } else {
      const rows = routines.map((r) => {
        const schedule = (r.schedule_interval_minutes != null)
          ? `every ${r.schedule_interval_minutes} min`
          : `${String(r.schedule_hour ?? 0).padStart(2, '0')}:${String(r.schedule_minute ?? 0).padStart(2, '0')} UTC` +
            (r.schedule_days ? ` (days [${r.schedule_days.join(',')}])` : ' daily');
        const next = r.next_fires_at || '—';
        const name = String(r.name || '').replace(/\|/g, '\\|');
        const id = String(r.id || '').slice(0, 8);
        return `| \`${id}\` | ${name} | ${schedule} | ${next} |`;
      });
      content =
        `**Routines for \`${this.agentName}\`** (${routines.length})\n\n` +
        '| ID | Name | Schedule | Next fires |\n' +
        '|---|---|---|---|\n' +
        rows.join('\n');
    }

    try {
      await this.client.sendMessage(this.workspaceId, channel, this.token, content, {
        senderType: 'agent',
        senderName: this.agentName,
        messageType: 'chat',
        metadata: { agent_mode: this._mode },
        sessionId: this._sessionId,
      });
    } catch (e) {
      this._log(`Routines: failed to post: ${e && e.message ? e.message : e}`);
    }
  }

  _hasActiveWork() {
    return this._channelBusy.size > 0;
  }

  _controlPollDelayMs() {
    return this._hasActiveWork() ? 250 : 2000;
  }

  _wakeControlPoller() {
    if (this._controlWake) {
      this._controlWake();
      this._controlWake = null;
    }
  }

  async _sleepUntilControlPollDue(delayMs) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, delayMs);
      this._controlWake = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    this._controlWake = null;
  }

  async _controlPollerLoop() {
    while (this._running) {
      await this._pollControl();
      if (!this._running) break;
      await this._sleepUntilControlPollDue(this._controlPollDelayMs());
    }
  }

  // ------------------------------------------------------------------
  // Poll loop
  // ------------------------------------------------------------------

  async _pollLoop() {
    let idleCount = 0;
    let pollCount = 0;

    while (this._running) {
      pollCount++;
      let messages, rawCursor, composingActive = false;
      try {
        const result = await this.client.pollPending(
          this.workspaceId, this.agentName, this.token,
          { after: this._lastEventId }
        );
        messages = result.messages;
        rawCursor = result.cursor;
        composingActive = !!result.composing;
        this._pollAuthFailStreak = 0;
        if (pollCount <= 3 || pollCount % 20 === 0) {
          this._log(`Poll #${pollCount}: ${messages.length} messages, cursor=${rawCursor || 'none'}${composingActive ? ' composing' : ''}`);
        }
      } catch (e) {
        this._log(`Poll #${pollCount} failed: ${e.message} \nStack: ${e.stack}`);
        // A rejected credential never heals by retrying with the same token —
        // it means the device was re-paired/unpaired and this adapter is
        // running on a revoked one. After a few consecutive rejections (not
        // one: a server redeploy can 401 transiently), surface a hard error
        // so status/heartbeat stop claiming "running" while nothing works.
        // The daemon's credential watch restarts the adapter when a fresh
        // token lands on disk, which also clears this state.
        const sc = httpStatusOf(e);
        if (sc === 401 || sc === 403 || /invalid workspace credentials/i.test(e.message || '')) {
          this._pollAuthFailStreak = (this._pollAuthFailStreak || 0) + 1;
          if (this._pollAuthFailStreak >= 3) {
            this._reportStatus(
              REASON.WORKSPACE_JOIN_FAILED,
              'Workspace rejected this agent\'s credentials — re-pair the device or reconnect the agent to the workspace',
            );
          }
        }
        await this._sleep(5000);
        continue;
      }

      if (rawCursor) this._lastEventId = rawCursor;

      // Deduplicate
      const incoming = [];
      for (const msg of messages) {
        const msgId = msg.id || msg.messageId;
        if (msgId && this._processedIds.has(msgId)) continue;
        if (msg.messageType === 'status') continue;
        // Handle queue cancellation signals from frontend
        if (msg.messageType === 'queue_cancel') {
          if (msgId) this._processedIds.add(msgId);
          const channel = msg.sessionId || this.channelName || 'general';
          const queueId = msg.metadata?.queue_id || (msg.content || '').replace('__queue_cancel:', '');
          if (queueId) this._cancelQueuedMessage(channel, queueId);
          continue;
        }
        incoming.push(msg);
      }

      if (incoming.length > 0) {
        idleCount = 0;
        for (const msg of incoming) {
          const msgId = msg.id || msg.messageId;
          if (msgId) this._processedIds.add(msgId);
          await this._dispatchMessage(msg);
        }
        // Cap dedup set
        if (this._processedIds.size > 2000) {
          const arr = [...this._processedIds];
          this._processedIds.clear();
          for (const id of arr.slice(-1000)) this._processedIds.add(id);
        }
      } else {
        idleCount++;
      }

      // Adaptive polling with warm plateau:
      //   Active (messages incoming):  2s
      //   Warm (≤5 min since last msg): 5s
      //   Cooldown (5-7 min):          5s → 15s (ramp 1s per idle poll)
      //   Cold (>7 min):              15s
      // The warm plateau keeps the agent responsive during typical user
      // think-time between messages without hammering the backend.
      const WARM_INTERVAL = 5000;
      const WARM_POLLS = 60;  // 60 × 5s = 5 minutes warm plateau
      let delay;
      if (incoming.length > 0) {
        delay = 2000;
      } else if (composingActive) {
        delay = 2000;
        idleCount = Math.min(idleCount, WARM_POLLS);
      } else if (idleCount <= WARM_POLLS) {
        delay = WARM_INTERVAL;
      } else {
        delay = Math.min(WARM_INTERVAL + (idleCount - WARM_POLLS) * 1000, 15000);
      }
      await this._sleep(delay);
    }
  }

  // ------------------------------------------------------------------
  // Channel dispatch
  // ------------------------------------------------------------------

  async _dispatchMessage(msg) {
    // Use sessionId only if it looks like a channel, not an agent target
    let channel = this.channelName || 'general';
    if (msg.sessionId && !msg.sessionId.startsWith('openagents:') && !msg.sessionId.startsWith('agent:')) {
      channel = msg.sessionId;
    }

    if (this._channelBusy.has(channel)) {
      // A routine that's already running must not stack up. Routine fires are
      // periodic, so a fire that arrives while the previous run is still going
      // is simply dropped — the next scheduled tick re-fires once the agent is
      // free. (The backend guard normally prevents this from even being sent;
      // this is the last line of defense against a queue backlog.)
      if (msg.senderName === 'system:routine') {
        this._log(`Skipping routine fire in ${channel} — previous run still in progress`);
        return;
      }
      if (!this._channelQueues[channel]) this._channelQueues[channel] = [];
      const queueId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      msg._queueId = queueId;
      this._channelQueues[channel].push(msg);
      try {
        await this.sendStatus(channel, 'message queued — will process after current task', {
          queued_message: (msg.content || '').slice(0, 200),
          queue_id: queueId,
        });
      } catch {}
      return;
    }

    // Run channel worker (don't await — parallel execution)
    this._channelWorker(channel, msg);
    this._wakeControlPoller();
  }

  _cancelQueuedMessage(channel, queueId) {
    const queue = this._channelQueues[channel];
    if (!queue) return false;
    const idx = queue.findIndex((m) => m._queueId === queueId);
    if (idx === -1) return false;
    queue.splice(idx, 1);
    this._log(`Cancelled queued message ${queueId} in ${channel}`);
    return true;
  }

  async _channelWorker(channel, msg) {
    this._channelBusy.add(channel);
    try {
      await this._prefetchPinnedContext(channel);
      await this._handleMessage(msg);
    } catch (e) {
      this._log(`Error in channel worker for ${channel}: ${e.message}`);
      try { await this.sendError(channel, `Agent error: ${e.message}`); } catch {}
    }

    // Drain queue
    while (true) {
      const queue = this._channelQueues[channel];
      if (!queue || queue.length === 0) break;
      const nextMsg = queue.shift();
      if (nextMsg._queueId) {
        try { await this.sendStatus(channel, 'processing queued message', { queue_id: nextMsg._queueId, queue_status: 'processed' }); } catch {}
      }
      try {
        // Pinned entries may have changed while this message waited.
        await this._prefetchPinnedContext(channel);
        await this._handleMessage(nextMsg);
      } catch (e) {
        this._log(`Error processing queued message in ${channel}: ${e.message}`);
        try { await this.sendError(channel, `Agent error: ${e.message}`); } catch {}
      }
    }
    this._channelBusy.delete(channel);
  }

  // ------------------------------------------------------------------
  // Knowledge pinning (decision log + glossary)
  // ------------------------------------------------------------------

  /**
   * Read one pinned knowledge entry with a short per-request deadline
   * (worst case one list + one get, ~2x that budget). `titles` is tried in
   * precedence order against a single listing; `cache` maps channel → entry
   * id. Returns { available, state, entryId, content, error }:
   * - available=false  → knowledge module disabled, pinning inactive
   * - state 'found'    → the entry exists (entryId set; content null when a
   *                      transient error hid it this turn)
   * - state 'absent'   → a successful listing confirmed no entry exists
   * - state 'unknown'  → fetch failed before existence could be confirmed;
   *                      the prompt must NOT claim the entry is missing, or a
   *                      recovered network mid-turn produces a duplicate
   * - error=true       → transient failure; callers must NOT treat this as
   *                      "entry changed/empty"
   * The matched entry id is cached per channel so the steady state is a
   * single GET; a 404 or a soft-deleted entry (the backend keeps deleted
   * rows readable by id with status "deleted") invalidates the cache and
   * falls back to list+match, which only sees active entries.
   */
  async _fetchPinnedEntry(channel, titles, cache, label) {
    if ((this.disabledModules || new Set()).has('knowledge')) {
      if (!this._warnedKnowledgeDisabled) {
        this._warnedKnowledgeDisabled = true;
        this._log(
          'Knowledge module is disabled — decision-log pinning is INACTIVE. ' +
          'Confirmed decisions will not survive context compaction or session resets.'
        );
      }
      if (!this._pinnedStatusWarned.has(channel)) {
        this._pinnedStatusWarned.add(channel);
        try {
          await this.sendStatus(
            channel,
            'Decision pinning inactive: the knowledge module is disabled for ' +
            'this agent, so confirmed decisions and the shared glossary ' +
            'cannot be pinned across session resets.'
          );
        } catch {}
      }
      return { available: false, state: 'unknown', entryId: null, title: null, content: null, error: false };
    }

    const timeout = this._DECISION_FETCH_TIMEOUT_MS;
    // Only highest-precedence matches are ever cached (see below), so a
    // cached id always belongs to titles[0].
    const cachedId = cache[channel];
    if (cachedId) {
      try {
        const entry = await this.client.getKnowledge(this.workspaceId, this.token, cachedId, { timeout });
        if (entry && entry.status && entry.status !== 'active') {
          // Soft-deleted: still served by id, but dead for updates.
          delete cache[channel];
          // Fall through to list+match below.
        } else if (entry && typeof entry.title === 'string' && entry.title !== titles[0]) {
          // Renamed (e.g. archived): the id no longer owns the canonical
          // title, so the pin must re-resolve — a fallback or a replacement
          // entry has to win over the stale cache.
          delete cache[channel];
          // Fall through to list+match below.
        } else {
          return { available: true, state: 'found', entryId: cachedId, title: titles[0], content: (entry && entry.content) || '', error: false };
        }
      } catch (e) {
        if (/not found|HTTP 404/i.test(e.message || '')) {
          delete cache[channel];
          // Entry is gone — fall through to list+match below.
        } else {
          this._log(`${label} read failed (${e.message}) — reusing last known state`);
          return { available: true, state: 'found', entryId: cachedId, title: titles[0], content: null, error: true };
        }
      }
    }

    try {
      const data = await this.client.listKnowledge(this.workspaceId, this.token, { limit: 500, timeout });
      const entries = (data && data.entries) || [];
      let entry = null;
      let matchedTitle = null;
      for (const title of titles) {
        const picked = pickEntryByTitle(entries, title);
        if (picked.duplicates > 0) {
          this._log(
            `${label} WARNING for ${channel} — ${picked.duplicates + 1} knowledge entries share the title ` +
            `"${title}"; using the earliest. The duplicates should be merged manually.`
          );
        }
        if (picked.entry) { entry = picked.entry; matchedTitle = title; break; }
      }
      if (!entry) return { available: true, state: 'absent', entryId: null, title: null, content: null, error: false };
      // Cache ONLY a highest-precedence match. Caching a fallback (e.g. the
      // workspace glossary) under the channel key would let the cached-id
      // fast path skip the precedence check forever, permanently masking a
      // channel-specific entry created later. Fallback users pay one extra
      // list per message instead.
      if (matchedTitle === titles[0]) cache[channel] = entry.id;
      const full = await this.client.getKnowledge(this.workspaceId, this.token, entry.id, { timeout });
      if (full && full.status && full.status !== 'active') {
        // Deleted between the listing and the read.
        delete cache[channel];
        return { available: true, state: 'absent', entryId: null, title: null, content: null, error: false };
      }
      return { available: true, state: 'found', entryId: entry.id, title: matchedTitle, content: (full && full.content) || '', error: false };
    } catch (e) {
      this._log(`${label} fetch failed (${e.message}) — reusing last known state`);
      const knownId = cache[channel] || null;
      return { available: true, state: knownId ? 'found' : 'unknown', entryId: knownId, title: knownId ? titles[0] : null, content: null, error: true };
    }
  }

  /** Read the channel's decision log. See _fetchPinnedEntry for the contract. */
  async _fetchDecisionLog(channel) {
    return this._fetchPinnedEntry(channel, [decisionLogTitle(channel)], this._decisionEntryIds, 'Decision log');
  }

  /**
   * Read the channel's glossary — the channel-specific entry when it exists,
   * else the workspace-wide fallback. See _fetchPinnedEntry for the contract.
   * The result carries scope 'channel' | 'workspace' (null when not found)
   * so prompts can treat the shared fallback as read-only.
   */
  async _fetchGlossary(channel) {
    const res = await this._fetchPinnedEntry(
      channel,
      [glossaryTitle(channel), WORKSPACE_GLOSSARY_TITLE],
      this._glossaryEntryIds,
      'Glossary'
    );
    res.scope = res.title === WORKSPACE_GLOSSARY_TITLE ? 'workspace'
      : res.title ? 'channel' : null;
    return res;
  }

  /** Fetch everything pinnable for a channel: { decisions, glossary }. */
  async _fetchPinnedContext(channel) {
    const decisions = await this._fetchDecisionLog(channel);
    const glossary = await this._fetchGlossary(channel);
    return { decisions, glossary };
  }

  /**
   * Refresh the pinned context ahead of _handleMessage for adapters that
   * opted in (_usesPinnedContext). A transient read failure must not wipe
   * the last successful pin — prompt-per-turn adapters would lose the
   * authoritative definitions for that turn — so an errored entry keeps the
   * previous good result; a thrown fetch keeps the previous context whole.
   */
  async _prefetchPinnedContext(channel) {
    if (!this._usesPinnedContext) return;
    try {
      const fresh = await this._fetchPinnedContext(channel);
      const prev = this._pinnedContext[channel];
      if (prev) {
        if (fresh.decisions && fresh.decisions.error && prev.decisions && !prev.decisions.error) {
          fresh.decisions = prev.decisions;
        }
        if (fresh.glossary && fresh.glossary.error && prev.glossary && !prev.glossary.error) {
          fresh.glossary = prev.glossary;
        }
      }
      this._pinnedContext[channel] = fresh;
    } catch (e) {
      this._log(`Pinned-context fetch failed (${e && e.message ? e.message : e}) — reusing the last pinned context`);
    }
  }

  /**
   * Prompt-builder options ({ decisionLog, glossary }) derived from the last
   * prefetch for the channel. Sync, so prompt builders can call it inline;
   * returns {} when nothing was prefetched or nothing is usable.
   */
  pinnedPromptOpts(channel) {
    const ctx = this._pinnedContext[channel];
    if (!ctx) return {};
    const opts = {};
    const d = ctx.decisions;
    if (d && d.available) {
      opts.decisionLog = {
        enabled: true,
        state: d.state,
        entryId: d.entryId,
        content: d.error ? '' : (d.content || ''),
      };
    }
    const g = ctx.glossary;
    if (g && g.available && g.state === 'found' && g.content) {
      opts.glossary = { enabled: true, entryId: g.entryId, content: g.content, scope: g.scope || 'channel' };
    }
    return opts;
  }

  // ------------------------------------------------------------------
  // Auto-title helper
  // ------------------------------------------------------------------

  async _autoTitleChannel(channel, content) {
    if (this._titledSessions.has(channel)) return;
    this._titledSessions.add(channel);
    const title = generateSessionTitle(content);
    if (!title) return;
    try {
      const info = await this.client.getSession(this.workspaceId, channel, this.token);
      if (!info.titleManuallySet && SESSION_DEFAULT_RE.test(info.title || '')) {
        await this.client.updateSession(
          this.workspaceId, channel, this.token,
          { title, autoTitle: true }
        );
        this._log(`Auto-titled channel: ${title}`);
      }
    } catch (e) {
      this._log(`Failed to auto-title channel: ${e.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Message helpers
  // ------------------------------------------------------------------

  async sendStatus(channel, content, extraMeta) {
    try {
      const safeContent = redactSensitiveHeaders(content);
      await this.client.sendMessage(this.workspaceId, channel, this.token, safeContent, {
        senderType: 'agent',
        senderName: this.agentName,
        messageType: 'status',
        metadata: { agent_mode: this._mode, ...extraMeta },
        sessionId: this._sessionId,
      });
    } catch (e) {
      if (e instanceof SessionRevokedError) this._onSessionRevoked();
    }
  }

  async sendThinking(channel, content) {
    // Skip empty thinking traces entirely.
    if (!content || !content.trim()) return;
    try {
      await this.client.sendMessage(this.workspaceId, channel, this.token, content, {
        senderType: 'agent',
        senderName: this.agentName,
        messageType: 'thinking',
        metadata: { agent_mode: this._mode },
        sessionId: this._sessionId,
      });
    } catch (e) {
      if (e instanceof SessionRevokedError) this._onSessionRevoked();
    }
  }

  async sendResponse(channel, content) {
    try {
      await this.client.sendMessage(this.workspaceId, channel, this.token, content, {
        senderType: 'agent',
        senderName: this.agentName,
        sessionId: this._sessionId,
      });
    } catch (e) {
      if (e instanceof SessionRevokedError) {
        this._onSessionRevoked();
        return;
      }
      throw e;
    }
  }

  async cleanupTodos(channel) {
    try {
      const result = await this.client.getTodos(this.workspaceId, channel, this.token, {
        all: false,
      });
      const todos = (result && result.todos) || [];
      const hasActive = todos.some((t) => t.status === 'pending' || t.status === 'in_progress');
      if (!hasActive) return;
      const updated = todos.map((t) => ({
        content: t.content,
        status: (t.status === 'pending' || t.status === 'in_progress') ? 'cancelled' : t.status,
        assignee: t.assignee,
      }));
      await this.client.putTodos(this.workspaceId, channel, this.token, updated, {
        source: `openagents:${this.agentName}`,
      });
    } catch {
      // Best-effort cleanup
    }
  }

  async getRemainingTodos(channel) {
    try {
      const result = await this.client.getTodos(this.workspaceId, channel, this.token, {
        all: false,
      });
      const todos = (result && result.todos) || [];
      return todos.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    } catch {
      return [];
    }
  }

  async sendTodos(channel, todos) {
    try {
      await this.client.putTodos(this.workspaceId, channel, this.token, todos, {
        source: `openagents:${this.agentName}`,
      });
    } catch (e) {
      if (e instanceof SessionRevokedError) { this._onSessionRevoked(); return; }
      // Fallback to event-based approach for older backends
      const lines = todos.map((t) => {
        const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜';
        return `${icon} ${t.content}`;
      });
      try {
        await this.client.sendMessage(this.workspaceId, channel, this.token, lines.join('\n'), {
          senderType: 'agent',
          senderName: this.agentName,
          messageType: 'todos',
          metadata: { agent_mode: this._mode, todos },
          sessionId: this._sessionId,
        });
      } catch (e2) {
        if (e2 instanceof SessionRevokedError) this._onSessionRevoked();
      }
    }
  }

  async sendError(channel, error) {
    try {
      await this.client.sendMessage(this.workspaceId, channel, this.token, error, {
        senderType: 'agent',
        senderName: this.agentName,
        sessionId: this._sessionId,
      });
    } catch (e) {
      if (e instanceof SessionRevokedError) this._onSessionRevoked();
    }
  }

  _onSessionRevoked() {
    this._log(`SESSION REVOKED: another client joined as '${this.agentName}'. Stopping adapter.`);
    this._running = false;
  }

  // ------------------------------------------------------------------
  // Abstract
  // ------------------------------------------------------------------

  /**
   * Process a single incoming message. Must be implemented by subclasses.
   * @param {object} msg
   */
  async _handleMessage(_msg) {
    throw new Error('_handleMessage must be implemented by subclass');
  }

  // ------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Return whether the workspace has the Browser Fabric viewer toggle on.
   * Cached for the lifetime of the adapter — restart to pick up a flip.
   * Falls back to false on error so the prompt builders don't accidentally
   * inject the strong directive against an older backend that can't route
   * to Browser Fabric.
   */
  async getBrowserEnabled() {
    if (this._browserEnabledCache === null) {
      try {
        const meta = await this.client.getWorkspaceMetadata(this.workspaceId, this.token);
        this._browserEnabledCache = !!(meta && meta.browserEnabled);
      } catch (e) {
        this._browserEnabledCache = false;
      }
    }
    return this._browserEnabledCache;
  }
}

module.exports = BaseAdapter;
