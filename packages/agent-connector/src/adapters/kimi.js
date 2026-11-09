/**
 * Kimi adapter — drives Moonshot AI's Kimi Code CLI (`kimi`, npm package
 * `@moonshot-ai/kimi-code`), with a legacy direct-API fallback.
 *
 * Primary (CLI) mode:
 *   - one `kimi -p <prompt> --output-format stream-json` subprocess per user
 *     message (print mode runs the full agent loop with tools auto-approved)
 *   - the JSONL stream is parsed (see kimi-stream.js) and mapped to the
 *     standard OpenAgents events (thinking / status / response / error)
 *   - real session continuity via `-S <session_id>`: the CLI emits the id
 *     inline as a `session.resume_hint` meta message
 *   - auth: the launcher's KIMI_API_KEY / KIMI_BASE_URL / KIMI_MODEL fields are
 *     mapped onto the CLI's env-provider contract (KIMI_MODEL_API_KEY /
 *     KIMI_MODEL_BASE_URL / KIMI_MODEL_NAME); with no key configured the CLI's
 *     own `kimi login` credentials apply.
 *
 * Fallback (direct API) mode — the pre-CLI behavior, kept so existing agents
 * configured with only an API key keep working when the CLI is not installed:
 * OpenAI-compatible chat completions against KIMI_BASE_URL (inherited from
 * LlmDirectAdapter).
 *
 *   - workspace tools: the CLI reads MCP servers only from
 *     `$KIMI_CODE_HOME/mcp.json`, so each agent runs with a private Kimi home
 *     (~/.openagents/kimi-homes/<agent>/) that adds the workspace MCP server to
 *     the user's own servers and links their `kimi login` credentials and
 *     config.toml back in. The token, workspace and channel reach the MCP
 *     server through the environment, never through a file.
 *   - no sandbox: print mode approves every tool call and the CLI has no
 *     filesystem boundary, so the agent can write outside its working
 *     directory. That is the CLI's own model, not something this adapter adds.
 *
 * Verified against Kimi Code CLI v0.39.1 and 2.4.1. NOTE: the legacy Python `kimi-cli`
 * (PyPI) also installs a `kimi` binary but reports 1.x versions and has a
 * different interface — it is detected and NOT driven.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { execSync } = require('child_process');
// spawn() here is the WSL bridge from ../wsl: same signature as
// child_process.spawn, and a straight pass-through unless the resolved CLI
// lives on the other side of the Windows/WSL boundary.
const { spawn } = require('../wsl');

const LlmDirectAdapter = require('./llm-direct');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { defaultAgentWorkdir, whichBinary, whereBinary } = require('../paths');
const { fixSpawnHelpersFor } = require('../node-pty-perms');
const {
  KimiStreamParser,
  interpretKimiMessage,
  buildKimiArgs,
  buildKimiEnv,
  redactArgs,
  redactSecrets,
  classifyKimiVersion,
  classifyKimiError,
  encodeKimiWorkDirKey,
  KimiWireTracker,
  KIMI_MCP_SERVER_NAME,
  KIMI_HOME_LINKS,
  kimiHomeName,
  buildKimiMcpConfig,
  buildKimiWorkspaceEnv,
} = require('./kimi-stream');

const IS_WINDOWS = process.platform === 'win32';

const DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_MODEL = 'kimi-k2.6';

// Idle watchdog: if a run shows no sign of life this long we nudge the user;
// after MAX consecutive silences we kill the (possibly hung) process. Sign of
// life is any stdout or stderr, or a write to the run's session journal. The
// journal is the only trace a subagent leaves: print mode never forwards its
// events, so a main agent waiting on an `Agent` tool call is otherwise mute.
//
// Print mode is also mute while the model works on a step — it streams, but
// nothing reaches stdout, stderr or the journal until the step is done — and
// while a tool runs, a shell command or a background task the run waits on
// (verified v2.5.2). Five minutes of that stopped working runs: a long
// thinking step, or a model writing a long script and then running it. So a
// quiet stretch while the journal shows a tool still running
// (KimiWireTracker) does not count against MAX, only against TOOL_MAX; and
// MAX allows a full step. Our output cap is 32768 tokens
// (DEFAULT_MAX_COMPLETION_TOKENS), about 14 min at 40 tokens/s. Kimi's
// provider retry backoff can reach ~1 min between attempts.
const WATCHDOG_INTERVAL_MS = 15_000;
const WATCHDOG_NUDGE_AT = 2;       // ~30s of silence → "still working"
const WATCHDOG_MAX = 60;           // ~15 min of silence, no tool running → kill
const WATCHDOG_TOOL_MAX = 120;     // ~30 min of silence while a tool runs → kill

// Version check cache: keyed by resolved binary path so repeated messages
// don't re-spawn `kimi --version`, yet an install/upgrade is re-detected.
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const _kimiVersionCache = new Map(); // binPath -> { version, product, at }
const _ptyFixedBins = new Set(); // binPaths whose node-pty spawn-helper was checked

/** Newest mtime (ms) of a directory and everything under it, `depth` levels deep. */
function newestMtimeMs(dir, depth) {
  let newest = 0;
  let entries;
  try {
    newest = fs.statSync(dir).mtimeMs;
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) newest = Math.max(newest, newestMtimeMs(p, depth - 1));
    } else {
      try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch {}
    }
  }
  return newest;
}

