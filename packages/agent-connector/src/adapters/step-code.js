/**
 * Step Code adapter for OpenAgents workspace.
 *
 * Bridges StepFun's terminal coding agent (`step`, installed by
 * static-openapi.stepfun.com/stepcode/install.sh | install.ps1 into
 * ~/.stepcode/bin) to an OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one headless `step -p --mode json` run per user message, prompt piped
 *     over stdin
 *   - workspace tools over MCP, declared in the run's own config.toml
 *   - session continuity per channel: an id chosen here, passed with
 *     --session-id, which creates the session on the first turn and resumes it
 *     on every later one
 *
 * Step Code is StepFun's build of the Pi runtime, and its JSON stream is
 * Pi's: framing, event classification and the assistant-block accumulator
 * come from pi-stream.js. The adapter itself is not PiAdapter's — that one
 * keeps a long-lived `pi --mode rpc` process per channel and reaches the
 * workspace over curl, while this one needs a fresh, isolated config root per
 * channel (for the MCP server and the credential) and whole-tree Stop.
 *
 * Decisions worth knowing before editing this file (the verified facts behind
 * them are in step-code-runtime.js):
 *
 *   THE USER'S STEP CONFIG IS NOT READ. The agent directory points at a
 *   private directory per channel, and its parent — where the CLI looks for
 *   config.toml, auth.json and models.json — is written by this adapter. So
 *   the user's MCP servers (also those imported from Claude Code / Codex),
 *   saved models, default model and permission tier never reach a run, and
 *   their saved sign-in cannot outrank the key in the form (which it
 *   otherwise does). With no key the run points STEPCODE_AUTH_PATH back at the
 *   user's own sign-in instead. Project instructions (AGENTS.md / CLAUDE.md)
 *   and the skills in ~/.stepcode/skills, ~/.agents/skills and
 *   ~/.claude/skills still load, as they do for the user.
 *
 *   NOTHING LANDS IN THE PROJECT. Plans go to a directory of ours
 *   (STEP_CODING_AGENT_PLAN_DIR), transcripts to --session-dir, plugins and
 *   logs to STEPCODE_STORAGE_ROOT_DIR. The CLI edits no rc file and no git
 *   ignore file on a headless run (verified).
 *
 *   PLAN MODE IS STICKY. A session started with --plan stays in plan mode on
 *   every later run, flag or no flag: the state is a session entry. The
 *   stream reports each change (`step-plan` entries), so the adapter knows,
 *   and a channel back in execute mode first sends `/plan` — a local command
 *   that toggles plan mode off without a model call.
 *
 *   STOP KILLS THE TREE. SIGTERM ends the CLI in ~0.1s and it takes its shell
 *   commands and subagents along, but an MCP server that is still in its
 *   handshake (or ignores the end of its stdin) is left behind, and SIGKILL
 *   leaves the shell commands too (they run in sessions of their own). The
 *   descendants are read from the process table while the CLI is still alive,
 *   then signalled one by one (Windows: `taskkill /T`, which walks the same
 *   tree).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
// spawn() here is the WSL bridge from ../wsl: same signature as
// child_process.spawn, and a straight pass-through unless the resolved CLI
// lives on the other side of the Windows/WSL boundary.
const { spawn } = require('../wsl');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');
const { REASON } = require('./health-status');
const { defaultAgentWorkdir, whichBinary, whereBinary, getEnhancedEnv } = require('../paths');
const { PiJsonlFramer, PiAssistantAccumulator } = require('./pi-stream');
const { identityOf, findOwnInstall } = require('../binary-identity');
const {
  STEP_MIN_VERSION,
  buildStepArgs,
  buildStepChildEnv,
  buildStepConfigToml,
  classifyStepRun,
  classifyStepVersion,
  credentialValuesIn,
  descendantsOf,
  installHint,
  interpretStepFrame,
  parseFrame,
  parseProcessTable,
  readUserStepConfig,
  redactArgs,
  redactSecrets,
  resolveStepAuth,
  secretValuesIn,
  stepModelsUrl,
  stepRegionOf,
  summarizeModelsProbe,
  truncate,
  userStepPaths,
} = require('./step-code-runtime');

const IS_WINDOWS = process.platform === 'win32';

/**
 * The registry's `install.identify` for step-code: the installer's own dirs
 * and what `step --version` prints. Installer detection reads the same block
 * (see binary-identity.js), so the adapter and the marketplace agree on which
 * `step` is Step Code.
 */
