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
const { generateSessionTitle, SESSION_DEFAULT_RE } = require('./utils');

const DEFAULT_ENDPOINT = 'https://workspace-endpoint.openagents.org';

class BaseAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.workspaceId
   * @param {string} opts.channelName - default/initial channel
   * @param {string} opts.token
   * @param {string} opts.agentName
   * @param {string} [opts.endpoint]
   */
  constructor({ workspaceId, channelName, token, agentName, endpoint, agentEnv, agentType, workingDir }) {
    this.workspaceId = workspaceId;
    this.channelName = channelName;
    this.token = token;
    this.agentName = agentName;
    this.endpoint = endpoint || DEFAULT_ENDPOINT;
    this.agentEnv = agentEnv || process.env;
    this.agentType = agentType;
    this.workingDir = workingDir || undefined;
    this.client = new WorkspaceClient(this.endpoint);
    this._lastEventId = null;
    this._lastToolResultId = null;
    this._running = false;
    this._sessionId = null;  // issued by server on /v1/join; used to prove liveness
    this._processedIds = new Set();
    this._titledSessions = new Set();
    this._mode = 'execute';
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
  // Lifecycle
  // ------------------------------------------------------------------

  async run() {
    this._running = true;

    // Announce agent to workspace
    try {
      const joinResult = await this.client.joinNetwork(this.agentName, this.token, {
        network: this.workspaceId,
        agentType: this.agentType || 'agent',
        serverHost: require('os').hostname(),
        workingDir: this.workingDir || process.cwd(),
      });
      this._sessionId = (joinResult && joinResult.session_id) || null;
      this._log(`Joined workspace ${this.workspaceId}${this._sessionId ? ` (session ${this._sessionId.slice(0, 8)})` : ''}`);
    } catch (e) {
      this._log(`Warning: join failed: ${e.message} \nStack: ${e.stack}`);
    }

    // Sync workspace-managed skills into disabledModules
    try {
      const agents = await this.client.getAgents(this.workspaceId, this.token);
      const self = agents.find((a) => a.agentName === this.agentName);
      if (self && self.enabledSkills) {
        const { skillsToDisabledModules } = require('../skill-catalog');
        this.disabledModules = skillsToDisabledModules(self.enabledSkills);
        this._log(`Synced skills from workspace: disabled=[${[...this.disabledModules].join(',')}]`);
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
    } catch (e) {
      if (e instanceof SessionRevokedError) {
        this._log(`SESSION REVOKED: another client joined as '${this.agentName}'. Stopping adapter.`);
        this._running = false;
        return;
      }
      this._log(`Heartbeat failed: ${e.message}`);
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
    }
  }

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
        if (pollCount <= 3 || pollCount % 20 === 0) {
          this._log(`Poll #${pollCount}: ${messages.length} messages, cursor=${rawCursor || 'none'}${composingActive ? ' composing' : ''}`);
        }
      } catch (e) {
        this._log(`Poll #${pollCount} failed: ${e.message} \nStack: ${e.stack}`);
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

      // Sidecar poll: A2UI tool_result events. These are the user's response
      // to a UI spec this agent (or any agent in the network) emitted. We
      // surface each one as a synthetic user message so the LLM sees it as
      // the next turn and can react. Failures here don't break the main
      // message poll.
      try {
        const toolResult = await this.client.pollToolResults(
          this.workspaceId, this.token,
          { after: this._lastToolResultId }
        );
        if (toolResult.cursor) this._lastToolResultId = toolResult.cursor;
        for (const event of toolResult.events || []) {
          const msgId = event.id;
          if (msgId && this._processedIds.has(msgId)) continue;
          if (msgId) this._processedIds.add(msgId);
          const synth = synthesizeToolResultMessage(event);
          if (synth) await this._dispatchMessage(synth);
        }
      } catch (e) {
        // Non-fatal — log once per poll if it fails
        if (pollCount <= 3 || pollCount % 20 === 0) {
          this._log(`tool_result poll #${pollCount} failed: ${e.message}`);
        }
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
        await this._handleMessage(nextMsg);
      } catch (e) {
        this._log(`Error processing queued message in ${channel}: ${e.message}`);
        try { await this.sendError(channel, `Agent error: ${e.message}`); } catch {}
      }
    }
    this._channelBusy.delete(channel);
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
      await this.client.sendMessage(this.workspaceId, channel, this.token, content, {
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
    // Strip ```a2ui blocks if they leak into Claude's intermediate thinking
    // trace — the real spec gets emitted via sendResponse with proper
    // payload.spec extraction, so showing the raw block here is just noise
    // (and a duplicate). If stripping leaves the thinking message empty,
    // skip it entirely.
    const { cleanContent } = extractA2UISpec(content);
    if (!cleanContent || !cleanContent.trim()) return;
    try {
      await this.client.sendMessage(this.workspaceId, channel, this.token, cleanContent, {
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
    const { cleanContent, spec, specToolCallId } = extractA2UISpec(content);
    try {
      await this.client.sendMessage(this.workspaceId, channel, this.token, cleanContent, {
        senderType: 'agent',
        senderName: this.agentName,
        sessionId: this._sessionId,
        spec,
        specToolCallId,
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

// ------------------------------------------------------------------
// A2UI helpers
// ------------------------------------------------------------------

/**
 * Pull the first ```a2ui ... ``` fenced block out of LLM-produced content.
 * Returns the content with the block stripped, the parsed spec, and a
 * tool-call id derived from `spec.tool_call_id` (if present) or a new one.
 * If no block is present or parsing fails, returns the content unchanged
 * with null spec — the message still goes out as plain markdown.
 */
/**
 * Convert a workspace.tool_result event into a synthetic user-message
 * shape that the agent's _handleMessage can dispatch. The LLM sees this
 * as the next user turn — the content is a short, machine-readable line
 * the LLM can parse without ambiguity. The original spec it emitted is
 * already in the LLM's conversation history; the tool_call_id lets the
 * LLM correlate this back.
 */
function synthesizeToolResultMessage(event) {
  if (!event || !event.payload) return null;
  const p = event.payload;
  const actionId = p.action_id || '';
  const toolCallId = p.tool_call_id || '';
  let valueStr = '';
  if (p.value !== undefined && p.value !== null) {
    try { valueStr = JSON.stringify(p.value); } catch (_) { valueStr = String(p.value); }
  }
  const lines = [
    '[ui_action]',
    `action=${actionId}`,
    toolCallId ? `tool_call_id=${toolCallId}` : null,
    valueStr ? `value=${valueStr}` : null,
  ].filter(Boolean);
  const content = lines.join(' ');
  const target = event.target || '';
  return {
    messageId: event.id || '',
    sessionId: target.startsWith('channel/') ? target.replace('channel/', '') : target,
    senderType: 'human',
    senderName: 'user',
    content,
    mentions: [],
    messageType: 'chat',
    metadata: event.metadata || {},
  };
}

function extractA2UISpec(content) {
  if (!content || typeof content !== 'string') {
    return { cleanContent: content, spec: null, specToolCallId: null };
  }
  const match = content.match(/```a2ui\s*\n([\s\S]*?)\n```/);
  if (!match) return { cleanContent: content, spec: null, specToolCallId: null };

  let spec;
  try {
    spec = JSON.parse(match[1]);
  } catch (_) {
    return { cleanContent: content, spec: null, specToolCallId: null };
  }

  const specToolCallId = (spec && spec.tool_call_id) || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (spec && spec.tool_call_id) delete spec.tool_call_id;

  const cleanContent = content.replace(match[0], '').trim();
  return { cleanContent, spec, specToolCallId };
}

module.exports = BaseAdapter;
module.exports.extractA2UISpec = extractA2UISpec;