class KimiAdapter extends LlmDirectAdapter {
  constructor(opts) {
    super({
      ...opts,
      adapterLabel: 'Kimi',
      modelEnvVar: 'KIMI_MODEL',
      apiKeyEnvVar: 'KIMI_API_KEY',
      baseUrlEnvVar: 'KIMI_BASE_URL',
      suppressConfigLog: true,
    });

    const env = this.agentEnv || process.env;

    // Direct-API fallback config (also feeds the CLI env mapping).
    const apiKey =
      env.KIMI_API_KEY ||
      env.MOONSHOT_API_KEY ||
      env.LLM_API_KEY ||
      env.OPENAI_API_KEY ||
      '';
    const baseUrl = (
      env.KIMI_BASE_URL ||
      env.LLM_BASE_URL ||
      env.OPENAI_BASE_URL ||
      DEFAULT_BASE_URL
    ).replace(/\/$/, '');
    const model =
      env.KIMI_MODEL ||
      env.LLM_MODEL ||
      DEFAULT_MODEL;

    this._apiKey = apiKey;
    this._baseUrl = baseUrl;
    this._model = model;
    this._directMode = !!(this._apiKey && this._baseUrl);

    // CLI-mode state (mirrors the Cline/Claude adapters).
    this._channelSessions = {};   // channel → { sessionId, workingDir }
    this._channelProcesses = {};  // channel → in-flight child process
    this._stoppingChannels = new Set();
    this._loggedCliMode = false;
    // Watchdog timings live on the instance so tests can run them in ms.
    this._watchdogIntervalMs = WATCHDOG_INTERVAL_MS;
    this._watchdogNudgeAt = WATCHDOG_NUDGE_AT;
    this._watchdogMax = WATCHDOG_MAX;
    this._watchdogToolMax = WATCHDOG_TOOL_MAX;
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_kimi.json`,
    );
    this._loadSessions();

    if (this._findKimiBinary()) {
      this._log('Kimi Code CLI detected — running in CLI mode');
    } else if (this._directMode) {
      this._log(`Kimi direct API mode: ${this._baseUrl} model=${this._model} (install Kimi Code CLI for full agent mode: npm install -g @moonshot-ai/kimi-code)`);
    } else {
      this._log(
        'Kimi adapter started without CLI or API key. Install the CLI ' +
        '(npm install -g @moonshot-ai/kimi-code) and/or set KIMI_API_KEY in the Launcher.'
      );
    }
  }

  // ------------------------------------------------------------------
  // Session persistence (real Kimi session ids, bound to working dir)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Kimi session(s)`);
        }
      }
    } catch {
      this._log('Could not load Kimi sessions file, starting fresh');
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
            'Session restarted — next message starts a fresh Kimi session.',
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

  /** Daemon shutdown — tear down any in-flight kimi runs so threads don't
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
    this._log(`Stopping ${entries.length} running Kimi process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /** Stop a kimi process tree gracefully then forcefully (POSIX process group
   *  / `taskkill /T` on Windows), same escalation as the other CLI adapters. */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        // Tree first. On Windows proc.kill() is TerminateProcess whatever the
        // signal, so "SIGINT, then taskkill /T if it is still alive" never
        // reached taskkill — and once kimi is dead its shell commands can no
        // longer be found through it: a Stop left them running.
        try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000, windowsHide: true }); } catch {}
        if (!(await this._waitExit(proc, 1500))) {
          try { proc.kill(); } catch {}
          await this._waitExit(proc, 1000);
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
  // Binary resolution (cross-platform; mirrors the Cline adapter)
  // ------------------------------------------------------------------

  _findNodeBin() {
    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'),
         path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return process.execPath;
  }

  /**
   * Resolve a shim/symlink to [nodeBin, jsEntry] so we spawn the JS wrapper
   * directly. Kimi Code's package bin IS `dist/main.mjs` (a node script), so
   * running it under node is the most robust path on every OS — on Windows it
   * avoids `cmd.exe /c`'s 8191-char command-line cap truncating a long prompt.
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

  _findKimiBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';

    // Tier 0: isolated runtime prefix (~/.openagents/runtimes/kimi/)
    const runtimeCandidate = path.join(home, '.openagents', 'runtimes', 'kimi', 'node_modules', '.bin', `kimi${ext}`);
    if (fs.existsSync(runtimeCandidate)) return runtimeCandidate;

    // Tier 0b: legacy portable install
    const portable = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `kimi${ext}`);
    if (fs.existsSync(portable)) return portable;

    // Tier 0c: the package's own bin (`dist/main.mjs`) inside a prefix install.
    for (const root of [
      path.join(home, '.openagents', 'runtimes', 'kimi', 'node_modules', '@moonshot-ai', 'kimi-code'),
      path.join(home, '.openagents', 'nodejs', 'node_modules', '@moonshot-ai', 'kimi-code'),
    ]) {
      const pkgBin = path.join(root, 'dist', 'main.mjs');
      if (fs.existsSync(pkgBin)) return pkgBin;
    }

    // Tier 1: PATH search (codepage-safe, enriched env — see paths.js).
    const viaWhere = whereBinary('kimi');
    if (viaWhere) return viaWhere;

    // Tier 2: next to the current Node interpreter (npm global)
    const nearNode = path.join(path.dirname(process.execPath), `kimi${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: common install locations (incl. the vendor install script's
    // ~/.local/bin target and homebrew).
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'kimi.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'kimi'),
      path.join(home, '.npm-global', 'bin', 'kimi'),
      '/opt/homebrew/bin/kimi',
      '/usr/local/bin/kimi',
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;

    // Tier 4: deep scan of every known bin dir (nvm/fnm/volta/homebrew/…)
    const viaWhich = whichBinary('kimi');
    if (viaWhich) return viaWhich;

    return null;
  }

  /** Resolve [cmd, ...args] for spawning, handling node-script wrappers. */
  _spawnableCmd(binPath, args) {
    const resolved = this._resolveToNodeCmd(binPath);
    if (resolved) return [...resolved, ...args];
    if (binPath.endsWith('.mjs') || binPath.endsWith('.js')) {
      return [this._findNodeBin(), binPath, ...args];
    }
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) return ['cmd.exe', '/c', binPath, ...args];
    return [binPath, ...args];
  }

  // ------------------------------------------------------------------
  // Version / product preflight (cached)
  // ------------------------------------------------------------------

  /** Run `kimi --version` and return its raw output. Isolated for testing. */
  _readKimiVersionRaw(kimiBin) {
    const [cmd, ...args] = this._spawnableCmd(kimiBin, ['--version']);
    return execSync(
      [cmd, ...args].map((a) => `"${a}"`).join(' '),
      { encoding: 'utf-8', timeout: 8000, windowsHide: true },
    ).trim();
  }

  /**
   * Resolve the installed product identity, cached per binary path with a TTL.
   * @returns {{version: string|null, product: 'kimi-code'|'legacy'|null}}
   */
  _checkKimiVersion(kimiBin) {
    const now = Date.now();
    const cached = _kimiVersionCache.get(kimiBin);
    if (cached && (now - cached.at) < VERSION_CACHE_TTL_MS) {
      return { version: cached.version, product: cached.product };
    }
    let version = null;
    let product = null;
    try {
      ({ version, product } = classifyKimiVersion(this._readKimiVersionRaw(kimiBin)));
    } catch {
      // `kimi --version` failed → undetermined; proceed leniently.
    }
    _kimiVersionCache.set(kimiBin, { version, product, at: now });
    return { version, product };
  }

  /** Clear the shared version cache (test hook; also after install/upgrade). */
  static _clearVersionCache() {
    _kimiVersionCache.clear();
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  /** A compact context header. Kimi Code keeps its own coding system prompt;
   *  we only add workspace identity and (soft) plan-mode framing — print mode
   *  cannot take the CLI's --plan flag. */
  _contextHeader(channel) {
    const lines = [
      `[OpenAgents workspace] You are "${this.agentName}", a coding agent in workspace channel "${channel}".`,
    ];
    if (this._mode === 'plan') {
      lines.push('You are in PLAN mode: investigate and propose a plan; do not modify files.');
    }
    if (this._workspaceToolsReady) {
      lines.push(
        `For anything in the OpenAgents workspace — chat history, files, uploads, knowledge, todos — use the ` +
        `\`workspace_*\` tools (MCP server "${KIMI_MCP_SERVER_NAME}"). They are already signed in: never look for, ` +
        'print or use a workspace token, and do not call the workspace HTTP API yourself.',
      );
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
    const kimiBin = this._findKimiBinary();

    if (!kimiBin) {
      // Legacy direct-API fallback: agents configured before CLI support keep
      // working exactly as they did.
      if (this._directMode) {
        if (!this._loggedCliMode) {
          this._loggedCliMode = true;
          this._log('Kimi Code CLI not found — using direct API fallback (npm install -g @moonshot-ai/kimi-code for full agent mode)');
        }
        await super._handleMessage(msg);
        return;
      }
      const channel = msg.sessionId || this.channelName;
      await this.sendError(channel,
        'Kimi Code CLI not found. Install it with: npm install -g @moonshot-ai/kimi-code ' +
        '(or set KIMI_API_KEY for direct API mode).');
      return;
    }

    const ver = this._checkKimiVersion(kimiBin);
    if (ver.product === 'legacy') {
      // Wrong product on PATH: the wound-down Python kimi-cli (1.x) has a
      // different headless interface. Fall back to direct API if configured.
      if (this._directMode) {
        if (!this._loggedCliMode) {
          this._loggedCliMode = true;
          this._log(`Legacy kimi-cli ${ver.version} detected — using direct API fallback. Install Kimi Code CLI: npm install -g @moonshot-ai/kimi-code`);
        }
        await super._handleMessage(msg);
        return;
      }
      const channel = msg.sessionId || this.channelName;
      await this.sendError(channel,
        `Found the legacy Python kimi-cli (${ver.version}), which is not supported. ` +
        'Install the real Kimi Code CLI with: npm install -g @moonshot-ai/kimi-code');
      return;
    }

    // An install from before the installer restored node-pty's spawn-helper
    // (or one the user made) still has it at 0644, and every terminal Kimi
    // opens fails with "posix_spawnp failed." Once per binary per daemon.
    if (!_ptyFixedBins.has(kimiBin)) {
      _ptyFixedBins.add(kimiBin);
      const fixed = fixSpawnHelpersFor(kimiBin);
      if (fixed.length) this._log(`Made node-pty spawn-helper executable: ${fixed.join(', ')}`);
    }

    await this._handleMessageCli(msg, kimiBin);
  }

  async _handleMessageCli(msg, kimiBin) {
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
    try { fs.mkdirSync(workingDir, { recursive: true }); } catch {}

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

      // Resuming → Kimi already has history, send the bare turn. Fresh →
      // prepend a context header (+ recap when available).
      // Decided before the prompt is built: the header only promises the
      // workspace tools when this run will actually have them.
      this._workspaceToolsReady = !!this._prepareKimiHome();
      let prompt;
      if (resumeId) {
        prompt = content;
      } else {
        const header = this._contextHeader(channel);
        const recap = await this._buildChannelRecap(channel, content);
        prompt = recap
          ? `${header}\n\n${recap}\n\n---\n\n${content}`
          : `${header}\n\n${content}`;
      }

      const args = buildKimiArgs({ prompt, sessionId: resumeId || undefined });
      const result = await this._runKimi(channel, kimiBin, args, workingDir);

      if (result.userStopped) return;

      // Stale-session handling: a resume that died/erred with nothing useful →
      // clear and retry fresh once. A watchdog stop is not a stale session, and
      // retrying it would just repeat the long task.
      if (resumeId && !result.ok && !result.anyOutput && !result.timedOutMs && attempt === 0) {
        this._log(`Resume of session ${resumeId} failed — clearing and retrying fresh`);
        this._clearSession(channel);
        continue;
      }

      // Persist the session id for next turn (emitted inline by the CLI).
      if (result.sessionId) {
        this._channelSessions[channel] = { sessionId: result.sessionId, workingDir };
        this._saveSessions();
      }

      if (result.ok && result.finalText) {
        try { await this.sendResponse(channel, result.finalText); } catch {}
      } else if (!result.ok) {
        const { userMessage } = classifyKimiError({
          code: result.exitCode,
          signal: result.exitSignal,
          stderrText: result.stderrText,
          retryMessage: result.retryMessage,
          timedOutMs: result.timedOutMs,
          timedOutInTool: result.timedOutInTool,
        });
        try { await this.sendError(channel, userMessage); } catch {}
      } else {
        try { await this.sendResponse(channel, 'No response generated. Please try again.'); } catch {}
      }
      return;
    }
  }

  // ------------------------------------------------------------------
  // Private Kimi home (workspace MCP tools)
  // ------------------------------------------------------------------

  /** This agent's own Kimi home. See KIMI_MCP_SERVER_NAME in kimi-stream.js. */
  _kimiHome() {
    return path.join(os.homedir(), '.openagents', 'kimi-homes', kimiHomeName(this.workspaceId, this.agentName));
  }

  /** The user's own Kimi home, which the private one links back to. */
  _userKimiHome() {
    const env = this.agentEnv || {};
    return env.KIMI_CODE_HOME || process.env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
  }

  /**
   * (Re)build the private home for one run and return its path, or null when
   * it cannot be prepared — the run then goes ahead without workspace tools,
   * exactly as before.
   *
   * Every run re-checks the links, so a `kimi login` done after the agent
   * started is picked up, and rewrites mcp.json, so a change to the user's own
   * MCP servers or to the agent's disabled modules applies at once.
   */
  _prepareKimiHome() {
    const home = this._kimiHome();
    try {
      fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      const userHome = this._userKimiHome();
      for (const { name, dir } of KIMI_HOME_LINKS) this._linkIntoKimiHome(path.join(userHome, name), path.join(home, name), dir);

      const command = this._mcpServerCommand();
      if (!command) {
        this._log('Could not locate the OpenAgents CLI — workspace tools are unavailable this run');
        return null;
      }
      let userConfig = null;
      try { userConfig = JSON.parse(fs.readFileSync(path.join(userHome, 'mcp.json'), 'utf-8')); } catch {}
      const config = buildKimiMcpConfig(userConfig, command);
      const file = path.join(home, 'mcp.json');
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
      return home;
    } catch (e) {
      this._log(`Could not prepare the private Kimi home (${redactSecrets(e && e.message)}) — workspace tools are unavailable this run`);
      return null;
    }
  }

  /**
   * Point `dest` at `target` in the user's home. A directory is linked
   * (a junction on Windows, which needs no privilege), so writes such as a
   * credentials refresh land in the user's home. A file is symlinked on POSIX
   * and copied on Windows, where file symlinks need Developer Mode. Anything
   * already at `dest` that is not ours to replace is left alone.
   */
  _linkIntoKimiHome(target, dest, isDir) {
    if (!fs.existsSync(target)) return;
    let st = null;
    try { st = fs.lstatSync(dest); } catch {}
    if (st && st.isSymbolicLink()) {
      let current = null;
      try { current = fs.readlinkSync(dest); } catch {}
      if (current && path.resolve(path.dirname(dest), current) === path.resolve(target)) return;
      fs.rmSync(dest, { force: true });
    } else if (st && !(IS_WINDOWS && !isDir && st.isFile())) {
      return;
    }
    if (isDir) fs.symlinkSync(target, dest, IS_WINDOWS ? 'junction' : 'dir');
    else if (IS_WINDOWS) fs.copyFileSync(target, dest);
    else fs.symlinkSync(target, dest, 'file');
  }

  /** The stdio command that runs this package's workspace MCP server. */
  _mcpServerCommand() {
    const bin = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (!fs.existsSync(bin)) return null;
    const args = [bin, 'mcp-server'];
    const disabled = this.disabledModules || new Set();
    if (disabled.has('files')) args.push('--disable-files');
    if (disabled.has('browser')) args.push('--disable-browser');
    if (disabled.has('knowledge')) args.push('--disable-knowledge');
    return { command: process.execPath, args };
  }

  _dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  /**
   * Snapshot the session journals that exist before a run starts, so the
   * watchdog can tell this run's writes from other sessions' in the same
   * working directory. Kimi files them under
   * <KIMI_CODE_HOME>/sessions/<workdir key>/<session id>/.
   */
  _watchKimiSessions(env, workingDir, args) {
    const home = env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
    const bucket = path.join(home, 'sessions', encodeKimiWorkDirKey(workingDir));
    let known = [];
    try { known = fs.readdirSync(bucket); } catch {}
    const s = args.indexOf('-S');
    const watch = {
      bucket, known: new Set(known), resumeId: s >= 0 ? args[s + 1] : null, wires: new Map(), since: Date.now(),
    };
    // A resumed session's journal is read on from where it stands now. Not
    // needed for correctness (records from before `since` open nothing), but
    // a long session's journal is not read whole on every run.
    for (const name of this._runSessionDirs(watch)) {
      const file = this._mainWirePath(watch, name);
      try {
        const st = fs.statSync(file);
        watch.wires.set(file, this._newWire(watch, st.size, st.ino));
      } catch {}
    }
    return watch;
  }

  /** This run's session directories: the resumed one, plus any created since the run started. */
  _runSessionDirs(watch) {
    let names;
    try { names = fs.readdirSync(watch.bucket); } catch { return []; }
    return names.filter((name) => !watch.known.has(name) || (!!watch.resumeId &&
      (name === watch.resumeId || name === `session_${watch.resumeId}`)));
  }

  _mainWirePath(watch, name) {
    return path.join(watch.bucket, name, 'agents', 'main', 'wire.jsonl');
  }

  _newWire(watch, offset = 0, ino = null) {
    return { offset, ino, decoder: new StringDecoder('utf8'), tracker: new KimiWireTracker({ since: watch.since }) };
  }

  /**
   * Newest write (ms) inside this run's session journals. A second fresh run
   * in the same directory can be counted too; that only ever keeps a run
   * alive longer, never stops one early. 0 when there is nothing to look at.
   */
  _latestKimiSessionWrite(watch) {
    let latest = 0;
    for (const name of this._runSessionDirs(watch)) {
      latest = Math.max(latest, newestMtimeMs(path.join(watch.bucket, name), 3));
    }
    return latest;
  }

  /**
   * Whether this run's main agent has a tool call or a background task still
   * running, by its session journal (see KimiWireTracker). Each journal is
   * read on from where the last look stopped — unless Kimi replaced it: it
   * rewrites a journal whose last line was cut off (a run stopped mid-write)
   * to its valid prefix, and migrates old ones, both as a new file. The old
   * offset then points past this run's records; such a file is read again
   * from the start.
   */
  _kimiToolRunning(watch) {
    let running = false;
    for (const name of this._runSessionDirs(watch)) {
      const file = this._mainWirePath(watch, name);
      let wire = watch.wires.get(file);
      try {
        const st = fs.statSync(file);
        if (!wire || st.ino !== wire.ino || st.size < wire.offset) {
          wire = this._newWire(watch, 0, st.ino);
          watch.wires.set(file, wire);
        }
        const size = st.size;
        if (size > wire.offset) {
          const buf = Buffer.alloc(size - wire.offset);
          const fd = fs.openSync(file, 'r');
          try { fs.readSync(fd, buf, 0, buf.length, wire.offset); } finally { fs.closeSync(fd); }
          wire.offset = size;
          wire.tracker.push(wire.decoder.write(buf));
        }
      } catch {}
      if (wire && wire.tracker.busy) running = true;
    }
    return running;
  }

  /**
   * Spawn one `kimi -p … --output-format stream-json` run, stream-parse it,
   * and resolve a summary:
   *   { ok, finalText, sessionId, anyOutput, userStopped,
   *     exitCode, exitSignal, stderrText, retryMessage, timedOutMs, timedOutInTool }
   * `ok` is exit code 0; `finalText` is the LAST assistant text of the turn;
   * `timedOutMs` is non-zero when the idle watchdog stopped the run, and
   * `timedOutInTool` says a tool call or background task was running then.
   */
  _runKimi(channel, kimiBin, args, workingDir) {
    // Stopped while this turn was being prepared: start nothing (no tokens).
    if (this._stoppedBeforeStart(channel)) return Promise.resolve({ userStopped: true });
    const { env: cleanEnv } = buildKimiEnv(this.agentEnv || process.env);
    const kimiHome = this._prepareKimiHome();
    if (kimiHome) {
      cleanEnv.KIMI_CODE_HOME = kimiHome;
      Object.assign(cleanEnv, buildKimiWorkspaceEnv({
        token: this.token,
        workspaceId: this.workspaceId,
        channel,
        agentName: this.agentName,
        endpoint: this.endpoint,
      }));
    }
    const [cmd, ...spawnArgs] = this._spawnableCmd(kimiBin, args);
    // Before the spawn, so the session this run creates shows up as new.
    const sessionWatch = this._watchKimiSessions(cleanEnv, workingDir, args);

    this._log(`Spawning kimi in ${workingDir}: ${redactArgs([kimiBin, ...args]).join(' ')}`);

    const proc = spawn(cmd, spawnArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv,
      cwd: workingDir,
      detached: !IS_WINDOWS,
      windowsHide: true,
    });
    this._channelProcesses[channel] = proc;

    const parser = new KimiStreamParser();
    const state = {
      ok: false,
      finalText: '',
      pendingThought: '',
      sessionId: null,
      anyOutput: false,
      userStopped: false,
      exitCode: null,
      exitSignal: null,
      stderrText: '',
      retryMessage: '',
      timedOutMs: 0,
      timedOutInTool: false,
    };

    return new Promise((resolve) => {
      let settled = false;
      let watchdogTimer = null;
      let fallbackTimer = null;
      let lastDataMs = Date.now();
      let seenSessionWriteMs = lastDataMs;
      let loggedSessionAlive = false;
      let silences = 0;      // quiet ticks with no tool running
      let quietTicks = 0;    // every quiet tick since the last sign of life
      let loggedToolRunning = false;
      let queue = Promise.resolve();

      const cleanup = () => {
        if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        // Drop data/end listeners but KEEP an 'error' guard: a SIGKILL'd
        // child's pipe can still emit 'error' after we settle.
        if (proc.stdout) { proc.stdout.removeAllListeners(); proc.stdout.on('error', () => {}); }
        if (proc.stderr) { proc.stderr.removeAllListeners(); proc.stderr.on('error', () => {}); }
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this._stoppingChannels.has(channel)) state.userStopped = true;
        delete this._channelProcesses[channel];
        resolve(state);
      };

      const handleMessage = async (m) => {
        for (const e of interpretKimiMessage(m)) {
          switch (e.kind) {
            case 'text':
              // Held back until the turn moves on: the LAST text is the reply,
              // posted once as the response rather than also as a thought.
              state.anyOutput = true;
              if (state.pendingThought) {
                try { await this.sendThinking(channel, state.pendingThought); } catch {}
              }
              state.pendingThought = e.text;
              state.finalText = e.text;
              break;
            case 'tool_start':
              state.anyOutput = true;
              if (state.pendingThought) {
                try { await this.sendThinking(channel, state.pendingThought); } catch {}
                state.pendingThought = '';
              }
              try {
                await this.sendStatus(channel, e.preview ? `${e.name}: ${e.preview}` : e.name);
              } catch {}
              break;
            case 'session':
              state.sessionId = e.sessionId;
              break;
            case 'retrying':
              state.retryMessage = e.message || state.retryMessage;
              try {
                await this.sendStatus(channel, `Provider error — retrying (${e.attempt}/${e.maxAttempts})...`);
              } catch {}
              break;
            default:
              break;
          }
        }
      };

      // Swallow stdio stream errors (EPIPE after SIGKILL etc.) — we finalize
      // via exit/end anyway.
      if (proc.stdout) proc.stdout.on('error', () => {});
      if (proc.stderr) proc.stderr.on('error', () => {});

      proc.stdout.on('data', (chunk) => {
        lastDataMs = Date.now();
        silences = 0;
        quietTicks = 0;
        const msgs = parser.push(chunk);
        for (const m of msgs) queue = queue.then(() => handleMessage(m)).catch(() => {});
      });

      // stderr: `error: ...` lines carry the fatal cause; collected for
      // classification, never surfaced verbatim as an assistant reply. Tool
      // progress also lands here in print mode, so it counts as life.
      proc.stderr.on('data', (chunk) => {
        lastDataMs = Date.now();
        silences = 0;
        quietTicks = 0;
        state.stderrText += chunk.toString('utf-8');
        if (state.stderrText.length > 64 * 1024) {
          state.stderrText = state.stderrText.slice(-32 * 1024);
        }
      });

      // Idle watchdog
      const intervalMs = this._watchdogIntervalMs;
      watchdogTimer = setInterval(async () => {
        if (settled) return;
        const elapsed = Date.now() - lastDataMs;
        if (elapsed < intervalMs) { silences = 0; quietTicks = 0; return; }
        // Both pipes are quiet. A subagent still working only shows up in the
        // session journal, so a fresh write there resets the count too.
        const wrote = this._latestKimiSessionWrite(sessionWatch);
        if (wrote > seenSessionWriteMs) {
          seenSessionWriteMs = wrote;
          lastDataMs = Date.now();
          silences = 0;
          quietTicks = 0;
          if (!loggedSessionAlive) {
            loggedSessionAlive = true;
            this._log(`Watchdog: kimi quiet on ${channel} but its session is still being written — keeping it alive`);
          }
          return;
        }
        // A tool still running (see KimiWireTracker): the run is busy, and
        // print mode says nothing until the tool ends. Such a stretch is
        // bounded by _watchdogToolMax, not _watchdogMax.
        const toolRunning = this._kimiToolRunning(sessionWatch);
        if (toolRunning && !loggedToolRunning) {
          loggedToolRunning = true;
          this._log(`Watchdog: kimi quiet on ${channel} but a tool it started is still running — keeping it alive`);
        }
        quietTicks++;
        if (toolRunning) silences = 0;
        else silences++;
        // Deliberately NOT touching lastDataMs here: it marks the last real
        // sign of life, and the data handlers above already reset `silences`
        // themselves. Refreshing it on a silent tick parked the next tick's
        // `elapsed` right on the interval boundary, where an early-firing
        // timer (routine on Windows) read as "data just arrived" and reset
        // the count — so a genuinely hung run was never stopped.
        if (quietTicks === this._watchdogNudgeAt) {
          try { await this.sendStatus(channel, 'Still working...'); } catch {}
        }
        if (toolRunning ? quietTicks >= this._watchdogToolMax : silences >= this._watchdogMax) {
          // Stop ticking before the (awaited) kill: _stopProcess can take
          // seconds to escalate, and a tick landing inside that wait would
          // re-log, re-kill and keep inflating timedOutMs past the budget.
          clearInterval(watchdogTimer);
          const silentMs = Date.now() - lastDataMs;
          this._log(`Watchdog: kimi silent ${Math.round(silentMs / 1000)}s on ${channel}`
            + `${toolRunning ? ' with a tool still running' : ''} — killing`);
          // Its own field, not stderr: tool noise already there used to leave
          // the user with nothing but the signal name.
          state.timedOutMs = silentMs;
          state.timedOutInTool = toolRunning;
          await this._stopProcess(proc);
        }
      }, intervalMs);

      // Finalize only once BOTH the process has exited AND stdout has ended,
      // so the final buffered lines are never dropped (same race as Cline on
      // macOS). A short fallback covers a lingering child holding the pipe.
      let exited = false;
      let stdoutEnded = false;

      const finalize = () => {
        if (settled) return;
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        for (const m of parser.flush()) queue = queue.then(() => handleMessage(m)).catch(() => {});
        queue = queue.then(() => {
          state.ok = state.exitCode === 0;
          if (!state.ok && state.stderrText.trim()) {
            this._log(`kimi stderr: ${redactSecrets(state.stderrText.trim().slice(0, 500))}`);
          }
          settle();
        }).catch(() => settle());
      };
      const maybeFinalize = () => { if (exited && stdoutEnded) finalize(); };

      if (proc.stdout) proc.stdout.on('end', () => { stdoutEnded = true; maybeFinalize(); });
      else stdoutEnded = true;

      proc.on('exit', (code, signal) => {
        exited = true;
        state.exitCode = code;
        state.exitSignal = signal;
        fallbackTimer = setTimeout(() => { stdoutEnded = true; finalize(); }, 1500);
        maybeFinalize();
      });

      proc.on('error', (err) => {
        state.stderrText = state.stderrText || `error: Failed to start Kimi Code CLI: ${redactSecrets(err.message)}`;
        state.exitCode = state.exitCode === null ? -1 : state.exitCode;
        settle();
      });
    });
  }
}

module.exports = KimiAdapter;
