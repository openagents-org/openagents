/**
 * OpenWorker adapter for OpenAgents workspace.
 *
 * Bridges OpenWorker (https://github.com/andrewyng/openworker) to an OpenAgents
 * workspace. OpenWorker is a local-first desktop agent, not a headless CLI, so
 * this adapter is shaped unlike every other file in this directory:
 *
 *   ONE SERVER, MANY CHANNELS. `openworker-server` is started once per agent and
 *   shared by every channel, instead of a subprocess per message. Booting it
 *   imports FastAPI, uvicorn, three model SDKs and the MCP client — seconds of
 *   startup that must not be paid on every turn.
 *
 *   THE TURN RUNS OVER A WEBSOCKET. `/ws/session/<id>` carries the event stream
 *   and the reply. We open one socket per turn and close it after `turn_done`:
 *   the engine state lives on the server (keyed by session id, persisted to
 *   disk), so a channel keeps its history across daemon restarts without us
 *   holding sockets open for idle channels.
 *
 *   EVERY PROMPT IS ANSWERED IN LINE. OpenWorker suspends a turn on approvals,
 *   folder grants, questions and plans — indefinitely, waiting on a human. There
 *   is no human on this socket, so `promptReply` answers all of them; an
 *   unanswered prompt is a turn that never ends, not a degraded one.
 *
 *   ITS STATE DIRECTORY IS OURS, NOT THE USER'S. The server runs with
 *   `COWORKER_STATE_DIR` pointed at ~/.openagents, so conversations, secrets and
 *   the SQLite stores of an agent the launcher runs never collide with the
 *   OpenWorker desktop app the user may also have open — two processes writing
 *   one SQLite file is the failure its own `ocw` CLI warns about. A user who
 *   needs the desktop app's sign-ins (a ChatGPT subscription, OAuth connectors)
 *   points OPENWORKER_STATE_DIR at that directory deliberately.
 *
 * The API key is passed in the server's ENVIRONMENT and referenced from the
 * profile we write as `${OPENWORKER_API_KEY}` — OpenWorker's SecretStore
 * resolves `${VAR}` refs at read time, so the key never lands on disk.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildOpenWorkerSystemPrompt } = require('./workspace-prompt');
const {
  defaultAgentWorkdir,
  whichBinary,
  whereBinary,
  getEnhancedEnv,
  uvToolBinDirs,
  IS_WINDOWS,
} = require('../paths');
const {
  PROVIDERS,
  DEFAULT_PROVIDER,
  normalizeProvider,
  providerKeyEnv,
  qualifyModel,
  resolveServerMode,
  buildServerArgs,
  buildSecretsProfiles,
  sessionIdFor,
  sessionUrl,
  interpretEvent,
  toolLabel,
  promptReply,
  promptSummary,
  classifyServerFailure,
  missingKeyMessage,
  redactSecrets,
  truncate,
} = require('./openworker-runtime');

// The command `uv tool install git+…/openworker` puts on PATH. `openworker`
// itself is the Textual TUI — never spawn that one, it wants a terminal.
const SERVER_BIN = 'openworker-server';

// uv/pipx key their tool directory by the DISTRIBUTION name, which is `coworker`
// (see pyproject.toml `[project] name`), not the repo or command name.
const DIST_NAME = 'coworker';

const INSTALL_HINT = 'uv tool install git+https://github.com/andrewyng/openworker';

// The server imports FastAPI, uvicorn and three model SDKs before it answers
// /v1/health. On a cold first run that is genuinely slow, and timing out early
// reports "not installed" for a server that was seconds from being ready.
const SERVER_READY_TIMEOUT_MS = 90000;
const HEALTH_POLL_INTERVAL_MS = 400;

// Max wall-clock for one turn, after which we interrupt and report it.
const TURN_TIMEOUT_MS = 900000; // 15 minutes

// Idle watchdog over the event stream, in the same shape the CLI adapters use.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2; // ~30s quiet → "still working"
const WATCHDOG_MAX = 20;     // ~5 min quiet → give up on the turn

/**
 * `ws`, loaded on first use.
 *
 * This module is required through adapters/index.js, which every adapter, the
 * CLI and the daemon load — so a top-level require would turn "the ws package is
 * missing" into "no agent of any type can start". Deferring it keeps the failure
 * where it belongs: on an OpenWorker turn, with a message naming the cause.
 */