let _stepIdentify;
function stepIdentify() {
  if (_stepIdentify !== undefined) return _stepIdentify;
  _stepIdentify = null;
  try {
    const catalog = require('../../registry.json');
    const entry = Array.isArray(catalog) ? catalog.find((e) => e && e.name === 'step-code') : null;
    _stepIdentify = identityOf(entry);
  } catch { /* bundle unreadable — PATH lookup only, no identity check */ }
  return _stepIdentify;
}

// Idle watchdog: with no stdout frame for this long we nudge the channel, and
// after MAX consecutive silences we kill a run that is probably wedged. It
// pauses while a tool call is out: a build or a slow MCP call is legitimately
// silent until its result comes back.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2;  // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;      // ~5 min of silence → kill

// `step --version` boots the whole runtime (~1s), so it is not run per message.
const VERSION_PROBE_TTL_MS = 5 * 60 * 1000;

// SIGTERM ends the CLI in well under a second; the grace is for a wedged one.
const STOP_GRACE_MS = 3000;

// The adapter's own look at the model list, after a run the CLI could not
// start for want of one.
const MODELS_PROBE_TIMEOUT_MS = 10000;

class StepCodeAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this._usesPinnedContext = true;
    // channel → { sessionId, workingDir, planActive }
    this._channelSessions = {};
    // channel → child process (the in-flight headless run)
    this._channelProcesses = {};
    this._stoppingChannels = new Set();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_step-code.json`,
    );
    // Everything a run writes, one directory per (workspace, agent): the
    // transcripts, plans, plugin store and the per-channel config roots.
    this._root = path.join(
      os.homedir(), '.openagents', 'step-code',
      `${StepCodeAdapter._safe(this.workspaceId)}_${StepCodeAdapter._safe(this.agentName)}`,
    );
    this._isWindows = IS_WINDOWS;
    this._versionProbe = null; // { at, bin, version, supported, foreign }
    this._watchdogIntervalMs = WATCHDOG_INTERVAL_MS;
    this._watchdogMax = WATCHDOG_MAX;
    this._loadSessions();
  }

  static _safe(value) {
    return String(value || 'default').replace(/[^A-Za-z0-9._-]/g, '_') || 'default';
  }

  /** The model this agent runs on: the workspace pick, else the form's. */
  modelLabel() {
    return resolveStepAuth(this.agentEnv, this.workspaceModel).model || null;
  }

  // ------------------------------------------------------------------
  // Session persistence (bound to the working directory)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (!fs.existsSync(this._sessionsFile)) return;
      const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      for (const [channel, entry] of Object.entries(data)) {
        if (entry && typeof entry === 'object' && typeof entry.sessionId === 'string' && entry.sessionId) {
          this._channelSessions[channel] = {
            sessionId: entry.sessionId,
            workingDir: entry.workingDir || null,
            planActive: entry.planActive === true,
          };
        }
      }
      this._log(`Loaded ${Object.keys(this._channelSessions).length} Step Code session(s)`);
    } catch {
      this._log('Could not load the Step Code sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * The session for this channel: its id, and whether this turn starts it.
   * --session-id creates a session that does not exist yet, so a fresh id is
   * recorded right away — the channel knows it even if the run dies first. A
   * session bound to another working directory is not resumed: its
   * conversation is about files that are not there.
   */
  _sessionFor(channel, workingDir) {
    const entry = this._channelSessions[channel];
    if (entry && entry.sessionId && (!entry.workingDir || !workingDir || entry.workingDir === workingDir)) {
      return { ...entry, fresh: false };
    }
    const fresh = { sessionId: crypto.randomUUID(), workingDir: workingDir || null, planActive: false };
    this._channelSessions[channel] = fresh;
    this._saveSessions();
    return { ...fresh, fresh: true };
  }

  _notePlanState(channel, sessionId, planActive) {
    const entry = this._channelSessions[channel];
    if (!entry || entry.sessionId !== sessionId || entry.planActive === planActive) return;
    entry.planActive = planActive;
    this._saveSessions();
  }

  _clearSession(channel) {
    if (this._channelSessions[channel]) {
      delete this._channelSessions[channel];
      this._saveSessions();
    }
  }

  // ------------------------------------------------------------------
  // Control actions + shutdown
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'restart') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        const proc = this._channelProcesses[channel];
        if (proc) await this._stopProcess(proc);
        this._clearSession(channel);
        try {
          await this.client.sendMessage(this.workspaceId, channel, this.token,
            'Session restarted — the next message starts a fresh Step Code session.',
            {
              senderType: 'agent',
              senderName: this.agentName,
              messageType: 'status',
              metadata: { agent_mode: this._mode },
              sessionId: this._sessionId,
            });
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

  stop() {
    super.stop();
    void this._stopAllProcesses('Agent stopped.');
  }

  async _stopAllProcesses(message = 'Execution stopped.') {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running Step Code process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * End the CLI and everything it started. Resolves true once the CLI and its
   * descendants are gone.
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode) return true;
    if (this._isWindows) {
      this._killTree(proc.pid);
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
  _killTree(pid) {
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
  // Binary resolution + version gate
  // ------------------------------------------------------------------

  /**
   * Locate the CLI. The installer's own directories come first: `step` is
   * also the name of Smallstep's certificate tool, which a PATH lookup can
   * find ahead of Step Code. A binary found anywhere else is accepted only
   * after `--version` answers like Step Code (see _checkVersion).
   */
  _findStepBinary() {
    const own = findOwnInstall(stepIdentify(), 'step', {
      env: this.agentEnv || process.env,
      platform: this._isWindows ? 'win32' : process.platform,
    });
    return own || whereBinary('step') || whichBinary('step') || null;
  }

  /**
   * Run `--version` and return raw output. Isolated for testing.
   *
   * Even `--version` starts the whole runtime (~1–2s) and, on the user's own
   * environment, writes a telemetry record and a config stub into
   * ~/.stepcode — so the probe runs on a private agent directory with
   * telemetry off.
   */
  _readVersionRaw(bin) {
    const probeRoot = path.join(this._root, 'probe');
    try {
      return execFileSync(bin, ['--version'], {
        encoding: 'utf-8',
        timeout: 15000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...(this.agentEnv || process.env),
          STEP_CODING_AGENT_DIR: path.join(probeRoot, 'agent'),
          STEPCODE_STORAGE_ROOT_DIR: path.join(probeRoot, 'storage'),
          STEPCODE_DISABLE_TELEMETRY: '1',
        },
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
    const verdict = classifyStepVersion(this._readVersionRaw(bin), stepIdentify());
    this._versionProbe = { ...verdict, bin, at: now };
    return this._versionProbe;
  }

  /** Why this binary cannot run, or null when it can. */
  _binaryProblem(bin) {
    if (!bin) return { reason: REASON.NOT_INSTALLED, message: `Step Code not found. Install it with: ${installHint()}` };
    const ver = this._checkVersion(bin);
    if (ver.foreign) {
      return {
        reason: REASON.NOT_INSTALLED,
        message: `The \`step\` at ${bin} is a different program (it answers like Smallstep's certificate CLI), not Step Code. Install Step Code with: ${installHint()}`,
      };
    }
    if (ver.supported === false) {
      return {
        reason: REASON.VERSION_INCOMPATIBLE,
        message: `Step Code ${ver.version} is below the minimum supported version ${STEP_MIN_VERSION}. Upgrade with \`step update\` or: ${installHint()}`,
      };
    }
    return null;
  }

  /** Daemon preflight: a missing, foreign or too-old CLI is reported up front. */
  preflight() {
    const bin = this._findStepBinary();
    const problem = this._binaryProblem(bin);
    if (problem) return { ok: false, reason: problem.reason, message: problem.message };
    const ver = this._versionProbe || {};
    this._log(`Step Code resolved: ${bin}${ver.version ? ` (v${ver.version})` : ''}`);
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // The run's private config root
  // ------------------------------------------------------------------

  /**
   * The private config root for one channel. The CLI reads config.toml,
   * auth.json and models.json from the agent directory's parent, so each
   * channel gets its own: the MCP server in config.toml carries the channel's
   * name, and two channels can run at once. The agent directory inside it
   * persists (Step keeps per-session context archives there).
   */
  _channelRoot(channel) {
    const id = crypto.createHash('sha256').update(String(channel || 'default')).digest('hex').slice(0, 16);
    return path.join(this._root, 'channels', id);
  }

  /** Command + args for the workspace MCP server, or null. */
  _mcpServerSpec(channel) {
    const mcpArgs = [
      'mcp-server',
      '--workspace-id', this.workspaceId,
      '--channel-name', channel,
      '--agent-name', this.agentName,
      '--endpoint', this.endpoint,
    ];
    if (this.disabledModules.has('files')) mcpArgs.push('--disable-files');
    if (this.disabledModules.has('browser')) mcpArgs.push('--disable-browser');
    if (this.disabledModules.has('knowledge')) mcpArgs.push('--disable-knowledge');
    const resolved = this._resolveMcpServerCmd(mcpArgs);
    if (!resolved) return null;
    const requester = typeof this.requesterEmailFor === 'function' ? this.requesterEmailFor(channel) : null;
    return {
      command: resolved.command,
      args: resolved.args,
      env: {
        OA_WORKSPACE_TOKEN: this.token,
        ...(requester ? { OPENAGENTS_REQUESTER_EMAIL: requester } : {}),
      },
    };
  }

  /** Locate this package's own CLI, which hosts the workspace MCP server. */
  _resolveMcpServerCmd(mcpArgs) {
    const siblingBin = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (fs.existsSync(siblingBin)) return { command: this._findNodeBin(), args: [siblingBin, ...mcpArgs] };

    const home = os.homedir();
    const ext = this._isWindows ? '.cmd' : '';
    const candidates = [];
    try {
      const runtimesRoot = path.join(home, '.openagents', 'runtimes');
      for (const d of fs.readdirSync(runtimesRoot, { withFileTypes: true })) {
        if (d.isDirectory()) candidates.push(path.join(runtimesRoot, d.name, 'node_modules', '.bin', `openagents${ext}`));
      }
    } catch {}
    candidates.push(path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `openagents${ext}`));
    let bin = candidates.find((c) => fs.existsSync(c)) || null;
    if (!bin) bin = whereBinary('openagents');
    if (!bin) return null;

    const entry = this._jsEntryOf(bin);
    if (entry) return { command: this._findNodeBin(), args: [entry, ...mcpArgs] };
    return { command: bin, args: mcpArgs };
  }

  /** The launcher's managed Node, else the one running this daemon. */
  _findNodeBin() {
    const home = os.homedir();
    const candidates = this._isWindows
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'), path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return process.execPath;
  }

  /**
   * The JS entry behind an npm shim (so the MCP server runs under a Node of
   * ours instead of through cmd.exe), or null for anything else.
   */
  _jsEntryOf(binPath) {
    try {
      if (this._isWindows && binPath.toLowerCase().endsWith('.cmd')) {
        const m = fs.readFileSync(binPath, 'utf-8').match(/%~?dp0%?[\\/]?([^\s"*?]+\.m?js)/i);
        if (m) {
          const target = path.resolve(path.dirname(binPath), m[1]);
          return fs.existsSync(target) ? target : null;
        }
        return null;
      }
      let target = binPath;
      if (fs.lstatSync(binPath).isSymbolicLink()) target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
      return /\.(c|m)?js$/.test(target) ? target : null;
    } catch {
      return null;
    }
  }

  /**
   * Write the channel root's config.toml for this run and return its path
   * (null if it could not be written — the run then cannot proceed safely,
   * since the CLI would fall back to a default config with no MCP server).
   * It carries the workspace token, so it is 0600 and removed when the run
   * ends; the CLI only reads it at startup.
   */
  _writeRunConfig(channel, configRoot, userConfig, planMode = false) {
    try {
      fs.mkdirSync(path.join(configRoot, 'agent'), { recursive: true });
      const mcp = this._mcpServerSpec(channel);
      if (!mcp) this._log('Could not find the openagents binary — workspace MCP tools are unavailable this run');
      const file = path.join(configRoot, 'config.toml');
      fs.writeFileSync(file, buildStepConfigToml({
        mcp,
        shellPath: userConfig.shellPath,
        telemetryDisabled: userConfig.telemetryDisabled,
        planMode,
      }), { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch {}
      return file;
    } catch (e) {
      this._log(`Could not write the Step Code run config: ${redactSecrets(e && e.message)}`);
      return null;
    }
  }

  _readUserConfig(userPaths) {
    try {
      return readUserStepConfig(fs.readFileSync(userPaths.configPath, 'utf-8'));
    } catch {
      return readUserStepConfig('');
    }
  }

  /** Whether the user's own auth.json holds a Step credential. */
  _hasLoginCredential(userPaths) {
    try {
      const data = JSON.parse(fs.readFileSync(userPaths.authPath, 'utf-8'));
      return !!(data && data.step && typeof data.step === 'object');
    } catch {
      return false;
    }
  }

  /**
   * Add the user's saved Step credentials to a run's redaction list, and
   * return a function that adds them again whenever the files change. A
   * sign-in run reads auth.json and the account session beside it, and the
   * CLI rewrites both when it refreshes a token; every value seen stays on
   * the list, since output from before the refresh can still carry the old
   * one. A key run never uses them, but its shell tool can print them all the
   * same.
   */
  _trackSavedCredentials(userPaths, secrets) {
    const files = [userPaths.authPath, userPaths.loginStatePath].filter(Boolean);
    const seen = new Map();
    const sync = () => {
      for (const file of files) {
        let sig = null;
        try {
          const st = fs.statSync(file);
          sig = `${st.ino}:${st.size}:${st.mtimeMs}`;
        } catch {}
        if (seen.get(file) === sig) continue;
        seen.set(file, sig);
        if (!sig) continue;
        let values;
        try {
          values = credentialValuesIn(JSON.parse(fs.readFileSync(file, 'utf-8')));
        } catch {
          seen.delete(file); // caught mid-write: read it again next time
          continue;
        }
        for (const v of values) if (!secrets.includes(v)) secrets.push(v);
      }
    };
    sync();
    return sync;
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
  // Run
  // ------------------------------------------------------------------

  /**
   * Run one headless turn and consume its JSON stream.
   *
   * Pi delivers each assistant block twice (streamed, then again on
   * message_end); the accumulator releases each once. Text is held until its
   * message ends: a message that ends in a tool call is narration (posted as
   * thinking), any other is the answer candidate, and the last candidate is
   * the reply. An error on an assistant message is held as the turn's error
   * until a later message succeeds — auto-retry produces exactly that order.
   *
   * `secrets` is redacted by value from every frame and from stderr;
   * `syncSecrets`, when given, brings it up to date before each read.
   *
   * @returns {Promise<object>} { code, signal, sessionId, planActive,
   *   finalText, turnError, anyFrame, everPosted, userStopped,
   *   watchdogKilled, stderr, spawnError }
   */
  _runStep(channel, bin, args, workingDir, prompt, env = {}, secrets = [], { quiet = false, syncSecrets = null } = {}) {
    // Stopped while this turn was being prepared: start nothing.
    if (this._stoppedBeforeStart(channel)) return Promise.resolve({ userStopped: true });
    return new Promise((resolve) => {
      this._log(`Spawning: ${path.basename(bin)} ${redactArgs(args).join(' ')} (cwd=${workingDir})`);

      let proc;
      try {
        proc = spawn(bin, args, {
          cwd: workingDir,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          // Own process group: a stop reaches the CLI, its MCP servers and its
          // subagents (its shell commands are walked separately).
          detached: !this._isWindows,
          windowsHide: true,
        });
      } catch (e) {
        resolve({ code: null, signal: null, spawnError: e && e.message });
        return;
      }

      this._channelProcesses[channel] = proc;

      const framer = new PiJsonlFramer();
      const acc = new PiAssistantAccumulator();
      let settled = false;
      let stderrBuf = '';
      let sessionId = null;
      let planActive = null;
      let heldTexts = [];
      let answer = [];
      let turnError = null;
      let anyFrame = false;
      let everPosted = false;
      let lastFrameAt = Date.now();
      let silences = 0;
      let lastToolLabel = null;
      const toolsInFlight = new Set();
      let watchdogKilled = false;
      let exitInfo = null;
      let closeFallback = null;

      const post = (fn) => { if (!quiet) void fn().catch(() => {}); };
      const thinking = (text) => {
        if (!text || !String(text).trim()) return;
        everPosted = true;
        post(() => this.sendThinking(channel, text));
      };

      const onEvent = (ev) => {
        switch (ev.kind) {
          case 'session':
            if (ev.id) sessionId = ev.id;
            return;
          case 'plan_state':
            planActive = ev.enabled;
            return;
          case 'message_start':
            if (ev.role === 'assistant') acc.startMessage();
            return;
          case 'message_update':
            for (const block of acc.pushDelta(ev.delta)) {
              if (block.type === 'thinking') thinking(block.text);
              else heldTexts.push(block.text);
            }
            return;
          case 'message_end': {
            const msg = ev.message;
            if (!msg || msg.role !== 'assistant') return;
            const result = acc.endMessage(msg);
            for (const block of result.blocks) {
              if (block.type === 'thinking') thinking(block.text);
              else heldTexts.push(block.text);
            }
            if (result.errorMessage) turnError = result.errorMessage;
            else if (result.stopReason === 'error') turnError = turnError || 'The model stream ended with an error.';
            else turnError = null;
            const held = heldTexts;
            heldTexts = [];
            if (!held.length) return;
            if (result.stopReason === 'toolUse') {
              for (const text of held) thinking(text);
            } else {
              // A previous candidate is superseded — flush it as thinking so
              // nothing the model said is lost.
              for (const text of answer) thinking(text);
              answer = held;
              everPosted = true;
            }
            return;
          }
          case 'tool_start': {
            toolsInFlight.add(ev.toolCallId || ev.toolName);
            everPosted = true;
            const label = ev.preview ? `${ev.toolName} › ${ev.preview}` : ev.toolName;
            if (label && label !== lastToolLabel) {
              lastToolLabel = label;
              post(() => this.sendStatus(channel, label));
            }
            return;
          }
          case 'tool_end':
            toolsInFlight.delete(ev.toolCallId || ev.toolName);
            if (ev.isError) {
              lastToolLabel = null;
              post(() => this.sendStatus(channel, `${ev.toolName} failed${ev.preview ? `: ${ev.preview}` : ''}`));
            }
            return;
          case 'retry_start':
            post(() => this.sendStatus(channel,
              `Model error — retrying (attempt ${ev.attempt ?? '?'}${ev.maxAttempts ? `/${ev.maxAttempts}` : ''})...`));
            return;
          case 'retry_end':
            if (!ev.success) turnError = ev.finalError || turnError || 'Step Code exhausted its automatic retries.';
            return;
          case 'compaction_start':
            post(() => this.sendStatus(channel, 'Compacting the conversation context...'));
            return;
          case 'compaction_end':
            if (ev.error) post(() => this.sendStatus(channel, `Context compaction failed: ${ev.error}`));
            return;
          case 'extension_error':
            this._log(`Step Code extension error on ${channel}: ${redactSecrets(ev.message, secrets)}`);
            return;
          case 'unknown':
            this._log(`Unrecognized Step Code record (ignored): ${redactSecrets(ev.raw, secrets)}`);
            return;
          default:
            return;
        }
      };

      const onLines = (lines) => {
        for (const line of lines) {
          const frame = parseFrame(line);
          if (!frame) {
            if (String(line).trim()) this._log(`Non-JSON stdout line (ignored): ${truncate(redactSecrets(line, secrets), 200)}`);
            continue;
          }
          lastFrameAt = Date.now();
          silences = 0;
          anyFrame = true;
          try {
            onEvent(interpretStepFrame(frame, secrets));
          } catch (e) {
            this._log(`Frame handling failed: ${redactSecrets(e && e.message, secrets)}`);
          }
        }
      };

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        if (closeFallback) clearTimeout(closeFallback);
        if (this._channelProcesses[channel] === proc) delete this._channelProcesses[channel];
        resolve(payload);
      };

      const resync = () => {
        if (!syncSecrets) return;
        try { syncSecrets(); } catch {}
      };

      const done = () => {
        if (settled) return;
        resync();
        try { onLines(framer.flush()); } catch {}
        const userStopped = this._stoppingChannels.has(channel);
        this._stoppingChannels.delete(channel);
        const { code = null, signal = null } = exitInfo || {};
        finish({
          code,
          signal: watchdogKilled ? 'SIGKILL' : signal,
          sessionId,
          planActive,
          finalText: answer.join('\n').trim(),
          turnError,
          anyFrame,
          everPosted,
          userStopped,
          watchdogKilled,
          stderr: redactSecrets(stderrBuf, secrets),
        });
      };

      // A killed child's pipes can emit 'error' (EPIPE/ECONNRESET); unhandled,
      // that would take the daemon down.
      proc.stdout.on('error', () => {});
      proc.stderr.on('error', () => {});
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', (chunk) => {
        resync();
        let lines;
        try { lines = framer.push(chunk); } catch (e) {
          this._log(`Step Code stream framing error: ${redactSecrets(e && e.message, secrets)}`);
          return;
        }
        onLines(lines);
      });

      proc.stderr.on('data', (chunk) => {
        stderrBuf = (stderrBuf + chunk).slice(-8000);
      });

      proc.on('error', (e) => {
        finish({ code: null, signal: null, sessionId, planActive, finalText: '', turnError, anyFrame, everPosted, userStopped: false, spawnError: e && e.message });
      });

      proc.on('exit', (code, signal) => {
        exitInfo = { code, signal };
        // 'close' waits for every holder of the pipes; an MCP server or a
        // background command that outlived the CLI would hold them open.
        closeFallback = setTimeout(done, 2000);
      });

      proc.on('close', (code, signal) => {
        if (!exitInfo) exitInfo = { code, signal };
        done();
      });

      const watchdog = setInterval(() => {
        if (toolsInFlight.size) { silences = 0; return; }
        if (Date.now() - lastFrameAt < this._watchdogIntervalMs) return;
        silences += 1;
        if (silences === WATCHDOG_NUDGE_AT) post(() => this.sendStatus(channel, 'still working...'));
        if (silences >= this._watchdogMax) {
          this._log('No output for ~5 minutes — killing a wedged run');
          watchdogKilled = true;
          void this._stopProcess(proc);
        }
      }, this._watchdogIntervalMs);
      if (typeof watchdog.unref === 'function') watchdog.unref();

      try {
        proc.stdin.on('error', () => {});
        proc.stdin.write(prompt, 'utf-8');
        proc.stdin.end();
      } catch (e) {
        this._log(`Could not write the prompt to stdin: ${redactSecrets(e && e.message, secrets)}`);
      }
    });
  }

  /**
   * GET <base>/v1/models with the key — only after a run the CLI could not
   * start for want of a model, to tell a rejected key from an unreachable
   * endpoint. Isolated for testing.
   */
  async _probeModels(auth) {
    const url = stepModelsUrl(auth.baseUrl);
    if (!url) return null;
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (!done) { done = true; resolve(v); } };
      let req;
      try {
        const u = new URL(url);
        const lib = u.protocol === 'http:' ? http : https;
        // api.stepfun.com publishes an AAAA record. Where IPv6 does not route,
        // Node's default — 250ms per address, the last one included — gives
        // up on a far-away host before its IPv4 handshake completes (fetch()
        // reported ETIMEDOUT for a key api.stepfun.com answers with 401 at
        // once to curl and to the CLI). Each address gets longer here.
        req = lib.request(u, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${auth.key}` },
          autoSelectFamily: true,
          autoSelectFamilyAttemptTimeout: 2500,
          timeout: MODELS_PROBE_TIMEOUT_MS,
        }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { if (body.length < 2_000_000) body += c; });
          res.on('end', () => {
            let parsed = null;
            if (res.statusCode === 200) { try { parsed = JSON.parse(body); } catch {} }
            settle(summarizeModelsProbe({ status: res.statusCode, body: parsed }));
          });
          res.on('error', () => settle(summarizeModelsProbe({ networkError: true })));
        });
      } catch {
        settle(summarizeModelsProbe({ networkError: true }));
        return;
      }
      req.on('timeout', () => { req.destroy(); settle(summarizeModelsProbe({ networkError: true })); });
      req.on('error', () => settle(summarizeModelsProbe({ networkError: true })));
      req.end();
    });
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
    this._log(`Processing message from ${sender} in ${channel}: ${redactSecrets(truncate(content, 80))}`);

    // Never silently fall back to the launcher/repo dir.
    const workingDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    if (this.workingDir && !this._dirExists(this.workingDir)) {
      await this.sendError(channel, `Working directory does not exist: ${this.workingDir}`);
      return;
    }

    const bin = this._findStepBinary();
    const problem = this._binaryProblem(bin);
    if (problem) {
      this._reportStatus(problem.reason, problem.message);
      await this.sendError(channel, problem.message);
      return;
    }
    if (this._versionProbe && this._versionProbe.supported === null) {
      this._log('Could not determine the Step Code version — proceeding leniently');
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

    const auth = resolveStepAuth(this.agentEnv, this.workspaceModel);
    const browserEnabled = await this.getBrowserEnabled();

    // The Claude builder is reused verbatim: the MCP server's name makes the
    // workspace tools come out under the names it refers to.
    const systemPrompt = buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: channel,
      mode: this._mode,
      model: this.modelLabel(),
      browserEnabled,
      toolMode: 'mcp',
      ...this.pinnedPromptOpts(channel),
    });

    const baseEnv = getEnhancedEnv(this.agentEnv);
    const userPaths = userStepPaths(this.agentEnv || process.env, os.homedir());
    const userConfig = this._readUserConfig(userPaths);
    const configRoot = this._channelRoot(channel);
    const env = buildStepChildEnv(baseEnv, {
      auth,
      agentDir: path.join(configRoot, 'agent'),
      storageDir: path.join(this._root, 'storage'),
      planDir: path.join(this._root, 'plans'),
      userPaths,
      toolsDirExists: this._dirExists(userPaths.toolsDir),
      telemetryDisabled: userConfig.telemetryDisabled,
    });
    // The key, the workspace token, every credential-named value the shell
    // tool will be able to print, and the saved sign-in it can read off disk.
    const secrets = [...new Set([auth.key, this.token, ...secretValuesIn(env)].filter((s) => s && s.length >= 8))];
    const syncSecrets = this._trackSavedCredentials(userPaths, secrets);

    const planMode = this._mode === 'plan';
    const session = this._sessionFor(channel, workingDir);
    const sessionDir = path.join(this._root, 'sessions');
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch {}

    const configFile = this._writeRunConfig(channel, configRoot, userConfig, planMode);
    if (!configFile) {
      await this.sendError(channel, 'Step Code could not be started: its run configuration could not be written under ~/.openagents/step-code.');
      return;
    }

    // The native web search needs a StepFun account: the sign-in's, or a
    // Step Platform key. A relay's key cannot pay for it.
    const extraExcludedTools = auth.mode === 'key' && !stepRegionOf(auth.baseUrl) ? ['search_web'] : [];

    try {
      // Back in execute mode on a session that is still in plan mode: switch
      // it off first. `/plan` is handled by the CLI itself — no model call.
      if (!planMode && session.planActive && !session.fresh) {
        const toggle = await this._runStep(channel, bin, buildStepArgs({
          sessionDir, sessionId: session.sessionId, model: auth.model, extraExcludedTools,
        }), workingDir, '/plan', env, secrets, { quiet: true, syncSecrets });
        if (toggle.userStopped) return;
        if (toggle.planActive === false) this._notePlanState(channel, session.sessionId, false);
        else this._log(`Could not take session ${session.sessionId} out of plan mode — it stays in plan mode this turn`);
      }

      let prompt = content;
      if (session.fresh) {
        const recap = await this._buildChannelRecap(channel, content);
        if (recap) prompt = `${recap}\n\n---\n\n${content}`;
      }

      const args = buildStepArgs({
        sessionDir,
        sessionId: session.sessionId,
        appendSystemPrompt: systemPrompt,
        model: auth.model,
        planMode,
        extraExcludedTools,
      });
      const run = await this._runStep(channel, bin, args, workingDir, prompt, env, secrets, { syncSecrets });
      if (typeof run.planActive === 'boolean') this._notePlanState(channel, session.sessionId, run.planActive);
      if (run.userStopped) return; // the session stays resumable
      if (run.watchdogKilled) {
        await this.sendError(channel, 'Step Code stopped responding for 5 minutes and was restarted. Send the message again to continue.');
        return;
      }
      await this._postOutcome(channel, run, auth, userPaths);
    } finally {
      try { fs.unlinkSync(configFile); } catch {}
    }
  }

  async _postOutcome(channel, run, auth, userPaths) {
    if (run.spawnError) {
      await this.sendError(channel,
        `Step Code could not be started (${redactSecrets(run.spawnError)}). Reinstall it with: ${installHint()}`);
      return;
    }

    let probe = null;
    if (auth.mode === 'key' && !run.turnError && /no api key found|no models available/i.test(run.stderr || '')) {
      probe = await this._probeModels(auth);
    }
    const verdict = classifyStepRun({
      turnError: run.turnError,
      code: run.code,
      signal: run.signal,
      stderr: run.stderr,
      anyFrame: run.anyFrame,
      probe,
      hasLoginCredential: auth.mode === 'login' && this._hasLoginCredential(userPaths),
    }, auth);

    if (verdict.kind === 'auth') this._reportStatus(REASON.LOGIN_REQUIRED, verdict.userMessage);
    else this._reportStatus(null);

    const finalText = run.finalText || '';
    if (verdict.ok) {
      if (finalText) {
        try { await this.sendResponse(channel, finalText); } catch {}
      } else if (run.everPosted) {
        try { await this.sendResponse(channel, 'No response generated. Please try again.'); } catch {}
      } else {
        const diag = truncate((run.stderr || '').trim(), 400);
        try {
          await this.sendError(channel, 'Step Code finished without producing a response.' + (diag ? `\n\nLast diagnostics:\n${diag}` : ''));
        } catch {}
      }
      return;
    }

    // The model answered, then a later step failed: deliver the answer with
    // the reason appended rather than replacing it.
    if (finalText && verdict.kind !== 'auth') {
      this._log(`Run reported ${verdict.kind} but returned text; text delivered`);
      try { await this.sendResponse(channel, `${finalText}\n\n_${verdict.userMessage}_`); } catch {}
      return;
    }

    this._log(`Run failed (${verdict.kind}, exit ${run.code}): ${truncate(run.stderr || '', 300)}`);
    try { await this.sendError(channel, verdict.userMessage); } catch {}
  }
}

module.exports = StepCodeAdapter;
