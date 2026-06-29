/**
 * GitHub Copilot CLI adapter for OpenAgents workspace.
 *
 * Bridges the OFFICIAL GitHub Copilot CLI — executable `copilot`, npm package
 * `@github/copilot` — to an OpenAgents workspace. This is NOT the retired
 * `gh copilot` GitHub CLI extension; this adapter never invokes `gh`.
 *
 * Per incoming workspace message it spawns one `copilot -p <prompt>
 * --output-format=json` subprocess (cwd = the agent's working directory),
 * parses the JSONL event stream via the standalone pure parser
 * (./copilot-stream-parser), maps events onto workspace messages, persists the
 * real Copilot session id per channel for resume, and can interrupt + clean up
 * the whole process tree on demand.
 *
 * Design notes specific to Copilot CLI (do not copy Cline/Codex semantics
 * blindly):
 *   • Auth is GitHub-based (env tokens / gh / keychain OAuth) — never read or
 *     log tokens; the launcher/installer reports auth state, the CLI's own run
 *     result is the final authority.
 *   • Permissions are explicit and least-privilege: scoped to the working dir
 *     via --add-dir, interactive prompts disabled (--no-ask-user) since the
 *     workspace cannot answer them. We never default to --allow-all / --yolo /
 *     --allow-all-paths / --allow-url.
 *   • plan mode → analysis only (--plan, no write tools); act mode → controlled
 *     read/write/shell within the working dir.
 *
 * ── Verification status ────────────────────────────────────────────────────
 * The concrete CLI flags and JSONL `type` strings used here follow the
 * documented `@github/copilot` interface and are CENTRALIZED (flags in
 * `_buildArgs`, the JSONL schema in copilot-stream-parser). They must be
 * confirmed against the locally installed build; see
 * docs/agents/github-copilot-cli.md. Unknown events degrade gracefully rather
 * than crashing a task.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFileSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { buildOpenclawSystemPrompt } = require('./workspace-prompt');
const { whichBinary, whereBinary, getEnhancedEnv, defaultAgentWorkdir } = require('../paths');
const { compareVersions } = require('../installer');
const { CopilotStreamParser, redactSensitive } = require('./copilot-stream-parser');

const IS_WINDOWS = process.platform === 'win32';

// Minimum Copilot CLI version the adapter can drive. Kept in sync with
// registry.json `install.min_version`. Basis: the GA 1.0 line is the first to
// stably provide everything the adapter relies on — `--output-format=json`
// (JSONL; introduced ~0.0.422), non-interactive `-p` with `--no-ask-user`,
// granular `--allow-tool`/`--add-dir`, `--resume`/`--name` session control, and
// `--secret-env-vars`/`--no-remote`. Verified end-to-end against 1.0.63.
const MIN_VERSION = '1.0.0';

// Token-bearing env var NAMES Copilot reads (verified precedence via
// `copilot help environment`): COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN.
// Plus OpenAgents' own workspace token. We pass the NAMES (never values) to
// `--secret-env-vars` so the CLI strips/redacts them, and use the list to scrub
// our own diagnostics. We never log their VALUES.
const SECRET_ENV_VARS = [
  'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'OA_WORKSPACE_TOKEN',
];

// Tool identifiers granted in act mode (least-privilege). VERIFIED against
// `copilot help permissions` (v1.0.63): `shell` (all shell commands) and `write`
// (file create/modify). Paths are scoped via --add-dir; we deliberately do NOT
// enable network/URL or all-paths access by default.
const ACT_ALLOW_TOOLS = ['shell', 'write'];

// How long to wait for a turn before giving up (no output / hung CLI).
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

class CopilotAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    const env = this.agentEnv || process.env;
    // Official model env var (verified via `copilot help environment`).
    this._model = env.COPILOT_MODEL || '';
    this._versionGate = null; // cached { version, compatible } from --version

    // Per-channel real Copilot session reference (id or stable name) + live procs
    this._channelSessions = {};
    this._channelProcesses = {};
    this._stoppingChannels = new Set();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_copilot.json`,
    );
    this._loadSessions();

    this._copilotBin = this._findCopilotBinary();
    if (this._copilotBin) {
      this._log(`Copilot CLI: ${this._copilotBin}`);
    } else {
      this._log('Warning: copilot CLI not found (install: npm install -g @github/copilot)');
    }
  }

  // ------------------------------------------------------------------
  // Session persistence (per-channel Copilot session reference)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} session(s)`);
        }
      }
    } catch {
      this._log('Could not load sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * A stable, working-dir-bound session name for a channel. Binding the working
   * directory into the name prevents a session created for one project from
   * being resumed against another (the spec's "Session 与 working directory
   * 绑定" / no cross-project resume requirement).
   */
  _stableSessionName(channel) {
    const wd = this.workingDir || defaultAgentWorkdir(this.agentName);
    const hash = require('crypto').createHash('sha1')
      .update(`${wd} ${this.workspaceId} ${channel}`).digest('hex').slice(0, 12);
    return `openagents-${hash}`;
  }

  // ------------------------------------------------------------------
  // Binary discovery (multi-tier; never resolves the retired `gh` extension)
  // ------------------------------------------------------------------

  _findCopilotBinary() {
    const home = os.homedir();
    // Windows: npm shim is copilot.cmd; a winget/standalone install is copilot.exe.
    const exts = IS_WINDOWS ? ['.cmd', '.exe', ''] : [''];
    const named = (dir) => {
      for (const e of exts) {
        const c = path.join(dir, `copilot${e}`);
        try { if (fs.existsSync(c)) return c; } catch {}
      }
      return null;
    };

    // Tier 0: isolated runtime prefix (~/.openagents/runtimes/copilot/.bin)
    let hit = named(path.join(home, '.openagents', 'runtimes', 'copilot', 'node_modules', '.bin'));
    if (hit) return hit;
    // Tier 0b: legacy portable npm prefix
    hit = named(path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin'));
    if (hit) return hit;

    // Tier 1: PATH search via a codepage-safe lookup (whereBinary forces UTF-8
    // output + verifies existence so a non-ASCII/Chinese username isn't mangled
    // into an ENOENT). Uses the enriched env (matches launcher/daemon PATH).
    const viaWhere = whereBinary('copilot');
    if (viaWhere) return viaWhere;

    // Tier 2: next to the current Node interpreter (npm global)
    hit = named(path.dirname(process.execPath));
    if (hit) return hit;

    // Tier 3: npm global prefix
    try {
      const npmPrefix = execSync('npm config get prefix', {
        encoding: 'utf-8', timeout: 5000, windowsHide: true,
      }).trim();
      if (npmPrefix) {
        hit = named(npmPrefix) || named(path.join(npmPrefix, 'bin'));
        if (hit) return hit;
      }
    } catch {}

    // Tier 4: common locations (Homebrew, user bins, winget links)
    const candidates = IS_WINDOWS
      ? [path.join(process.env.APPDATA || '', 'npm'),
         path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links')]
      : ['/opt/homebrew/bin', '/usr/local/bin',
         path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin')];
    for (const dir of candidates) {
      hit = named(dir);
      if (hit) return hit;
    }

    // Tier 5: deep cross-platform PATH scan (nvm/fnm/volta/etc.)
    return whichBinary('copilot');
  }

  /**
   * Resolve [file, prefixArgs] for spawning. On Windows an npm `.cmd` shim is
   * resolved to `[node, entry.js]` so we can spawn shell:false and keep every
   * argv element (notably the prompt) literal — no cmd.exe re-parsing, so no
   * quoting/injection hazard from special characters in the prompt. A native
   * `.exe` (winget/standalone) is spawned directly. On Unix the binary is spawned
   * directly. Returns null if resolution is impossible.
   */
  _resolveExec(bin, isWindows = IS_WINDOWS) {
    const lower = bin.toLowerCase();

    // A direct JS entry must run via `node` on EVERY platform. Windows cannot
    // spawn a `.js` (no shebang support, not a PE → `spawn UNKNOWN`); on Unix a
    // shebang would work, but routing through node is equivalent and keeps
    // behaviour identical cross-platform. This also covers test mocks and any
    // install whose bin resolves straight to a JS file.
    if (lower.endsWith('.js') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) {
      return [this._findNodeBin(), bin];
    }

    if (!isWindows) return [bin];

    // Native executable — spawn directly (shell:false keeps argv literal).
    if (lower.endsWith('.exe')) return [bin];

    // npm/batch shim: resolve to its real target so we spawn shell:false and
    // every argv element (notably the prompt) stays literal — no cmd.exe
    // re-parsing, hence no quoting/injection hazard.
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      try {
        const content = fs.readFileSync(bin, 'utf-8');
        const m = content.match(/%dp0%\\([^\s"*?]+\.[cm]?js)/i);
        if (m) {
          return [this._findNodeBin(), path.resolve(path.dirname(bin), m[1])];
        }
        const exe = content.match(/%dp0%\\([^\s"*?]+\.exe)/i);
        if (exe) return [path.resolve(path.dirname(bin), exe[1])];
      } catch {}
      // Last resort: let cmd.exe run the shim. Args still travel as a literal
      // argv array via spawn (shell:false), not a concatenated string.
      return ['cmd.exe', '/c', bin];
    }

    // No extension (e.g. a Unix-style shim copied to Windows) — spawn directly.
    return [bin];
  }

  _findNodeBin() {
    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'bin', 'node'),
         path.join(home, '.openagents', 'nodejs', 'node')];
    for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch {} }
    return process.execPath || 'node';
  }

  // ------------------------------------------------------------------
  // Command construction (argv array — never a shell string)
  // ------------------------------------------------------------------

  /**
   * Build the argument vector (excluding the executable). The prompt is always a
   * single discrete argv element. Permissions are least-privilege and scoped to
   * the working directory.
   */
  _buildArgs(prompt, channel, { skipResume = false } = {}) {
    const wd = this.workingDir || defaultAgentWorkdir(this.agentName);
    // Required-value flags take the space form; optional-value/variadic flags
    // (--resume, --secret-env-vars, --allow-tool — declared `[=value]` /
    // `[=value...]` in `copilot --help` v1.0.63) MUST use the `=` form so the
    // next token isn't mistaken for a positional argument.
    const args = ['-p', prompt, '--output-format', 'json', '--stream', 'on'];

    if (this._model) args.push('--model', this._model);

    // Scope filesystem access to the working dir only (no --allow-all-paths).
    args.push('--add-dir', wd);

    // Privacy: do not let the session be remote-controlled from GitHub web/mobile
    // (verified flag `--no-remote`). We never pass --share / --share-gist.
    args.push('--no-remote');

    // The workspace cannot service interactive prompts, so disable them and
    // pre-authorize a least-privilege tool set instead of --allow-all/--yolo.
    // Tool IDs `shell` and `write` are verified against `copilot help permissions`.
    args.push('--no-ask-user');
    if (this._mode === 'plan') {
      // Analysis/planning only — do not grant write capability.
      args.push('--plan');
    } else {
      for (const t of ACT_ALLOW_TOOLS) args.push(`--allow-tool=${t}`);
    }

    // Defense-in-depth: tell Copilot which env-var NAMES to redact from its own
    // output (NEVER the values). Only list vars actually present in the child
    // env so we don't emit a meaningless argument.
    const env = this.agentEnv || process.env;
    const presentSecrets = SECRET_ENV_VARS.filter((k) => env[k]);
    if (presentSecrets.length) args.push(`--secret-env-vars=${presentSecrets.join(',')}`);

    // Resume the channel's prior session when we have a reference, else seed a
    // stable, working-dir-bound name we can resume by (verified: --resume matches
    // session id / task id / id-prefix / name, exact case-insensitive).
    const ref = this._channelSessions[channel];
    if (ref && !skipResume) {
      args.push(`--resume=${ref}`);
    } else if (!ref) {
      args.push('--name', this._stableSessionName(channel));
    }
    return args;
  }

  _buildSystemContext(channelName) {
    return buildOpenclawSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName,
      endpoint: this.endpoint,
      token: this.token,
      mode: this._mode,
      disabledModules: this.disabledModules,
    });
  }

  // ------------------------------------------------------------------
  // Control actions (stop / interrupt)
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel && this._channelProcesses[channel]) {
        this._stoppingChannels.add(channel);
        await this._stopProcess(this._channelProcesses[channel]);
        delete this._channelProcesses[channel];
        delete this._channelQueues[channel];
        try { await this.sendStatus(channel, 'Execution stopped by user'); } catch {}
      } else {
        for (const [ch, proc] of Object.entries(this._channelProcesses)) {
          this._stoppingChannels.add(ch);
          await this._stopProcess(proc);
          delete this._channelProcesses[ch];
          try { await this.sendStatus(ch, 'Execution stopped by user'); } catch {}
        }
      }
      return;
    }
    await super._onControlAction(action, payload);
  }

  /**
   * Daemon shutdown: tear down any in-flight Copilot subprocess so the thread
   * doesn't get stuck showing "running".
   */
  stop() {
    for (const proc of Object.values(this._channelProcesses)) {
      this._stopProcess(proc).catch(() => {});
    }
    super.stop();
  }

  /**
   * Graceful → forceful interrupt of a Copilot subprocess and its whole process
   * tree (Copilot may spawn shell/MCP children). SIGINT first so the CLI can
   * cancel managed work, then SIGTERM/SIGKILL on the process group (Unix) or
   * taskkill /T (Windows).
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
          exited = await this._waitExit(proc, 2000);
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
      if (proc.exitCode !== null) return resolve(true);
      const t = setTimeout(() => resolve(false), ms);
      proc.once('exit', () => { clearTimeout(t); resolve(true); });
    });
  }

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    const content = (msg.content || '').trim();
    if (!content) return;

    const channel = msg.sessionId || this.channelName;
    this._stoppingChannels.delete(channel);
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${channel}: ${redactSensitive(content).slice(0, 80)}...`);

    if (!this._copilotBin) {
      await this.sendError(channel,
        'GitHub Copilot CLI not found. Install it with: npm install -g @github/copilot');
      return;
    }

    // Hard version gate BEFORE spawning a turn: an older CLI lacks the flags /
    // JSONL output this adapter requires, so refuse rather than emit a confusing
    // "unknown option" failure on every run.
    const gate = this._checkVersionGate();
    if (gate.compatible === false) {
      await this.sendError(channel,
        `GitHub Copilot CLI ${gate.version} is too old — this integration requires ${MIN_VERSION} or newer. Upgrade with: copilot update (or npm install -g @github/copilot).`);
      return;
    }

    // Working directory must exist — never silently fall back to the repo cwd.
    const wd = this.workingDir;
    if (wd && !this._dirExists(wd)) {
      await this.sendError(channel, `Working directory does not exist: ${wd}`);
      return;
    }

    await this._autoTitleChannel(channel, content);
    await this.sendStatus(channel, 'thinking...');

    const fullPrompt = `${this._buildSystemContext(channel)}\n\n---\n\nUser message:\n${content}`;

    // Up to 2 attempts: resume first, then a fresh session if resume was stale.
    for (let attempt = 0; attempt < 2; attempt++) {
      const skipResume = attempt > 0;
      const args = this._buildArgs(fullPrompt, channel, { skipResume });
      this._logSpawn(channel, args, skipResume);

      let result;
      try {
        result = await this._runTurn(channel, args);
      } catch (e) {
        await this.sendError(channel, `Error: ${redactSensitive(e.message)}`);
        return;
      }

      if (this._stoppingChannels.has(channel)) return; // user interrupted

      // Stale resume → retry once without it.
      if (result.staleSession && attempt === 0 && this._channelSessions[channel]) {
        this._log(`Stale session for ${channel}; retrying with a fresh session`);
        delete this._channelSessions[channel];
        this._saveSessions();
        continue;
      }

      if (result.errorMessage) {
        await this.sendError(channel, result.errorMessage);
        return;
      }
      const text = (result.finalText || '').trim();
      if (text) {
        await this.sendResponse(channel, text);
      } else if (result.timedOut) {
        await this.sendError(channel, 'Copilot CLI timed out before producing a response.');
      } else {
        await this.sendResponse(channel, 'No response generated. Please try again.');
      }
      return;
    }
  }

  _dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  /**
   * Pre-launch version gate. Runs `copilot --version` once (cached), parses the
   * version, and compares against MIN_VERSION. Returns
   * { version, compatible: true|false|null }:
   *   • compatible:false → below MIN_VERSION, callers must not spawn.
   *   • compatible:null  → version unparseable/undetectable ("unknown"); we do
   *     NOT block (let the run proceed; runtime errors will surface real issues).
   * Mirrors the installer's generic gate semantics but lives in the adapter so a
   * too-old CLI never gets a turn spawned against it.
   */
  _checkVersionGate() {
    if (this._versionGate) return this._versionGate;
    let version = null;
    try {
      // Args as an array (no shell) so paths with spaces/backslashes are safe on
      // every platform. _resolveExec already normalizes a Windows .cmd shim.
      const [file, ...prefix] = this._resolveExec(this._copilotBin);
      const raw = execFileSync(file, [...prefix, '--version'], {
        encoding: 'utf-8', timeout: 8000, windowsHide: true, env: getEnhancedEnv(),
      }).trim();
      const m = raw.match(/(\d+\.\d+\.\d+)/);
      version = m ? m[1] : null;
    } catch {}
    let compatible;
    if (!version) compatible = null;
    else compatible = compareVersions(version, MIN_VERSION) >= 0;
    this._versionGate = { version, compatible };
    return this._versionGate;
  }

  _logSpawn(channel, args, skipResume) {
    // Log a redacted, prompt-free shape of the command. The prompt is replaced
    // with a placeholder; tokens never appear in argv but redact defensively.
    const shown = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-p') { shown.push('-p', '<prompt>'); i++; continue; }
      shown.push(args[i]);
    }
    this._log(`Spawning copilot ${redactSensitive(shown.join(' '))}${skipResume ? ' (no-resume retry)' : ''}`);
  }

  /**
   * Run one Copilot turn: spawn the subprocess, stream-parse stdout, map events
   * onto workspace messages, capture the session id, and resolve a summary of
   * the turn. Never rejects on CLI failure — failures come back as
   * `errorMessage` / `staleSession` / `timedOut` so the caller can react.
   */
  _runTurn(channel, args) {
    const [file, ...prefix] = this._resolveExec(this._copilotBin);
    const env = getEnhancedEnv({ ...(this.agentEnv || process.env) });
    const cwd = this.workingDir || defaultAgentWorkdir(this.agentName);

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(file, [...prefix, ...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
          cwd,
          detached: !IS_WINDOWS,
          windowsHide: true,
        });
      } catch (e) {
        return resolve({ errorMessage: `Failed to launch Copilot CLI: ${redactSensitive(e.message)}` });
      }
      this._channelProcesses[channel] = proc;

      // Guard the child's stdio streams against 'error'. When the process is
      // SIGKILL'd on stop, macOS Node can emit a benign EPIPE/ECONNRESET 'error'
      // on stdout/stderr a tick later; with a 'data' listener but no 'error'
      // listener that becomes an uncaughtException which crashes the
      // (single-process, e.g. Node 18) test run with exit 1 and no `not ok`.
      // No-op — data handling below is unchanged.
      if (proc.stdout) proc.stdout.on('error', () => {});
      if (proc.stderr) proc.stderr.on('error', () => {});

      const parser = new CopilotStreamParser();
      // Final-answer accumulation. `finalParts` holds authoritative `text`
      // events; `deltaBuf` holds streamed `text_delta` text for the current
      // contiguous block. A final `text` event SUPERSEDES the deltas of its
      // block (deltas are the streamed pieces of the same message) so the answer
      // is never duplicated. A tool/file/shell event between text starts a new
      // block (only the last contiguous block becomes the answer; earlier text
      // was shown live as thinking).
      const finalParts = [];
      let deltaBuf = '';
      const accumulatedText = () => (finalParts.length ? finalParts.join('\n') : deltaBuf).trim();
      let sawToolSinceText = false;
      let errorEvent = null;
      let stderrBuf = '';
      let pending = Promise.resolve();
      let settled = false;

      const timeout = setTimeout(() => {
        this._stopProcess(proc).catch(() => {});
        finish({ timedOut: true, finalText: accumulatedText() });
      }, TURN_TIMEOUT_MS);

      const finish = (summary) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        delete this._channelProcesses[channel];
        resolve(summary);
      };

      const handle = async (ev) => {
        switch (ev.kind) {
          case 'session':
            if (ev.sessionId) {
              this._channelSessions[channel] = ev.sessionId;
              this._saveSessions();
            }
            break;
          case 'text_delta':
            // Streamed interim text is shown live as `thinking`; the final
            // `text` event (if any) is the authoritative answer.
            if (sawToolSinceText) { finalParts.length = 0; deltaBuf = ''; sawToolSinceText = false; }
            if (ev.text) { deltaBuf += ev.text; try { await this.sendThinking(channel, ev.text); } catch {} }
            break;
          case 'text':
            // A complete message supersedes the deltas streamed for this block.
            if (sawToolSinceText) { finalParts.length = 0; sawToolSinceText = false; }
            deltaBuf = '';
            if (ev.text) finalParts.push(ev.text);
            break;
          case 'reasoning':
            if (ev.text) { try { await this.sendThinking(channel, ev.text); } catch {} }
            break;
          case 'tool_start':
            sawToolSinceText = true;
            try { await this.sendStatus(channel, this._describeTool(ev)); } catch {}
            break;
          case 'shell':
            sawToolSinceText = true;
            try {
              const ec = (ev.exitCode != null) ? ` (exit ${ev.exitCode})` : '';
              await this.sendStatus(channel, `**Running:** \`${redactSensitive(String(ev.command)).slice(0, 200)}\`${ec}`);
            } catch {}
            break;
          case 'file_change':
            sawToolSinceText = true;
            try { await this.sendStatus(channel, `**${ev.action === 'read' ? 'Reading' : 'Editing'}:** \`${ev.path}\``); } catch {}
            break;
          case 'tool_result':
            // Tool output is operational detail, not an assistant reply — keep it
            // out of the chat body; just log a redacted note.
            this._log(`tool_result ${ev.tool}${ev.isError ? ' (error)' : ''}`);
            break;
          case 'permission':
            try { await this.sendStatus(channel, `Permission ${ev.granted ? 'granted' : 'denied'}: ${redactSensitive(ev.detail).slice(0, 160)}`); } catch {}
            break;
          case 'ask_user':
            // We launched with --no-ask-user; if a prompt still surfaces, the
            // workspace can't answer it. Record it so the turn fails clearly.
            errorEvent = errorEvent || { message: 'Copilot requested interactive input, which the workspace cannot provide. Re-run with a more specific task.' };
            break;
          case 'usage':
            this._log(`usage model=${ev.model || '?'}`);
            break;
          case 'error':
            errorEvent = errorEvent || { message: ev.message, code: ev.code };
            break;
          case 'done':
            break;
          case 'unknown':
            // Preserve a redacted diagnostic; never crash the task.
            this._log(`unknown event: ${ev.raw}`);
            break;
          default:
            break;
        }
      };

      proc.stdout.on('data', (chunk) => {
        for (const ev of parser.push(chunk)) {
          pending = pending.then(() => handle(ev)).catch(() => {});
        }
      });
      if (proc.stderr) {
        proc.stderr.on('data', (c) => { stderrBuf += c.toString('utf-8'); });
      }

      proc.on('error', (err) => {
        finish({ errorMessage: `Copilot CLI failed to start: ${redactSensitive(err.message)}` });
      });

      proc.on('exit', async (code) => {
        try { for (const ev of parser.flush()) await handle(ev); } catch {}
        try { await pending; } catch {}

        if (this._stoppingChannels.has(channel)) {
          return finish({ interrupted: true, finalText: accumulatedText() });
        }

        const finalText = accumulatedText();
        const classified = this._classifyOutcome(code, errorEvent, stderrBuf);
        if (classified) {
          // A resume against a vanished session: surface as stale so the caller
          // retries fresh instead of erroring the user.
          if (classified.staleSession) return finish({ staleSession: true });
          // If the CLI still produced a usable answer, prefer it over a soft error.
          if (finalText && !classified.hard) return finish({ finalText });
          return finish({ errorMessage: classified.message });
        }
        finish({ finalText });
      });
    });
  }

  _describeTool(ev) {
    let preview = '';
    const inp = ev.input;
    if (inp && typeof inp === 'object') {
      preview = inp.command || inp.path || inp.file || inp.file_path || inp.pattern
        || inp.query || inp.url || (typeof inp.content === 'string' ? inp.content.slice(0, 80) : '')
        || JSON.stringify(inp).slice(0, 120);
    } else if (inp != null) {
      preview = String(inp).slice(0, 120);
    }
    return `${ev.tool} › ${redactSensitive(String(preview))}`;
  }

  // ------------------------------------------------------------------
  // Error classification (based on event, exit code, and stderr)
  // ------------------------------------------------------------------

  /**
   * Turn a turn's terminal signals into a concise, actionable user message and
   * a stale-session hint. Returns null when the turn succeeded. Detailed,
   * redacted text only goes to the dev log.
   *
   * String patterns are anchored on REAL Copilot CLI v1.0.63 stderr (see
   * test/fixtures/copilot-cli-real-samples.md) — note auth/session/network
   * failures in non-interactive mode print to stderr with EMPTY stdout (no JSONL
   * error event), so classification is driven by stderr + exit code. Broader
   * synonyms are kept as forward-compatible fallbacks.
   */
  _classifyOutcome(exitCode, errorEvent, stderr) {
    const blob = redactSensitive(`${errorEvent ? (errorEvent.message || '') + ' ' + (errorEvent.code || '') : ''} ${stderr || ''}`).trim();
    const ok = (exitCode === 0 || exitCode == null) && !errorEvent;
    if (ok) return null;

    if (blob) this._log(`Copilot failure (exit=${exitCode}): ${blob.slice(0, 400)}`);

    const has = (re) => re.test(blob);

    // Session resume miss → retry fresh (not a user-facing error).
    // Real: "Error: No session, task, or name matched 'NAME'."
    if (has(/no session,? .*matched|session\s+(not\s+found|expired|unknown|invalid)|no such session/i)) {
      return { staleSession: true };
    }
    // Token present but REJECTED — must be checked BEFORE the no-credentials rule
    // because the real CLI appends the SAME "To authenticate … gh auth login"
    // help block to both messages; only the leading line distinguishes them.
    // Real: "Authentication token found but could not be validated. Failed to
    // fetch PAT user login (401): ... Bad credentials".
    if (has(/could not be validated|bad credentials|authentication token found but|token.*(expired|revoked|invalid)|invalid.*token|\b401\b|unauthorized/i)) {
      return { hard: true, message: 'GitHub Copilot token is invalid, expired, or revoked (401). Re-authenticate with a fine-grained token that has the "Copilot Requests" permission, or run `copilot` and use /login. (Classic ghp_ tokens are not supported.)' };
    }
    // No credentials at all. Real distinguishing line: "No authentication
    // information found." (Do NOT key on the shared "gh auth login" tail.)
    if (has(/no authentication information|not (logged|signed) in|no (credentials|token)\b|login required/i)) {
      return { hard: true, message: 'Not signed in to GitHub Copilot. Set COPILOT_GITHUB_TOKEN (or GH_TOKEN/GITHUB_TOKEN), run `gh auth login`, or run `copilot` and use /login.' };
    }
    if (has(/\b403\b|forbidden|sso|saml|single sign-on|not authorized for/i)) {
      return { hard: true, message: 'Access denied (403). This is usually SAML/SSO not authorized for your token, or insufficient token scope for Copilot CLI.' };
    }
    if (has(/organization|enterprise|policy|disabled by|not allowed by|blocked by/i)) {
      return { hard: true, message: 'GitHub Copilot CLI is blocked by an organization/enterprise policy for this account.' };
    }
    if (has(/subscription|not entitled|no copilot|copilot.*(unavailable|inactive)|no seat|seat/i)) {
      return { hard: true, message: 'No active GitHub Copilot subscription/seat for this account.' };
    }
    // GitHub Enterprise host misconfiguration (GH_HOST / COPILOT_GH_HOST / --host).
    if (has(/gh_host|copilot_gh_host|enterprise.*host|host.*not.*found|unknown host|could not resolve host|invalid host/i)) {
      return { hard: true, message: 'GitHub host configuration error. Check GH_HOST / COPILOT_GH_HOST (GitHub Enterprise data-residency hostname).' };
    }
    // BYOK custom provider misconfiguration (COPILOT_PROVIDER_*).
    if (has(/copilot_provider|provider.*(base.?url|api.?key|not configured|invalid)|byok/i)) {
      return { hard: true, message: 'Custom model provider (BYOK) is misconfigured. Check COPILOT_PROVIDER_BASE_URL / COPILOT_PROVIDER_API_KEY / COPILOT_PROVIDER_TYPE.' };
    }
    if (has(/model.*(not found|unavailable|unsupported)|unknown model|invalid model/i)) {
      return { hard: true, message: 'The requested model is unavailable for this account. Clear COPILOT_MODEL or pick a supported model.' };
    }
    if (has(/rate limit|429|too many requests|quota|credit/i)) {
      return { hard: true, message: 'Rate limited or out of Copilot credits. Please wait and try again.' };
    }
    if (has(/check your network|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo|socket hang up|503|502|service unavailable/i)) {
      return { hard: true, message: 'Network or GitHub service error reaching Copilot. Check connectivity and try again.' };
    }
    if (has(/permission|not authorized|denied|not allowed to (write|read|run)/i)) {
      return { hard: true, message: 'Copilot was denied a required permission (path/tool). The task may need access outside the working directory.' };
    }
    if (errorEvent && errorEvent.message) {
      return { hard: true, message: `Copilot error: ${redactSensitive(errorEvent.message).slice(0, 300)}` };
    }
    if (exitCode && exitCode !== 0) {
      return { hard: false, message: `Copilot CLI exited with code ${exitCode}.` };
    }
    return null;
  }
}

module.exports = CopilotAdapter;
module.exports.MIN_VERSION = MIN_VERSION;