let _WebSocket = null;
function loadWebSocket() {
  if (_WebSocket) return _WebSocket;
  _WebSocket = require('ws');
  return _WebSocket;
}

class OpenWorkerAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    // The shared server: { proc, port, token, stateDir, workingDir, stderr }.
    this._server = null;
    this._serverStarting = null; // in-flight _ensureServer promise, so channels share one boot
    this._serverStopped = false;

    // channel → { sessionId, workingDir, seeded }
    this._channelSessions = {};
    // channel → the live WebSocket of an in-flight turn
    this._channelSockets = {};
    this._stoppingChannels = new Set();

    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_openworker.json`,
    );
    this._loadSessions();
  }

  // ------------------------------------------------------------------
  // Session bookkeeping
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} OpenWorker session binding(s)`);
        }
      }
    } catch {
      this._log('Could not load the OpenWorker session file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * The server-side session for a channel, and whether it still needs seeding.
   *
   * The id is DERIVED from the channel (not stored), so a channel reconnects to
   * the same server-side conversation after a restart. What is stored is whether
   * we already seeded that conversation with the workspace prompt, and under
   * which working directory — a changed directory invalidates both the seed and
   * the engine's root, so the session starts again.
   */
  _sessionFor(channel, workingDir) {
    const sessionId = sessionIdFor(this.workspaceId, this.agentName, channel);
    const entry = this._channelSessions[channel];
    const seeded = !!(entry && entry.seeded && entry.workingDir === workingDir && entry.sessionId === sessionId);
    return { sessionId, seeded };
  }

  _markSeeded(channel, sessionId, workingDir) {
    const prev = this._channelSessions[channel];
    if (prev && prev.seeded && prev.sessionId === sessionId && prev.workingDir === workingDir) return;
    this._channelSessions[channel] = { sessionId, workingDir, seeded: true };
    this._saveSessions();
  }

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------

  _provider() {
    return normalizeProvider(this.agentEnv.OPENWORKER_PROVIDER) || DEFAULT_PROVIDER;
  }

  _apiKey() {
    return String(this.agentEnv.OPENWORKER_API_KEY || '').trim();
  }

  /** The model for a turn: the workspace's selection wins over the saved env. */
  _model() {
    const raw = String(this.workspaceModel || this.agentEnv.OPENWORKER_MODEL || '').trim();
    return qualifyModel(raw, this._provider());
  }

  /**
   * Where the server keeps its state.
   *
   * Ours by default, one directory per (workspace, agent) so two agents in the
   * same workspace never share a conversation store. An explicit
   * OPENWORKER_STATE_DIR is honoured verbatim — that is the escape hatch for
   * reusing the desktop app's sign-ins, and we then leave every file in it alone.
   */
  _stateDir() {
    const override = String(this.agentEnv.OPENWORKER_STATE_DIR || '').trim();
    if (override) return { dir: path.resolve(override.replace(/^~(?=$|\/|\\)/, os.homedir())), owned: false };
    const slug = `${this.workspaceId}_${this.agentName}`.replace(/[^A-Za-z0-9._-]/g, '_');
    return { dir: path.join(os.homedir(), '.openagents', 'openworker', slug), owned: true };
  }

  /**
   * Create the state dir and write the provider profile into it.
   *
   * Only a directory we own is written to. The key is stored as a `${VAR}`
   * reference rather than a literal, so the file carries no secret even at 0600.
   */
  _provisionStateDir() {
    const { dir, owned } = this._stateDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!owned) return dir;

    const profiles = buildSecretsProfiles({
      provider: this._provider(),
      keyRefVar: this._apiKey() ? 'OPENWORKER_API_KEY' : '',
      baseUrl: this.agentEnv.OPENWORKER_BASE_URL,
    });
    const file = path.join(dir, 'secrets.json');
    if (!profiles) return dir;

    // Merge, never clobber: the directory also holds profiles OpenWorker itself
    // wrote (MCP OAuth tokens, connector credentials) and a blind overwrite
    // would sign the agent out of all of them.
    let store = {};
    try {
      if (fs.existsSync(file)) store = JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
    } catch {
      store = {};
    }
    const next = { ...store, ...profiles };
    try {
      fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch {}
    } catch (e) {
      this._log(`Could not write the OpenWorker provider profile: ${redactSecrets(e && e.message)}`);
    }
    return dir;
  }

  // ------------------------------------------------------------------
  // Binary resolution
  // ------------------------------------------------------------------

  /**
   * Locate `openworker-server`.
   *
   * OpenWorker ships no npm package and is not on PyPI, so there is no isolated
   * runtime prefix to check first the way the npm-installed agents have. The
   * tiers below are the places `uv tool install`, pipx and the project's own
   * `packaging/setup_dev_env.sh` actually put it.
   */
  _findServerBinary() {
    const override = String(this.agentEnv.OPENWORKER_SERVER_BIN || '').trim();
    if (override && fs.existsSync(override)) return override;

    const home = os.homedir();
    const ext = IS_WINDOWS ? '.exe' : '';
    const name = `${SERVER_BIN}${ext}`;

    // Tier 0: the uv tools venv — the executable lands here on a successful
    // `uv tool install` even when the bin-dir copy or PATH edit did not happen.
    for (const dir of uvToolBinDirs(DIST_NAME)) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }

    // Tier 1: PATH, via the codepage-safe lookup (a non-ASCII username would
    // otherwise come back mangled and fail with ENOENT).
    const viaWhere = whereBinary(SERVER_BIN);
    if (viaWhere) return viaWhere;

    // Tier 2: pipx, and a from-source checkout's venv (setup_dev_env.sh).
    const venvBin = IS_WINDOWS ? 'Scripts' : 'bin';
    const candidates = [
      path.join(home, '.local', 'pipx', 'venvs', DIST_NAME, venvBin, name),
      path.join(home, '.openagents', 'runtimes', 'openworker', 'openworker', '.venv', venvBin, name),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;

    // Tier 3: the deep scan of every known bin dir.
    return whichBinary(SERVER_BIN);
  }

  /**
   * Preflight gate, run by the daemon before it joins the workspace: no server
   * binary means every message would fail identically, so say so once here
   * instead of once per message.
   */
  preflight() {
    if (this._findServerBinary()) return { ok: true };
    return {
      ok: false,
      reason: 'runtime_missing',
      message: `OpenWorker is not installed (${SERVER_BIN} not found). Install it with: ${INSTALL_HINT}`,
    };
  }

  // ------------------------------------------------------------------
  // Server lifecycle
  // ------------------------------------------------------------------

  /** An ephemeral port the OS just told us is free. */
  _freePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
    });
  }

  /** The environment the server runs under. */
  _serverEnv(stateDir, token) {
    const env = getEnhancedEnv(this.agentEnv);
    env.COWORKER_STATE_DIR = stateDir;
    // Supplying the token ourselves means the server never writes a
    // `sidecar-<port>.token` file, so there is no file to race with or clean up.
    env.COWORKER_API_TOKEN = token;
    // Die with the daemon, even on a kill that skips our own cleanup.
    env.COWORKER_EXIT_WITH_PARENT = '1';
    env.COWORKER_PARENT_PID = String(process.pid);

    const key = this._apiKey();
    if (key) {
      // Two destinations, both needed: OpenWorker's provider code reads the
      // vendor variable first, and the profile we wrote references
      // OPENWORKER_API_KEY for the providers that only look at the store.
      env.OPENWORKER_API_KEY = key;
      const vendorVar = providerKeyEnv(this._provider());
      if (vendorVar) env[vendorVar] = key;
    }
    return env;
  }

  /**
   * Start the shared server (or return the running one).
   *
   * Concurrent channels funnel through a single in-flight promise: two messages
   * arriving together must not race two servers onto two ports.
   */
  async _ensureServer(workingDir) {
    if (this._server && this._server.proc && this._server.proc.exitCode === null
        && this._server.workingDir === workingDir) {
      return this._server;
    }
    if (this._serverStarting) return this._serverStarting;

    this._serverStarting = this._startServer(workingDir).finally(() => {
      this._serverStarting = null;
    });
    return this._serverStarting;
  }

  async _startServer(workingDir) {
    // A working directory change re-roots every session, so the old server goes.
    if (this._server) this._stopServer();

    const bin = this._findServerBinary();
    if (!bin) {
      const err = new Error(`openworker-server not found. Install OpenWorker with: ${INSTALL_HINT}`);
      err.userMessage = err.message;
      throw err;
    }

    const stateDir = this._provisionStateDir();
    const token = crypto.randomBytes(32).toString('hex');
    const port = await this._freePort();
    const args = buildServerArgs({
      host: '127.0.0.1',
      port,
      cwd: workingDir,
      model: this._model(),
      mode: resolveServerMode('execute', this.agentEnv.OPENWORKER_MODE),
    });

    this._log(`Starting ${SERVER_BIN} on 127.0.0.1:${port} (cwd=${workingDir}, state=${stateDir})`);

    let proc;
    try {
      proc = spawn(bin, args, {
        cwd: workingDir,
        env: this._serverEnv(stateDir, token),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !IS_WINDOWS, // own process group, so its own children die with it
        windowsHide: true,
      });
    } catch (e) {
      const verdict = classifyServerFailure({ spawnError: e && e.message });
      const err = new Error(verdict.message);
      err.userMessage = verdict.message;
      throw err;
    }

    const server = { proc, port, token, stateDir, workingDir, stderr: '', exited: null };
    this._server = server;

    // Bounded: uvicorn logs every request, and a long-lived server must not grow
    // an unbounded buffer just so a failure message can quote the tail.
    const capture = (chunk) => {
      server.stderr = truncate(server.stderr + chunk.toString('utf-8'), 8000);
    };
    if (proc.stdout) proc.stdout.on('data', capture);
    if (proc.stderr) proc.stderr.on('data', capture);
    proc.on('error', (e) => { server.spawnError = e && e.message; });
    proc.on('exit', (code, signal) => {
      server.exited = { code, signal };
      if (this._server === server) this._server = null;
      if (!this._serverStopped) this._log(`${SERVER_BIN} exited (code=${code}, signal=${signal})`);
    });

    try {
      await this._waitForHealth(server);
    } catch (e) {
      this._stopServer(server);
      throw e;
    }
    this._log(`${SERVER_BIN} is ready on port ${port}`);
    return server;
  }

  /** Poll /v1/health until the server answers, it dies, or we run out of patience. */
  async _waitForHealth(server) {
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    for (;;) {
      if (server.exited || server.spawnError) {
        const verdict = classifyServerFailure({
          code: server.exited ? server.exited.code : null,
          signal: server.exited ? server.exited.signal : null,
          stderr: server.stderr,
          spawnError: server.spawnError || '',
        });
        const err = new Error(verdict.message);
        err.userMessage = verdict.message;
        throw err;
      }
      if (await this._probeHealth(server)) return;
      if (Date.now() >= deadline) {
        const message =
          `The OpenWorker server did not start within ${Math.round(SERVER_READY_TIMEOUT_MS / 1000)}s. ` +
          (truncate(redactSecrets(server.stderr).trim(), 400) || 'It produced no output.');
        const err = new Error(message);
        err.userMessage = message;
        throw err;
      }
      await this._sleep(HEALTH_POLL_INTERVAL_MS);
    }
  }

  _probeHealth(server) {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/v1/health',
          method: 'GET',
          headers: { 'X-OpenWorker-Token': server.token },
          timeout: 3000,
        },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  /** Stop the server, escalating from the process group to a hard kill. */
  _stopServer(target) {
    const server = target || this._server;
    if (!server || !server.proc) return;
    const { proc } = server;
    if (this._server === server) this._server = null;
    if (proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { timeout: 5000, windowsHide: true }); } catch {}
      } else {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
        // The server's own orphan watchdog also exits it, so a SIGKILL chaser is
        // a belt-and-braces timer rather than the primary path.
        setTimeout(() => {
          if (proc.exitCode === null) {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
          }
        }, 3000).unref();
      }
    } catch {}
  }

  // ------------------------------------------------------------------
  // Control actions (stop / restart)
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && payload.channel) || null;
      if (channel) {
        await this._stopChannel(channel, 'Execution stopped.');
        return;
      }
      await this._stopAllChannels();
      return;
    }
    return super._onControlAction(action, payload);
  }

  stop() {
    super.stop();
    this._serverStopped = true;
    void this._stopAllChannels('Agent stopped.').finally(() => this._stopServer());
  }

  async _stopChannel(channel, message) {
    const socket = this._channelSockets[channel];
    if (!socket) return;
    this._stoppingChannels.add(channel);
    try { socket.send(JSON.stringify({ type: 'interrupt' })); } catch {}
    // Give the engine a moment to unwind the current tool before the socket goes.
    await this._sleep(500);
    try { socket.close(); } catch {}
    delete this._channelSockets[channel];
    delete this._channelQueues[channel];
    if (message) { try { await this.sendResponse(channel, message); } catch {} }
  }

  async _stopAllChannels(message = 'Execution stopped.') {
    const channels = Object.keys(this._channelSockets);
    if (!channels.length) return;
    this._log(`Stopping ${channels.length} running OpenWorker turn(s)...`);
    for (const channel of channels) await this._stopChannel(channel, message);
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  /**
   * The workspace briefing, prepended to the FIRST message of a session.
   *
   * OpenWorker has no `--append-system-prompt` and no skill directory we could
   * write to without touching the user's own config, so the briefing rides in
   * the conversation itself. That is durable rather than wasteful: the server
   * persists history, so the block is sent once per session and every later turn
   * still has it in context.
   */
  async _seedPrompt(channel) {
    const browserEnabled = await this.getBrowserEnabled();
    return buildOpenWorkerSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: channel,
      endpoint: this.endpoint,
      token: this.token,
      mode: this._mode,
      disabledModules: this.disabledModules,
      browserEnabled,
    });
  }

  /** Short transcript of recent channel chat, to seed a fresh session. */
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

  // ------------------------------------------------------------------
  // One turn over the session WebSocket
  // ------------------------------------------------------------------

  /**
   * Run one turn and resolve with what came back.
   *
   * @returns {Promise<object>} { texts, error, interrupted, userStopped, sent }
   */
  _runTurn(channel, server, sessionId, workingDir, text, { planMode, model }) {
    return new Promise((resolve) => {
      const url = sessionUrl({
        port: server.port,
        sessionId,
        workspace: workingDir,
        agent: 'code',
      });

      // Both subprotocols are required. The token is what `_websocket_authenticated`
      // matches against, and `openworker` is what the server ECHOES back on accept
      // — a client that offered only the token would reject the handshake locally
      // because the server picked a protocol it never proposed.
      let socket;
      try {
        const WS = loadWebSocket();
        socket = new WS(url, ['openworker', server.token], { handshakeTimeout: 15000 });
      } catch (e) {
        resolve({ texts: [], error: `Could not open the OpenWorker session: ${redactSecrets(e && e.message)}` });
        return;
      }
      this._channelSockets[channel] = socket;

      const texts = [];
      let settled = false;
      let error = null;
      let interrupted = false;
      let lastEventAt = Date.now();
      let silences = 0;
      let lastToolName = null;
      let sentMessage = false;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        clearTimeout(timeout);
        if (this._channelSockets[channel] === socket) delete this._channelSockets[channel];
        try { socket.close(); } catch {}
        const userStopped = this._stoppingChannels.has(channel);
        this._stoppingChannels.delete(channel);
        resolve({ texts, error, interrupted, userStopped, sent: sentMessage, ...payload });
      };

      const send = (frame) => {
        try { socket.send(JSON.stringify(frame)); } catch {}
      };

      const sendTurn = () => {
        if (sentMessage) return;
        sentMessage = true;
        // Anything observed before this point belongs to the turn we cleared out
        // of the way (see the `ready.running` branch), not to ours — carrying it
        // forward would label a perfectly good answer as interrupted.
        interrupted = false;
        error = null;
        send({ type: 'user_message', text });
      };

      socket.on('open', () => { lastEventAt = Date.now(); });

      socket.on('message', (raw) => {
        lastEventAt = Date.now();
        silences = 0;

        let frame;
        try {
          frame = JSON.parse(raw.toString('utf-8'));
        } catch {
          this._log(`Ignoring an unparseable frame: ${truncate(String(raw), 200)}`);
          return;
        }

        const ev = interpretEvent(frame);
        switch (ev.kind) {
          case 'ready': {
            // A turn already marked running is a session the previous daemon left
            // mid-flight. Interrupting first is what makes a restart recoverable —
            // otherwise every message on this channel is rejected forever.
            if (ev.running) {
              this._log(`Session ${sessionId} was still running a turn — interrupting it first`);
              send({ type: 'interrupt' });
              return; // the resulting turn_done sends ours
            }
            if (model && ev.model !== model) send({ type: 'set_model', model });
            const wantMode = resolveServerMode(planMode ? 'plan' : 'execute', this.agentEnv.OPENWORKER_MODE);
            if (ev.mode !== wantMode) send({ type: 'set_mode', mode: wantMode });
            sendTurn();
            return;
          }
          case 'text': {
            const body = (ev.text || '').trim();
            if (body) texts.push(body);
            return;
          }
          case 'tool': {
            if (ev.phase === 'started' && ev.name && ev.name !== lastToolName) {
              lastToolName = ev.name;
              void this.sendStatus(channel, toolLabel(ev.name)).catch(() => {});
            }
            return;
          }
          case 'prompt': {
            const reply = promptReply(ev, {
              planMode,
              workingDir,
              allowToolInstall: String(this.agentEnv.OPENWORKER_ALLOW_TOOL_INSTALL || '') === '1',
            });
            const summary = promptSummary(ev);
            // Say what was decided on the user's behalf. A question in particular
            // is information they would otherwise never see.
            if (summary) void this.sendStatus(channel, summary).catch(() => {});
            if (reply) send(reply);
            else this._log(`Unanswerable prompt frame (turn may stall): ${ev.prompt}`);
            return;
          }
          case 'error': {
            error = ev.message;
            return;
          }
          case 'rejected': {
            // Not a provider failure: the server refused the frame itself (rate
            // limit, oversized text, a turn already running).
            error = ev.message;
            finish({});
            return;
          }
          case 'interrupted': {
            interrupted = true;
            return;
          }
          case 'notice': {
            if (ev.text) this._log(`Server notice: ${truncate(ev.text, 200)}`);
            return;
          }
          case 'done': {
            // A `turn_done` before we sent anything is the interrupt above
            // completing — send the real message now.
            if (!sentMessage) { sendTurn(); return; }
            finish({});
            return;
          }
          case 'unknown': {
            this._log(`Unrecognized frame (ignored): ${ev.raw}`);
            return;
          }
          default:
        }
      });

      socket.on('error', (e) => {
        if (!error) error = `OpenWorker session error: ${redactSecrets(e && e.message)}`;
        finish({});
      });

      socket.on('close', (code) => {
        if (!settled && !error && code !== 1000 && code !== 1005) {
          error = code === 1008
            ? 'The OpenWorker server rejected the session (authentication or origin check failed).'
            : `The OpenWorker session closed unexpectedly (code ${code}).`;
        }
        finish({});
      });

      const watchdog = setInterval(() => {
        if (Date.now() - lastEventAt < WATCHDOG_INTERVAL_MS) return;
        silences += 1;
        if (silences === WATCHDOG_NUDGE_AT) {
          void this.sendStatus(channel, 'still working...').catch(() => {});
        }
        if (silences >= WATCHDOG_MAX) {
          this._log('No events for ~5 minutes — interrupting a wedged turn');
          send({ type: 'interrupt' });
          if (!error) error = 'The turn produced no output for five minutes and was stopped.';
          finish({});
        }
      }, WATCHDOG_INTERVAL_MS);

      const timeout = setTimeout(() => {
        this._log(`Turn exceeded ${TURN_TIMEOUT_MS}ms — interrupting`);
        send({ type: 'interrupt' });
        if (!error) error = 'The turn ran past its time limit and was stopped.';
        finish({});
      }, TURN_TIMEOUT_MS);
    });
  }

  _dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  // ------------------------------------------------------------------
  // Message handling
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];
    const attText = formatAttachmentsForPrompt(attachments, 'skills');
    if (attText) content = content ? content + attText : attText.trim();
    if (!content) return;

    const channel = msg.sessionId || this.channelName;
    this._stoppingChannels.delete(channel);
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${channel}: ${redactSecrets(truncate(content, 80))}`);

    // Resolve the working directory up front. Never silently fall back to the
    // launcher/repo dir — a wrong cwd is a destructive surprise, not a default.
    const workingDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    if (this.workingDir && !this._dirExists(this.workingDir)) {
      await this.sendError(channel, `Working directory does not exist: ${this.workingDir}`);
      return;
    }

    const provider = this._provider();
    if (!this._apiKey() && PROVIDERS[provider] && PROVIDERS[provider].needsKey) {
      await this.sendError(channel, missingKeyMessage(provider));
      return;
    }

    // Auto-title + resume-from on first encounter (parity with other adapters).
    if (!this._titledSessions.has(channel)) {
      this._titledSessions.add(channel);
      try {
        const info = await this.client.getSession(this.workspaceId, channel, this.token);
        const title = generateSessionTitle(content);
        if (title && !info.titleManuallySet && SESSION_DEFAULT_RE.test(info.title || '')) {
          await this.client.updateSession(this.workspaceId, channel, this.token, { title, autoTitle: true });
        }
      } catch {}
    }

    await this.sendStatus(channel, 'thinking...');

    let server;
    try {
      server = await this._ensureServer(workingDir);
    } catch (e) {
      await this.sendError(channel, e && e.userMessage ? e.userMessage : redactSecrets(e && e.message));
      return;
    }

    const { sessionId, seeded } = this._sessionFor(channel, workingDir);
    const planMode = this._mode === 'plan';

    let text = content;
    if (!seeded) {
      const header = await this._seedPrompt(channel);
      const recap = await this._buildChannelRecap(channel, content);
      text = recap
        ? `${header}\n\n${recap}\n\n---\n\n${content}`
        : `${header}\n\n${content}`;
    }

    const run = await this._runTurn(channel, server, sessionId, workingDir, text, {
      planMode,
      model: this._model(),
    });

    if (run.userStopped) return;

    // The briefing is recorded as delivered only once the server actually took
    // the message. A handshake that never connected must not leave the session
    // marked briefed — the agent would then run without ever being told what
    // workspace it is in.
    if (!seeded && run.sent) this._markSeeded(channel, sessionId, workingDir);

    const reply = run.texts.join('\n\n').trim();

    if (reply) {
      // A partial answer is still an answer: deliver it with the reason it
      // stopped appended, rather than replacing it with an error.
      const suffix = run.interrupted
        ? '_The turn was interrupted before it finished._'
        : run.error
          ? `_${redactSecrets(run.error)}_`
          : '';
      try { await this.sendResponse(channel, suffix ? `${reply}\n\n${suffix}` : reply); } catch {}
      return;
    }

    if (run.error) {
      try { await this.sendError(channel, redactSecrets(run.error)); } catch {}
      return;
    }

    if (run.interrupted) {
      try { await this.sendResponse(channel, 'The turn was interrupted before it produced an answer.'); } catch {}
      return;
    }

    try { await this.sendResponse(channel, 'No response generated. Please try again.'); } catch {}
  }
}

module.exports = OpenWorkerAdapter;
