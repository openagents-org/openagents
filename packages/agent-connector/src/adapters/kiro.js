/**
 * Kiro CLI adapter for OpenAgents workspace.
 *
 * Bridges Kiro's terminal agent (`kiro-cli`, installed by cli.kiro.dev/install)
 * to an OpenAgents workspace over the Agent Client Protocol:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one `kiro-cli acp` server per user message, driven with JSON-RPC over
 *     stdio (acp-client.js): initialize → session/new | session/load →
 *     session/prompt, streaming session/update frames into the channel
 *   - workspace tools over MCP, handed to the CLI in session/new's
 *     `mcpServers` — the token is passed to Kiro over stdin in the MCP
 *     server env; it is never in argv or written to disk by OpenAgents
 *     (whether Kiro persists session state including that env is up to Kiro)
 *   - session continuity per channel: the ACP session id is remembered and
 *     resumed with session/load from the same working directory
 *
 * Decisions worth knowing before editing this file (the verified CLI facts
 * behind them are in kiro-runtime.js):
 *
 *   ONE KIRO AGENT PROFILE PER OPENAGENTS AGENT. KIRO_AGENT (per-agent env)
 *   selects a Kiro agent profile with `--agent`. That profile is where the
 *   agent's own prompt, tools and MCP servers live — the workspace server is
 *   added next to them, not instead of them. Kiro silently falls back to its
 *   default agent for an unknown profile; the adapter refuses that turn
 *   rather than run an agent without its own instructions and data sources.
 *
 *   APPROVALS ARE ANSWERED HERE. No `--trust-all-tools`: every approval the
 *   CLI asks for arrives as session/request_permission. Execute mode allows
 *   each call once (never "always", which would persist trust into the
 *   user's Kiro settings); plan mode allows read-only tools and the
 *   workspace's own tools and refuses the rest.
 *
 *   THE BRIEFING IS PART OF THE PROMPT. ACP has no system-prompt field. The
 *   workspace briefing is sent as the first content block of a session's
 *   first turn, and again only when it changes (mode, pinned knowledge), so
 *   a long thread does not pay for it on every message.
 *
 *   STOP CANCELS, THEN KILLS THE TREE. session/cancel ends the turn cleanly;
 *   the server is then ended with its descendants (MCP servers, shell
 *   commands), read from the process table while it is still alive.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
// spawn() here is the WSL bridge from ../wsl: same signature as
// child_process.spawn, and a straight pass-through unless the resolved CLI
// lives on the other side of the Windows/WSL boundary.
const { spawn } = require('../wsl');

const BaseAdapter = require('./base');
const { AcpClient, AcpRpcError, AcpClosedError, AcpTimeoutError } = require('./acp-client');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle, redactSecrets } = require('./utils');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');
const { classifyRunFailure } = require('./run-failure');
const { REASON } = require('./health-status');
const { defaultAgentWorkdir, whichBinary, getEnhancedEnv } = require('../paths');
// The process-table walk is the one the Qoder adapter verified for CLIs that
// leave MCP servers and detached shell commands behind.
const { descendantsOf, parseProcessTable } = require('./qoder-runtime');
const {
  KIRO_BINARY,
  KIRO_MIN_VERSION,
  ACP_PROTOCOL_VERSION,
  WORKSPACE_MCP_NAME,
  KIRO_GUIDANCE,
  installHint,
  classifyKiroVersion,
  resolveKiroSettings,
  buildKiroArgs,
  toAcpMcpServer,
  truncate,
  interpretUpdate,
  permissionOutcome,
  isStaleSessionError,
  rpcErrorText,
  agentNotFoundMessage,
} = require('./kiro-runtime');

const IS_WINDOWS = process.platform === 'win32';

// Handshake budget: initialize + session/new start the CLI and every MCP
// server the agent profile declares, which can take a while on a cold start.
const HANDSHAKE_TIMEOUT_MS = 120000;

// Idle watchdog, as in the Qoder adapter: with no frame for this long we nudge
// the channel, and after MAX consecutive silences we end a run that is
// probably wedged. It pauses while a tool call is out.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2;  // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;      // ~5 min of silence → kill

const VERSION_PROBE_TTL_MS = 60000;
const STOP_GRACE_MS = 3000;
const CANCEL_GRACE_MS = 1500;
const STDERR_CAP = 8000;
const THINKING_PREVIEW = 600;

class KiroAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this._usesPinnedContext = true;
    // channel → { sessionId, workingDir, agent, briefing }
    this._channelSessions = {};
    // channel → child process (the in-flight `kiro-cli acp`)
    this._channelProcesses = {};
    // channel → { proc, client, sessionId, settled }
    this._channelRuns = {};
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_kiro.json`,
    );
    this._isWindows = IS_WINDOWS;
    this._versionProbe = null; // { at, bin, version, supported }
    this._watchdogIntervalMs = WATCHDOG_INTERVAL_MS;
    this._watchdogMax = WATCHDOG_MAX;
    this._handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS;
    this._loadSessions();
  }

  /** The model the CLI is started with, so the workspace never shows another one. */
  modelLabel() {
    return resolveKiroSettings(this.agentEnv, this.workspaceModel).model || null;
  }

  // ------------------------------------------------------------------
  // Session persistence (bound to the working directory and agent profile)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Kiro session(s)`);
        }
      }
    } catch {
      this._log('Could not load Kiro sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * A resumable session for this channel, or null. Kiro files sessions per
   * working directory, and a session started under another agent profile
   * carries that profile's instructions — neither is resumed across a change.
   */
  _resumableSession(channel, workingDir, agent) {
    const entry = this._channelSessions[channel];
    if (!entry || !entry.sessionId) return null;
    if (entry.workingDir && workingDir && entry.workingDir !== workingDir) return null;
    if ((entry.agent || null) !== (agent || null)) return null;
    return entry;
  }

  _rememberSession(channel, record) {
    if (!record || !record.sessionId) return;
    this._channelSessions[channel] = record;
    this._saveSessions();
  }

  _clearSession(channel) {
    if (this._channelSessions[channel]) {
      delete this._channelSessions[channel];
      this._saveSessions();
    }
  }

  // ------------------------------------------------------------------
  // Binary + version
  // ------------------------------------------------------------------

  /**
   * Locate the CLI through the shared lookup: ~/.local/bin (the official
   * install.sh), /usr/local/bin (its system-wide mode) and
   * %ProgramFiles%\Kiro-Cli (install.ps1's MSI) are all in getKnownBinDirs,
   * so there is no private candidate list here (see CLAUDE.md).
   */
  _findKiroBinary() {
    return whichBinary(KIRO_BINARY) || null;
  }

  /** Daemon gate before join: a missing CLI is reported, not joined. */
  preflight() {
    const bin = this._findKiroBinary();
    if (!bin) {
      return {
        ok: false,
        reason: REASON.RUNTIME_MISSING,
        message: `Kiro CLI not found — install it with: ${installHint()}`,
      };
    }
    this._log(`Kiro CLI resolved: ${bin}`);
    return { ok: true };
  }

  /** Run `--version` and return raw output. Isolated for testing. */
  _readVersionRaw(bin) {
    try {
      return execFileSync(bin, ['--version'], {
        encoding: 'utf-8', timeout: 15000, windowsHide: true, env: getEnhancedEnv(this.agentEnv),
      });
    } catch (e) {
      return (e && (e.stdout || e.stderr)) ? String(e.stdout || e.stderr) : '';
    }
  }

  _checkVersion(bin) {
    const now = Date.now();
    if (this._versionProbe && this._versionProbe.bin === bin && now - this._versionProbe.at < VERSION_PROBE_TTL_MS) {
      return this._versionProbe;
    }
    const verdict = classifyKiroVersion(this._readVersionRaw(bin));
    this._versionProbe = { ...verdict, bin, at: now };
    return this._versionProbe;
  }

  // ------------------------------------------------------------------
  // Workspace MCP server
  // ------------------------------------------------------------------

  /**
   * The workspace MCP server: this package's own CLI, run by the launcher's
   * portable Node when present, else the one running the daemon. Returned in
   * the ACP stdio shape; null when the CLI cannot be located (the turn runs
   * without workspace tools rather than not at all).
   */
  _workspaceMcpServer(channel) {
    const entry = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (!fs.existsSync(entry)) {
      this._log('Could not find the agent-connector CLI — workspace MCP tools are unavailable this run', 'warn');
      return null;
    }
    const args = [
      entry, 'mcp-server',
      '--workspace-id', this.workspaceId,
      '--channel-name', channel,
      '--agent-name', this.agentName,
      '--endpoint', this.endpoint,
    ];
    if (this.disabledModules.has('files')) args.push('--disable-files');
    if (this.disabledModules.has('browser')) args.push('--disable-browser');
    if (this.disabledModules.has('knowledge')) args.push('--disable-knowledge');
    const env = { OA_WORKSPACE_TOKEN: this.token };
    const requester = this.requesterEmailFor(channel);
    if (requester) env.OPENAGENTS_REQUESTER_EMAIL = requester;
    return toAcpMcpServer(WORKSPACE_MCP_NAME, { command: this._nodeBin(), args, env });
  }

  /** The launcher's portable Node when present, else the one running the daemon. */
  _nodeBin() {
    const root = path.join(os.homedir(), '.openagents', 'nodejs');
    const candidates = this._isWindows
      ? [path.join(root, 'node.exe')]
      : [path.join(root, 'node'), path.join(root, 'bin', 'node')];
    return candidates.find((c) => fs.existsSync(c)) || process.execPath;
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  /** Recent channel chat, to seed a fresh session (a resumed one has it). */
  async _buildChannelRecap(channel, currentMessage) {
    try {
      const messages = await this.client.getRecentMessages(this.workspaceId, channel, this.token, 30);
      if (!messages || messages.length === 0) return null;
      const lines = [];
      for (const m of messages) {
        const mt = m.messageType || 'chat';
        if (mt === 'status' || mt === 'thinking' || mt === 'loading' || mt === 'todos') continue;
        const text = (m.content || '').trim();
        if (!text || text === currentMessage) continue;
        const who = m.senderType === 'human' ? (m.senderName || 'user') : (m.senderName || 'agent');
        lines.push(`[${who}] ${truncate(text, 800)}`);
      }
      if (lines.length === 0) return null;
      return 'Recent conversation in this channel for context:\n\n' + lines.slice(-12).join('\n');
    } catch {
      return null;
    }
  }

  _dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  // ------------------------------------------------------------------
  // Shutdown + stop
  // ------------------------------------------------------------------

  stop() {
    super.stop();
    void this._stopAllProcesses('Agent stopped.');
  }

  async _stopAllProcesses(message = 'Execution stopped.') {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running Kiro process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * End a turn's `kiro-cli acp` and everything it started. A turn still
   * running is cancelled through ACP first, so the session records the
   * interruption and stays resumable. Resolves true once the CLI is gone.
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode) return true;
    const run = Object.values(this._channelRuns).find((r) => r && r.proc === proc);
    if (run && run.client && run.sessionId && !run.client.closed && !run.done) {
      run.client.notify('session/cancel', { sessionId: run.sessionId });
      await Promise.race([run.settled, this._sleep(CANCEL_GRACE_MS)]);
    }
    return this._killTree(proc);
  }

  async _killTree(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode) return true;
    if (this._isWindows) {
      this._taskkill(proc.pid);
      let exited = await this._waitExit(proc, STOP_GRACE_MS);
      if (!exited) {
        try { proc.kill(); } catch {}
        exited = await this._waitExit(proc, 1000);
      }
      return exited;
    }

    const groups = new Set([proc.pid]);
    const pids = new Set();
    for (const d of descendantsOf(this._processTable(), proc.pid)) {
      pids.add(d.pid);
      if (d.pgid > 1 && d.pgid !== process.pid) groups.add(d.pgid);
    }
    const signal = (sig) => {
      for (const g of groups) { try { process.kill(-g, sig); } catch {} }
      for (const p of pids) { try { process.kill(p, sig); } catch {} }
      try { proc.kill(sig); } catch {}
    };

    signal('SIGTERM');
    if (await this._waitExit(proc, STOP_GRACE_MS) && ![...pids].some((p) => this._alive(p))) return true;
    signal('SIGKILL');
    return this._waitExit(proc, 1000);
  }

  /** Kill a Windows process tree. Isolated for testing. */
  _taskkill(pid) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 5000, windowsHide: true });
    } catch {}
  }

  /** The process table as { pid, ppid, pgid } rows. Isolated for testing. */
  _processTable() {
    try {
      return parseProcessTable(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf-8', timeout: 3000 }));
    } catch {
      return [];
    }
  }

  _alive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
  }

  _waitExit(proc, ms) {
    return new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode) { resolve(true); return; }
      const t = setTimeout(() => resolve(proc.exitCode !== null || !!proc.signalCode), ms);
      proc.once('exit', () => { clearTimeout(t); resolve(true); });
    });
  }

  // ------------------------------------------------------------------
  // One turn over ACP
  // ------------------------------------------------------------------

  /** Spawn `kiro-cli acp`. Isolated for testing. */
  _spawnKiro(bin, args, { cwd, env }) {
    return spawn(bin, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group: a stop reaches the CLI and the MCP servers it
      // started (its shell commands are walked separately).
      detached: !this._isWindows,
      windowsHide: true,
    });
  }

  /**
   * Run one turn: start the server, open or resume the session, send the
   * prompt, stream its updates into the channel, end the server.
   *
   * @returns {Promise<object>} { stopReason, text, sessionId, anyOutput,
   *   userStopped, staleSession, agentNotFound, error, stderr, watchdog }
   */
  async _runTurn({ channel, bin, args, cwd, env, resumeId, mcpServers, blocks, secrets }) {
    if (this._stoppedBeforeStart(channel)) return { userStopped: true };

    let proc;
    try {
      proc = this._spawnKiro(bin, args, { cwd, env });
    } catch (e) {
      return { spawnError: e && e.message };
    }
    this._log(`Spawning: ${path.basename(bin)} ${args.join(' ')} (cwd=${cwd})`);
    this._channelProcesses[channel] = proc;

    let stderr = '';
    if (proc.stderr) {
      proc.stderr.on('error', () => {});
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => { stderr = truncate(stderr + chunk, STDERR_CAP); });
    }

    let spawnError = null;
    proc.on('error', (e) => { spawnError = e && e.message; });

    // ── stream state ──
    let segment = '';         // text since the last tool call — the reply
    const earlier = [];       // narration before tool calls, kept as a fallback
    let thought = '';
    let anyOutput = false;
    let lastLabel = null;
    let agentNotFound = null;
    const toolsInFlight = new Set();
    const known = {};         // toolCallId → { toolKind, server }
    const announced = new Set();
    let pending = Promise.resolve();
    const post = (fn) => { pending = pending.then(fn).catch(() => {}); };

    const flushThought = () => {
      const t = thought.trim();
      thought = '';
      if (t) post(() => this.sendThinking(channel, redactSecrets(truncate(t, THINKING_PREVIEW), secrets)));
    };
    const flushNarration = () => {
      const t = segment.trim();
      segment = '';
      if (!t) return;
      earlier.push(t);
      post(() => this.sendThinking(channel, redactSecrets(truncate(t, THINKING_PREVIEW), secrets)));
    };

    let lastFrameAt = Date.now();
    const onNotification = (method, params) => {
      if (method === '_kiro.dev/agent/not_found') {
        agentNotFound = params || {};
        return;
      }
      if (method !== 'session/update') return;
      const ev = interpretUpdate(params, secrets);
      if (ev.kind === 'replay' || ev.kind === 'ignore') return;
      anyOutput = true;
      if (ev.kind === 'message') {
        segment += ev.text;
      } else if (ev.kind === 'thought') {
        thought += ev.text;
      } else if (ev.kind === 'tool_start') {
        flushThought();
        flushNarration();
        if (ev.id) {
          toolsInFlight.add(ev.id);
          known[ev.id] = { toolKind: ev.toolKind, server: ev.server };
          if (announced.has(ev.id)) return;
          announced.add(ev.id);
        }
        if (ev.label && ev.label !== lastLabel) {
          lastLabel = ev.label;
          post(() => this.sendStatus(channel, ev.label));
        }
      } else if (ev.kind === 'tool_end') {
        if (ev.id) toolsInFlight.delete(ev.id);
        else toolsInFlight.clear();
      } else if (ev.kind === 'plan') {
        if (ev.todos.length) post(() => this.sendTodos(channel, ev.todos));
      }
    };

    const onRequest = (method, params) => {
      if (method === 'session/request_permission') {
        const id = params && params.toolCall && params.toolCall.toolCallId;
        const answer = permissionOutcome(params, { mode: this._mode, known: id ? known[id] : null });
        if (this._mode === 'plan' && answer.outcome.optionId && /^reject/.test(answer.outcome.optionId)) {
          this._log(`Plan mode: refused ${truncate((params.toolCall && params.toolCall.title) || 'a tool call', 80)}`);
        }
        return answer;
      }
      return undefined; // fs/* and terminal/* are not advertised
    };

    const client = new AcpClient(proc, {
      onNotification,
      onRequest,
      onActivity: () => { lastFrameAt = Date.now(); },
      onUnparsed: (line) => this._log(`Unparsed Kiro output (ignored): ${redactSecrets(truncate(line, 200), secrets)}`),
    });

    let settle;
    const run = { proc, client, sessionId: null, done: false, settled: new Promise((r) => { settle = r; }) };
    this._channelRuns[channel] = run;

    // Watchdog
    let silences = 0;
    let killedByWatchdog = false;
    const watchdog = setInterval(() => {
      if (toolsInFlight.size) { silences = 0; return; }
      if (Date.now() - lastFrameAt < this._watchdogIntervalMs) return;
      silences += 1;
      if (silences === WATCHDOG_NUDGE_AT) post(() => this.sendStatus(channel, 'still working...'));
      if (silences >= this._watchdogMax) {
        this._log('No output for ~5 minutes — ending a wedged Kiro run', 'warn');
        killedByWatchdog = true;
        void this._killTree(proc);
      }
    }, this._watchdogIntervalMs);

    const result = {
      stopReason: null, text: '', sessionId: null, anyOutput: false, userStopped: false,
      staleSession: false, agentNotFound: null, error: null, stderr: '', watchdog: false,
    };

    try {
      const hs = { timeoutMs: this._handshakeTimeoutMs };
      await client.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'openagents', version: this._clientVersion() },
      }, hs);

      let sessionId = null;
      if (resumeId) {
        try {
          await client.request('session/load', { sessionId: resumeId, cwd, mcpServers }, hs);
          sessionId = resumeId;
        } catch (e) {
          if (e instanceof AcpRpcError && isStaleSessionError(e.rpcError)) {
            result.staleSession = true;
            return result;
          }
          throw e;
        }
      } else {
        const created = await client.request('session/new', { cwd, mcpServers }, hs);
        sessionId = created && created.sessionId;
        if (!sessionId) throw new Error('Kiro CLI did not return a session id');
      }
      run.sessionId = sessionId;
      result.sessionId = sessionId;

      if (agentNotFound) {
        result.agentNotFound = agentNotFound;
        return result;
      }
      if (this._stoppingChannels.has(channel)) {
        result.userStopped = true;
        return result;
      }

      const answer = await client.request('session/prompt', { sessionId, prompt: blocks });
      result.stopReason = (answer && answer.stopReason) || 'end_turn';
    } catch (e) {
      result.error = e;
    } finally {
      run.done = true;
      clearInterval(watchdog);
      settle();
      flushThought();
      await pending;
      result.text = segment.trim() || earlier.join('\n\n').trim();
      result.anyOutput = anyOutput;
      result.watchdog = killedByWatchdog;
      result.userStopped = result.userStopped || this._stoppingChannels.has(channel) || result.stopReason === 'cancelled';
      client.close('turn finished');
      await this._killTree(proc);
      if (this._channelProcesses[channel] === proc) delete this._channelProcesses[channel];
      if (this._channelRuns[channel] === run) delete this._channelRuns[channel];
      result.stderr = redactSecrets(stderr, secrets);
      result.exitCode = proc.exitCode;
      // A CLI that never started also fails `initialize`; the spawn error is
      // the one that explains it.
      if (spawnError) result.spawnError = spawnError;
    }
    return result;
  }

  _clientVersion() {
    try { return require('../../package.json').version || '0.0.0'; } catch { return '0.0.0'; }
  }

  // ------------------------------------------------------------------
  // Message handling
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];
    const attText = formatAttachmentsForPrompt(attachments, 'mcp');
    if (attText) content = content ? content + attText : attText.trim();
    if (!content) return;

    const channel = msg.sessionId || this.channelName;
    this._stoppingChannels.delete(channel);
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${channel}: ${this._redact(truncate(content, 80))}`);

    // Never silently fall back to the launcher/repo dir.
    const workingDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    if (this.workingDir && !this._dirExists(this.workingDir)) {
      await this.sendError(channel, `Working directory does not exist: ${this.workingDir}`);
      return;
    }

    const bin = this._findKiroBinary();
    if (!bin) {
      await this.sendError(channel, `Kiro CLI not found. Install it with: ${installHint()}`);
      return;
    }

    const ver = this._checkVersion(bin);
    if (ver.supported === false) {
      this._log(`Refusing to start: Kiro CLI ${ver.version} < minimum ${KIRO_MIN_VERSION}`, 'warn');
      await this.sendError(channel,
        `Kiro CLI ${ver.version} is below the minimum supported version ${KIRO_MIN_VERSION}. `
        + 'Upgrade with: kiro-cli update');
      return;
    }
    if (ver.supported === null) this._log('Could not determine the Kiro CLI version — proceeding leniently');

    // Auto-title + resume-from on first encounter (parity with other adapters).
    if (!this._titledSessions.has(channel)) {
      this._titledSessions.add(channel);
      try {
        const info = await this.client.getSession(this.workspaceId, channel, this.token);
        const resumeFrom = info.resumeFrom;
        if (resumeFrom && !this._channelSessions[channel] && this._channelSessions[resumeFrom]) {
          this._channelSessions[channel] = { ...this._channelSessions[resumeFrom] };
          this._saveSessions();
        }
        const title = generateSessionTitle(content);
        if (title && !info.titleManuallySet && SESSION_DEFAULT_RE.test(info.title || '')) {
          await this.client.updateSession(this.workspaceId, channel, this.token, { title, autoTitle: true });
        }
      } catch {}
    }

    await this.sendStatus(channel, 'thinking...');

    const settings = resolveKiroSettings(this.agentEnv, this.workspaceModel);
    const browserEnabled = await this.getBrowserEnabled();
    const briefing = buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: channel,
      mode: this._mode,
      model: this.modelLabel(),
      browserEnabled,
      toolMode: 'mcp',
      ...this.pinnedPromptOpts(channel),
    });
    const briefingHash = crypto.createHash('sha256').update(briefing).digest('hex').slice(0, 16);

    const env = getEnhancedEnv(this.agentEnv);
    const secrets = this._knownSecrets();
    const args = buildKiroArgs(settings);
    const workspaceServer = this._workspaceMcpServer(channel);
    const mcpServers = workspaceServer ? [workspaceServer] : [];

    // One retry: a remembered session the CLI no longer has is worth
    // re-running fresh rather than failing the message.
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumable = attempt === 0 ? this._resumableSession(channel, workingDir, settings.agent) : null;
      const resumeId = resumable ? resumable.sessionId : null;

      const blocks = [];
      if (!resumable || resumable.briefing !== briefingHash) {
        blocks.push({
          type: 'text',
          text: `<openagents_workspace_briefing>\n${briefing}\n</openagents_workspace_briefing>`,
        });
      }
      if (!resumable) {
        const recap = await this._buildChannelRecap(channel, content);
        if (recap) blocks.push({ type: 'text', text: recap });
      }
      blocks.push({ type: 'text', text: content });

      const run = await this._runTurn({
        channel, bin, args, cwd: workingDir, env, resumeId, mcpServers, blocks, secrets,
      });

      if (run.staleSession) {
        this._log(`Kiro session ${resumeId} is gone — clearing and starting a fresh one`, 'warn');
        this._clearSession(channel);
        if (attempt === 0) {
          await this.sendStatus(channel, 'Previous Kiro session was unavailable — starting a new one.');
          continue;
        }
      }

      const record = run.sessionId
        ? { sessionId: run.sessionId, workingDir, agent: settings.agent, briefing: briefingHash }
        : null;

      if (run.userStopped) {
        // A cancelled session stays resumable, so the channel keeps its thread.
        if (record) this._rememberSession(channel, record);
        return;
      }

      if (run.agentNotFound) {
        this._log(`Kiro agent profile ${settings.agent} not found — turn refused`, 'warn');
        await this.sendError(channel, agentNotFoundMessage(run.agentNotFound, settings.agent));
        return;
      }

      if (run.spawnError) {
        await this.sendError(channel,
          `Kiro CLI could not be started (${redactSecrets(run.spawnError, secrets)}). Reinstall it with: ${installHint()}`);
        return;
      }

      if (run.watchdog) {
        if (record) this._rememberSession(channel, record);
        await this.sendError(channel,
          'Kiro produced no output for about 5 minutes and was stopped. Try a smaller task, or check the CLI on this machine.');
        return;
      }

      if (run.error) {
        // A failure after the model answered still delivers the answer.
        if (record && run.anyOutput) this._rememberSession(channel, record);
        const verdict = this._classifyFailure(run, secrets);
        if (run.text && verdict.kind !== 'auth') {
          await this.sendResponse(channel, `${run.text}\n\n_${verdict.message}_`);
        } else {
          this._log(`Kiro run failed (${verdict.kind}): ${redactSecrets(truncate(run.stderr || '', 300), secrets)}`, 'warn');
          await this.sendError(channel, verdict.message);
        }
        return;
      }

      if (record) this._rememberSession(channel, record);
      const reply = this._finalText(run);
      try { await this.sendResponse(channel, reply); } catch {}
      return;
    }
  }

  /** The reply for a finished turn, with a note when it did not end normally. */
  _finalText(run) {
    const text = run.text || '';
    switch (run.stopReason) {
      case 'max_tokens':
        return `${text || 'Kiro hit its output limit before answering.'}\n\n_Kiro stopped at its output token limit._`.trim();
      case 'max_turn_requests':
        return `${text || 'Kiro hit its turn limit before answering.'}\n\n_Kiro stopped at its per-turn request limit._`.trim();
      case 'refusal':
        return text || 'Kiro declined to answer this request.';
      default:
        return text || 'No response generated. Please try again.';
    }
  }

  /** A failed turn → { kind, message } with Kiro-specific guidance. */
  _classifyFailure(run, secrets) {
    const e = run.error;
    let text = '';
    if (e instanceof AcpRpcError) text = rpcErrorText(e.rpcError);
    else if (e instanceof AcpTimeoutError) text = `${e.message} (timed out)`;
    else if (e instanceof AcpClosedError) text = e.message;
    else text = (e && e.message) || '';
    return classifyRunFailure({
      code: run.exitCode === undefined ? null : run.exitCode,
      stderr: run.stderr,
      error: text,
      cli: 'Kiro CLI',
      guidance: KIRO_GUIDANCE,
      secrets,
      codeLabel: e && e.method ? `${e.method}` : '',
    });
  }
}

module.exports = KiroAdapter;
