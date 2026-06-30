/**
 * Cline CLI adapter for OpenAgents workspace.
 *
 * Bridges the Cline CLI (https://github.com/cline/cline, `npm i -g cline`) to an
 * OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one `cline --json` subprocess per user message (Cline runs the agent loop
 *     in-process for a one-shot run; killing the process tree stops the task)
 *   - the NDJSON event stream is parsed (see cline-stream.js) and mapped to the
 *     standard OpenAgents events (thinking / status / todos / response / error)
 *   - real session continuity via Cline's `--id` resume, correlated from
 *     `cline history --json` (Cline does not emit the session id inline)
 *
 * Cline-specific behavior lives here and in cline-stream.js; the shared
 * connectivity, queuing, redaction patterns and process-group teardown follow
 * the same conventions as the Claude/Gemini adapters.
 *
 * Minimum supported CLI is 3.0.0 (HARD gate): a confirmed-older CLI refuses to
 * start; an undetermined version proceeds leniently.
 *
 * Verified against Cline CLI v3.0.26 / v3.0.27.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFile, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { defaultAgentWorkdir, whichBinary, whereBinary } = require('../paths');
const {
  ClineStreamParser,
  interpretClineEnvelope,
  buildClineArgs,
  redactArgs,
  redactSecrets,
  classifyClineError,
  classifyClineAuth,
  classifyClineVersion,
  pickClineSessionId,
  MIN_CLINE_VERSION,
} = require('./cline-stream');

const IS_WINDOWS = process.platform === 'win32';

// Idle watchdog: if stdout is silent this long while a run is in flight we
// nudge the user; after MAX consecutive silences we kill the (possibly hung)
// process. Cline can hang on connection errors without exiting, so this is the
// backstop that prevents a thread spinning on "thinking…" forever.
const WATCHDOG_INTERVAL_MS = 15_000;
const WATCHDOG_NUDGE_AT = 2;     // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;         // ~5 min of silence → kill

// The ONE known-benign stderr {type:"error"} diagnostic Cline emits on every
// run (verified v3.0.27). Matched EXACTLY (whole, trimmed message) so it can
// never swallow a real error that merely starts with "hook dispatch failed:".
const BENIGN_STDERR_RE = /^hook dispatch failed: session\.hook requires a valid hook event payload\.?$/i;

// Cline version check cache: keyed by resolved binary path so it is shared
// across messages (no `cline --version` per status refresh) yet re-detects
// after the TTL — short enough that an install/upgrade isn't masked for long.
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const _clineVersionCache = new Map(); // binPath -> { version, supported, at }

class ClineAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    // channel → { sessionId, workingDir }
    this._channelSessions = {};
    // channel → child process (the in-flight `cline` run)
    this._channelProcesses = {};
    this._stoppingChannels = new Set();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_cline.json`,
    );
    this._loadSessions();
  }

  // ------------------------------------------------------------------
  // Session persistence (real Cline session ids, bound to working dir)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Cline session(s)`);
        }
      }
    } catch {
      this._log('Could not load Cline sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /** Return a valid saved session id for this channel, or null. Only resume
   *  when the saved working dir matches the current one (don't cross projects). */
  _resumableSession(channel, workingDir) {
    const entry = this._channelSessions[channel];
    if (!entry || !entry.sessionId) return null;
    if (entry.workingDir && workingDir && entry.workingDir !== workingDir) return null;
    return entry.sessionId;
  }

  _clearSession(channel) {
    if (this._channelSessions[channel]) {
      delete this._channelSessions[channel];
      this._saveSessions();
    }
  }

  // ------------------------------------------------------------------
  // Control actions (stop / restart)
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel && this._channelProcesses[channel]) {
        this._stoppingChannels.add(channel);
        await this._stopProcess(this._channelProcesses[channel]);
        delete this._channelProcesses[channel];
        delete this._channelQueues[channel];
        try { await this.sendResponse(channel, 'Execution stopped by user.'); } catch {}
      } else {
        await this._stopAllProcesses('Execution stopped by user.');
      }
      return;
    }
    if (action === 'restart') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        if (this._channelProcesses[channel]) {
          try { await this._stopProcess(this._channelProcesses[channel]); } catch {}
          delete this._channelProcesses[channel];
        }
        this._clearSession(channel);
        try {
          await this.client.sendMessage(this.workspaceId, channel, this.token,
            'Session restarted — next message starts a fresh Cline session.',
            { senderType: 'agent', senderName: this.agentName, messageType: 'status',
              metadata: { agent_mode: this._mode }, sessionId: this._sessionId });
        } catch {}
      } else {
        this._channelSessions = {};
        this._saveSessions();
        await this._stopAllProcesses('Execution stopped.');
      }
      return;
    }
    await super._onControlAction(action, payload);
  }

  /** Daemon shutdown — tear down any in-flight cline runs so threads don't
   *  hang showing "running". Fire-and-forget; the daemon allows a short grace. */
  stop() {
    this._stopAllProcesses(
      'Task interrupted — daemon restarting. Send another message to continue.',
    ).catch(() => {});
    super.stop();
  }

  async _stopAllProcesses(message = 'Execution stopped.') {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running Cline process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * Stop a cline process tree gracefully then forcefully. We SIGINT first
   * (Cline's documented graceful-abort signal) so it can wind down its tool
   * work, then escalate to SIGTERM/SIGKILL on the whole POSIX process group
   * (the node wrapper + the bun worker share the group) or via `taskkill /T`
   * on Windows. The shared `cline --cline-hub-daemon` (ppid=1, its own group)
   * is intentionally left running — it is per-cwd infrastructure shared across
   * runs, like a language server; `cline doctor fix` clears stale ones.
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { proc.kill('SIGINT'); } catch {}
        const exited = await this._waitExit(proc, 1500);
        if (!exited) {
          try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000, windowsHide: true }); } catch {}
        }
      } else {
        try { process.kill(-proc.pid, 'SIGINT'); } catch { try { proc.kill('SIGINT'); } catch {} }
        let exited = await this._waitExit(proc, 1500);
        if (!exited) {
          try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
          exited = await this._waitExit(proc, 1500);
        }
        if (!exited) {
          try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
          await this._waitExit(proc, 1000);
        }
      }
    } catch {}
  }

  _waitExit(proc, ms) {
    return new Promise((resolve) => {
      if (proc.exitCode !== null) { resolve(true); return; }
      const t = setTimeout(() => resolve(false), ms);
      proc.once('exit', () => { clearTimeout(t); resolve(true); });
    });
  }

  // ------------------------------------------------------------------
  // Binary resolution (cross-platform; mirrors the Claude/Gemini adapters)
  // ------------------------------------------------------------------

  _findNodeBin() {
    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'),
         path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    // Fall back to the node already running this daemon (absolute, always valid).
    // Bare 'node' can be off-PATH in a packaged daemon or CI runner.
    return process.execPath;
  }

  /**
   * Resolve a shim/symlink to [nodeBin, jsEntry] so we spawn the JS wrapper
   * directly. On Windows this avoids wrapping a `.cmd` in `cmd.exe /c`, whose
   * 8191-char command-line cap would truncate a long prompt. Cline's
   * `bin/cline` IS a Node script (it re-spawns the bundled native binary), so
   * running it under node is the most robust path on every OS.
   */
  _resolveToNodeCmd(binPath) {
    const nodeBin = this._findNodeBin();
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) {
      try {
        const cmdDir = path.dirname(path.resolve(binPath));
        const content = fs.readFileSync(binPath, 'utf-8');
        const jsMatch = content.match(/%dp0%\\([^\s"*?]+\.m?js)/i);
        if (jsMatch) return [nodeBin, path.resolve(cmdDir, jsMatch[1])];
        const exeMatch = content.match(/%dp0%\\([^\s"*?]+\.exe)/i);
        if (exeMatch) return [path.resolve(cmdDir, exeMatch[1])];
      } catch {}
    } else {
      try {
        let target = binPath;
        if (fs.lstatSync(binPath).isSymbolicLink()) {
          target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
        }
        if (target.endsWith('.js') || target.endsWith('.mjs')) return [nodeBin, target];
        // Cline's package bin (`node_modules/cline/bin/cline`) is an
        // extensionless Node script with a `#!/usr/bin/env node` shebang. Run
        // it under node explicitly — required on Windows (no shebang support)
        // and harmless elsewhere.
        if (this._isNodeShebangScript(target)) return [nodeBin, target];
      } catch {}
    }
    return null;
  }

  /** True when a file begins with a `#!...node` shebang. */
  _isNodeShebangScript(filePath) {
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(64);
        const n = fs.readSync(fd, buf, 0, 64, 0);
        const head = buf.slice(0, n).toString('utf-8');
        return head.startsWith('#!') && /\bnode\b/.test(head.split('\n')[0]);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }
  }

  _findClineBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';

    // Tier 0: isolated runtime prefix (~/.openagents/runtimes/cline/)
    const runtimeCandidate = path.join(home, '.openagents', 'runtimes', 'cline', 'node_modules', '.bin', `cline${ext}`);
    if (fs.existsSync(runtimeCandidate)) return runtimeCandidate;

    // Tier 0b: legacy portable install
    const portable = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `cline${ext}`);
    if (fs.existsSync(portable)) return portable;

    // Tier 0c: the package's OWN bin. npm does not create a node_modules/.bin
    // shim for Cline (its `bin` is "./bin/cline"), so a local prefix install
    // leaves no `.bin/cline` — but the package bin is always present and is a
    // Node script we run via _resolveToNodeCmd. Check the runtime then legacy
    // prefix.
    for (const root of [
      path.join(home, '.openagents', 'runtimes', 'cline', 'node_modules', 'cline'),
      path.join(home, '.openagents', 'nodejs', 'node_modules', 'cline'),
    ]) {
      const pkgBin = path.join(root, 'bin', 'cline');
      if (fs.existsSync(pkgBin)) return pkgBin;
    }

    // Tier 1: PATH search via a codepage-safe lookup (whereBinary forces UTF-8
    // output + verifies existence so a non-ASCII/Chinese username isn't mangled
    // into an ENOENT). Uses the ENRICHED env (a packaged daemon's PATH is
    // minimal and would miss nvm/fnm/volta/homebrew/npm-global dirs).
    const viaWhere = whereBinary('cline');
    if (viaWhere) return viaWhere;

    // Tier 2: next to the current Node interpreter (npm global)
    const nearNode = path.join(path.dirname(process.execPath), `cline${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: common install locations
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'cline.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'cline'),
      path.join(home, '.npm-global', 'bin', 'cline'),
      '/opt/homebrew/bin/cline',
      '/usr/local/bin/cline',
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;

    // Tier 4: deep scan of every known bin dir (nvm/fnm/volta/homebrew/…)
    const viaWhich = whichBinary('cline');
    if (viaWhich) return viaWhich;

    return null;
  }

  /** Resolve [cmd, ...args] for spawning, handling node-script wrappers. */
  _spawnableCmd(binPath, args) {
    const resolved = this._resolveToNodeCmd(binPath);
    if (resolved) return [...resolved, ...args];
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) return ['cmd.exe', '/c', binPath, ...args];
    return [binPath, ...args];
  }

  // ------------------------------------------------------------------
  // Version preflight (cached; HARD minimum 3.0.0)
  // ------------------------------------------------------------------

  /** Run `cline --version` and return its raw output. Isolated for testing. */
  _readClineVersionRaw(clineBin) {
    return execSync(`"${clineBin}" --version`, { encoding: 'utf-8', timeout: 8000, windowsHide: true }).trim();
  }

  /**
   * Resolve the installed Cline version and its compatibility, cached per
   * binary path with a TTL so repeated messages/status refreshes don't re-spawn
   * `cline --version`, while an upgrade is picked up after the TTL.
   * @returns {{version: string|null, compatible: boolean|null}}
   *   compatible true → >= MIN; false → CONFIRMED too old; null → undetermined.
   */
  _checkClineVersion(clineBin) {
    const now = Date.now();
    const cached = _clineVersionCache.get(clineBin);
    if (cached && (now - cached.at) < VERSION_CACHE_TTL_MS) {
      return { version: cached.version, compatible: cached.supported };
    }
    let version = null;
    let supported = null; // undetermined unless we can parse a version
    try {
      ({ version, supported } = classifyClineVersion(this._readClineVersionRaw(clineBin)));
    } catch {
      // `cline --version` failed → undetermined (NOT treated as compatible).
      version = null;
      supported = null;
    }
    _clineVersionCache.set(clineBin, { version, supported, at: now });
    return { version, compatible: supported };
  }

  /** Clear the shared version cache (test hook; also call after install/upgrade). */
  static _clearVersionCache() {
    _clineVersionCache.clear();
  }

  // ------------------------------------------------------------------
  // Auth / config introspection (no secret values are read or logged)
  // ------------------------------------------------------------------

  _readProvidersConfig() {
    const cfg = path.join(os.homedir(), '.cline', 'data', 'settings', 'providers.json');
    try {
      if (!fs.existsSync(cfg)) return null;
      return JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    } catch {
      return { __parse_error: true };
    }
  }

  /** Classify auth using providers.json + the agent env (heuristic, never an
   *  absolute verdict). Returns the classifyClineAuth shape; a parse error maps
   *  to `unknown` (not a hard failure). No secret values are read or returned. */
  _authState() {
    const parsed = this._readProvidersConfig();
    // classifyClineAuth treats the `{__parse_error:true}` sentinel as unknown.
    return classifyClineAuth(parsed, this.agentEnv || process.env);
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  /** A compact, Cline-appropriate context header. We do NOT inject the full
   *  workspace system prompt (it advertises MCP tools Cline isn't wired with);
   *  Cline keeps its own coding system prompt, and `-s` would replace it. */
  _contextHeader(channel) {
    const lines = [
      `[OpenAgents workspace] You are "${this.agentName}", a coding agent in workspace channel "${channel}".`,
    ];
    if (this._mode === 'plan') {
      lines.push('You are in PLAN mode: investigate and propose a plan; do not modify files.');
    }
    lines.push('Work in the current working directory. Reply concisely. The user request follows:');
    return lines.join('\n');
  }

  /** Short transcript of recent chat used to re-seed context when starting a
   *  fresh session (resume unavailable). Bounded to keep argv small on Windows. */
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
        lines.push(`[${who}] ${text.length > 800 ? text.slice(0, 800) + '…' : text}`);
      }
      if (lines.length === 0) return null;
      return 'Recent conversation in this channel for context:\n\n' + lines.slice(-12).join('\n');
    } catch {
      return null;
    }
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
    this._log(`Processing message from ${sender} in ${channel}: ${redactSecrets(content.slice(0, 80))}...`);

    // Resolve and validate the working directory up front. Never silently fall
    // back to the launcher/repo dir — return a clear error instead.
    const workingDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    if (this.workingDir && !this._dirExists(this.workingDir)) {
      await this.sendError(channel, `Working directory does not exist: ${this.workingDir}`);
      return;
    }

    const clineBin = this._findClineBinary();
    if (!clineBin) {
      await this.sendError(channel,
        'Cline CLI not found. Install it with: npm install -g cline');
      return;
    }

    // HARD minimum version gate. A CONFIRMED-older CLI must not start; an
    // undetermined version (compatible === null) proceeds leniently.
    const ver = this._checkClineVersion(clineBin);
    if (ver.compatible === false) {
      this._log(`Refusing to start: Cline ${ver.version} < minimum ${MIN_CLINE_VERSION}`);
      await this.sendError(channel,
        `Cline CLI ${ver.version} is below the minimum supported version ${MIN_CLINE_VERSION}. ` +
        'Please upgrade with: npm install -g cline@latest');
      return;
    }

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

    // One retry: if resuming a stale session fails, retry once fresh.
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumeId = attempt === 0 ? this._resumableSession(channel, workingDir) : null;

      // Build the prompt. Resuming → Cline already has history, send the bare
      // turn. Fresh → prepend a context header (+ recap when available).
      let prompt;
      // For a fresh run, snapshot the existing session ids BEFORE spawning so we
      // can later identify our run's NEW session unambiguously (concurrency-safe).
      let beforeIds = null;
      if (resumeId) {
        prompt = content;
      } else {
        const header = this._contextHeader(channel);
        const recap = await this._buildChannelRecap(channel, content);
        prompt = recap
          ? `${header}\n\n${recap}\n\n---\n\n${content}`
          : `${header}\n\n${content}`;
        const before = await this._readHistory(clineBin);
        beforeIds = new Set(Array.isArray(before) ? before.map((s) => s && s.sessionId).filter(Boolean) : []);
      }

      const args = buildClineArgs({
        prompt,
        cwd: workingDir,
        sessionId: resumeId || undefined,
        planMode: this._mode === 'plan',
        provider: (this.agentEnv.CLINE_PROVIDER || '').trim() || undefined,
        model: (this.agentEnv.CLINE_MODEL || '').trim() || undefined,
        apiKey: (this.agentEnv.CLINE_API_KEY || '').trim() || undefined,
        thinking: (this.agentEnv.CLINE_THINKING || '').trim() || undefined,
      });

      const spawnStartMs = Date.now();
      const result = await this._runCline(channel, clineBin, args, workingDir);

      if (result.userStopped) return;

      // Stale-session handling: a resume that died/erred with nothing useful →
      // clear and retry fresh once.
      if (resumeId && !result.ok && !result.anyOutput && attempt === 0) {
        this._log(`Resume of session ${resumeId} failed — clearing and retrying fresh`);
        this._clearSession(channel);
        continue;
      }

      // Persist / refresh the session id for next turn.
      if (resumeId) {
        // Resume keeps the same id; ensure the binding is still recorded.
        this._channelSessions[channel] = { sessionId: resumeId, workingDir };
        this._saveSessions();
      } else if (result.ok || result.anyOutput) {
        await this._captureSessionId(channel, clineBin, workingDir, spawnStartMs, content, beforeIds);
      }

      // Emit final response or a classified error.
      if (result.finalText) {
        try { await this.sendResponse(channel, result.finalText); } catch {}
      } else if (result.errorMessage) {
        const { kind, userMessage } = classifyClineError(result.errorMessage);
        try { await this.sendError(channel, this._withAuthHint(userMessage, kind)); } catch {}
      } else if (!result.anyOutput) {
        try { await this.sendResponse(channel, 'No response generated. Please try again.'); } catch {}
      }
      return;
    }
  }

  _dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  /**
   * Append an actionable hint to an auth/provider/model error, based on the
   * (heuristic) config state. We do NOT block on config; this only enriches the
   * message AFTER a real failure. For an undetermined state we say so rather
   * than asserting the user is unauthenticated.
   * @param {string} userMessage  the classified user-facing error
   * @param {string} [kind]       error kind from classifyClineError
   */
  _withAuthHint(userMessage, kind) {
    // Only auth/provider/model failures warrant a config hint.
    if (kind && !['auth', 'provider', 'model'].includes(kind)) return userMessage;
    try {
      const auth = this._authState();
      if (auth.state === 'no_credentials') {
        return userMessage + `\n\nProvider "${auth.provider}" is selected but has no stored credential. Set an API key in the launcher, or run \`cline auth\`.`;
      }
      if (auth.state === 'unknown') {
        return userMessage + '\n\nConfig detection could not confirm Cline auth (the run result is authoritative). If this keeps failing, set an API key for this agent in the launcher, or run `cline auth`.';
      }
    } catch {}
    return userMessage;
  }

  /**
   * Spawn one `cline --json` run, stream-parse it, and resolve a summary:
   *   { ok, finalText, errorMessage, anyOutput, userStopped }
   * `ok` reflects run_result.finishReason === "completed".
   */
  _runCline(channel, clineBin, args, workingDir) {
    const cleanEnv = { ...(this.agentEnv || process.env) };
    const [cmd, ...spawnArgs] = this._spawnableCmd(clineBin, args);

    this._log(`Spawning cline in ${workingDir}: ${redactArgs([clineBin, ...args]).join(' ')}`);

    const proc = spawn(cmd, spawnArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv,
      cwd: workingDir,
      detached: !IS_WINDOWS,
      windowsHide: true,
    });
    this._channelProcesses[channel] = proc;

    const parser = new ClineStreamParser();
    const state = {
      finalText: '',            // last assistant text block of the turn
      pendingText: [],          // text blocks accumulated since the last tool use
      hadToolSinceText: false,
      anyOutput: false,
      ok: false,
      // Error sources in priority order (resolved into errorMessage at settle):
      resultError: '',          // run_result/done with a non-completed reason — authoritative
      eventError: '',           // agent_event {type:error}
      stderrError: '',          // fatal {type:error} on stderr (benign noise filtered)
      errorMessage: '',         // resolved, user-facing-bound error text
      finished: false,
      userStopped: false,
    };

    let stderrParser = new ClineStreamParser();
    let stderrText = '';

    return new Promise((resolve) => {
      let settled = false;
      let watchdogTimer = null;
      let fallbackTimer = null;
      let lastDataMs = Date.now();
      let silences = 0;
      let queue = Promise.resolve();

      const cleanup = () => {
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        // Drop data/end listeners but KEEP an 'error' guard: a SIGKILL'd child's
        // pipe can still emit 'error' after we settle, and an unhandled stream
        // 'error' would crash the process.
        if (proc.stdout) { proc.stdout.removeAllListeners(); proc.stdout.on('error', () => {}); }
        if (proc.stderr) { proc.stderr.removeAllListeners(); proc.stderr.on('error', () => {}); }
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        cleanup();
        // Resolve the user-facing error by priority: an authoritative
        // run_result/done failure beats an agent error event, which beats a
        // (non-benign) stderr error line.
        state.errorMessage = state.resultError || state.eventError || state.stderrError || '';
        // Only promote accumulated text to a final answer on a successful run —
        // never present partial text as the answer when the run failed.
        if (!state.finalText && !state.errorMessage && state.pendingText.length) {
          state.finalText = state.pendingText.join('\n').trim();
        }
        if (this._stoppingChannels.has(channel)) state.userStopped = true;
        delete this._channelProcesses[channel];
        resolve(state);
      };

      const handleEvent = async (ev) => {
        const events = interpretClineEnvelope(ev);
        for (const e of events) {
          switch (e.kind) {
            case 'reasoning':
              state.anyOutput = true;
              try { await this.sendThinking(channel, e.text); } catch {}
              break;
            case 'text':
              state.anyOutput = true;
              if (state.hadToolSinceText) { state.pendingText = []; state.hadToolSinceText = false; }
              state.pendingText.push(e.text);
              try { await this.sendThinking(channel, e.text); } catch {}
              break;
            case 'tool_start':
              state.anyOutput = true;
              state.hadToolSinceText = true;
              try {
                await this.sendStatus(channel, e.preview ? `${e.label}: ${e.preview}` : e.label);
              } catch {}
              break;
            case 'tool_end':
              if (!e.ok && e.error) {
                try { await this.sendStatus(channel, `${e.toolName} failed: ${e.error}`); } catch {}
              }
              break;
            case 'ask':
              // Headless runs cannot round-trip an interactive answer; surface
              // the question (and options) so the user at least sees it.
              state.anyOutput = true;
              {
                const opts = e.options && e.options.length ? `\n\nOptions: ${e.options.join(' · ')}` : '';
                try { await this.sendResponse(channel, `❓ ${e.question || 'The agent is asking for input.'}${opts}`); } catch {}
              }
              break;
            case 'notice':
              if (e.text) { try { await this.sendStatus(channel, e.text); } catch {} }
              break;
            case 'error':
              if (e.message && !state.eventError) state.eventError = e.message;
              break;
            case 'done':
              // `done` carries the turn outcome. reason "completed" → text is the
              // final answer; any other reason (error/aborted/max_iterations/…) →
              // text is the failure message, never an assistant reply.
              if (e.reason === 'completed') {
                if (e.text && !state.finalText) state.finalText = e.text.trim();
              } else if (e.text && !state.resultError) {
                state.resultError = e.text.trim();
              }
              break;
            case 'aborted':
              if (e.text && !state.resultError) state.resultError = e.text.trim();
              break;
            case 'result':
              state.ok = e.ok;
              // On a completed run, run_result.text is the final answer. On a
              // failed run it is the ERROR text — authoritative, never a reply.
              if (e.ok) {
                if (e.text) { state.finalText = e.text.trim(); state.anyOutput = true; }
              } else if (e.text) {
                state.resultError = e.text.trim();
              }
              state.finished = true;
              break;
            default:
              break;
          }
        }
      };

      // Swallow stdio stream errors. When we SIGKILL the process (stop /
      // watchdog), the child's stdout/stderr pipe can emit an 'error'
      // (EPIPE/EBADF/ECONNRESET) — notably on macOS — and an unhandled stream
      // 'error' event would throw and crash the daemon/process. We finalize via
      // exit/end anyway, so these are safe to ignore.
      if (proc.stdout) proc.stdout.on('error', () => {});
      if (proc.stderr) proc.stderr.on('error', () => {});

      // stdout: the event stream
      proc.stdout.on('data', (chunk) => {
        lastDataMs = Date.now();
        silences = 0;
        const envs = parser.push(chunk);
        for (const ev of envs) queue = queue.then(() => handleEvent(ev)).catch(() => {});
      });

      // stderr: kept SEPARATE. Fatal cline errors arrive here as
      // {type:"error",message}; everything else is diagnostic noise that must
      // never be shown as an assistant reply. We only adopt a parsed error
      // message (lowest priority, used only if no stream error is known), and
      // filter known-benign diagnostics so they can't mask the real cause.
      const adoptStderr = (ev) => {
        if (!ev || ev.type !== 'error' || !ev.message) return;
        if (BENIGN_STDERR_RE.test(String(ev.message).trim())) return; // exact known noise only
        state.stderrError = redactSecrets(String(ev.message)); // last non-benign wins
      };
      proc.stderr.on('data', (chunk) => {
        for (const ev of stderrParser.push(chunk)) adoptStderr(ev);
        stderrText += chunk.toString('utf-8');
      });

      // Idle watchdog
      watchdogTimer = setInterval(async () => {
        if (settled) return;
        const elapsed = Date.now() - lastDataMs;
        if (elapsed < WATCHDOG_INTERVAL_MS) { silences = 0; return; }
        silences++;
        lastDataMs = Date.now();
        if (silences === WATCHDOG_NUDGE_AT) {
          try { await this.sendStatus(channel, 'Still working...'); } catch {}
        }
        if (silences >= WATCHDOG_MAX) {
          this._log(`Watchdog: cline silent ${silences * 15}s on ${channel} — killing`);
          state.resultError = state.resultError || 'Cline became unresponsive and was stopped.';
          await this._stopProcess(proc);
        }
      }, WATCHDOG_INTERVAL_MS);

      // Finalize only once BOTH the process has exited AND stdout has ended.
      // Listening on 'exit' alone is racy: on some platforms (notably macOS) the
      // final stdout chunk carrying `run_result` is delivered AFTER 'exit'
      // fires, which would drop the answer. Waiting for stdout 'end' guarantees
      // every 'data' event was emitted first. A short fallback after 'exit'
      // covers the rare case where a lingering child keeps the pipe open so
      // 'end' never arrives (the data is already buffered/delivered by then).
      let exited = false;
      let stdoutEnded = false;
      let exitCode = null;
      let exitSignal = null;

      const finalize = () => {
        if (settled) return;
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        for (const ev of parser.flush()) queue = queue.then(() => handleEvent(ev)).catch(() => {});
        for (const ev of stderrParser.flush()) adoptStderr(ev);
        queue = queue.then(() => {
          if (exitCode !== 0 && !state.ok && !state.resultError && !state.eventError && !state.stderrError) {
            const why = exitSignal ? `terminated by signal ${exitSignal}` : `exited with code ${exitCode}`;
            if (stderrText.trim()) this._log(`cline stderr: ${redactSecrets(stderrText.trim().slice(0, 500))}`);
            if (!this._stoppingChannels.has(channel)) {
              state.resultError = `Cline ${why}.`;
            }
          }
          settle();
        }).catch(() => settle());
      };
      const maybeFinalize = () => { if (exited && stdoutEnded) finalize(); };

      if (proc.stdout) proc.stdout.on('end', () => { stdoutEnded = true; maybeFinalize(); });
      else stdoutEnded = true;

      proc.on('exit', (code, signal) => {
        exited = true;
        exitCode = code;
        exitSignal = signal;
        // If stdout 'end' hasn't fired shortly after exit (a lingering child
        // holding the pipe), force finalization — buffered data is already in.
        fallbackTimer = setTimeout(() => { stdoutEnded = true; finalize(); }, 1500);
        maybeFinalize();
      });

      proc.on('error', (err) => {
        state.resultError = state.resultError || `Failed to start Cline: ${redactSecrets(err.message)}`;
        settle();
      });
    });
  }

  /**
   * After a fresh run, correlate the new session via `cline history --json`
   * (Cline does not emit the session id inline). Uses a BEFORE/AFTER snapshot
   * diff: only sessions that are NEW since `beforeIds`, in this working dir, and
   * within the run window are considered, and we bind ONLY on a single
   * unambiguous candidate — never guessing. Best-effort and non-fatal; failure
   * just means the next turn starts a fresh session. The prompt is never logged.
   */
  async _captureSessionId(channel, clineBin, workingDir, spawnStartMs, userContent, beforeIds) {
    try {
      const after = await this._readHistory(clineBin);
      if (!Array.isArray(after)) {
        this._log(`Session correlation skipped for ${channel}: history unavailable`);
        return;
      }
      const needle = (userContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
      const opts = { cwd: workingDir, sinceMs: spawnStartMs, beforeIds: beforeIds || new Set(), promptNeedle: needle };
      const sessionId = pickClineSessionId(after, opts);
      if (sessionId) {
        this._channelSessions[channel] = { sessionId, workingDir };
        this._saveSessions();
        this._log(`Captured Cline session ${sessionId} for ${channel}`);
      } else {
        // Count the ambiguous/zero candidates for diagnostics — no prompt, no values.
        const before = opts.beforeIds instanceof Set ? opts.beforeIds : new Set(beforeIds || []);
        const fresh = after.filter((s) => s && s.cwd === workingDir && s.sessionId && !before.has(s.sessionId)).length;
        this._log(`Session correlation declined for ${channel}: ${fresh} new candidate(s) in workdir — next turn starts fresh`);
      }
    } catch (e) {
      this._log(`Could not capture Cline session id (non-fatal): ${e && e.message ? e.message : e}`);
    }
  }

  _readHistory(clineBin) {
    return new Promise((resolve) => {
      const [cmd, ...args] = this._spawnableCmd(clineBin, ['history', '--json', '--limit', '30']);
      execFile(cmd, args, {
        encoding: 'utf-8', timeout: 10000, windowsHide: true,
        env: { ...(this.agentEnv || process.env) }, maxBuffer: 8 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) { resolve(null); return; }
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      });
    });
  }
}

module.exports = ClineAdapter;
