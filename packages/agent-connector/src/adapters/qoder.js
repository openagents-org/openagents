/**
 * Qoder CLI adapter for OpenAgents workspace.
 *
 * Bridges Qoder's terminal agent (`qodercli`, installed by qoder.com/install)
 * to an OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one headless `qodercli -p -o stream-json` run per user message, prompt
 *     piped over stdin
 *   - workspace tools over MCP (`--mcp-config` + `--strict-mcp-config`), the
 *     same stdio server the Claude adapter wires up
 *   - session continuity per channel: a new session gets an id chosen here
 *     (`--session-id`), later turns pass `-r <id>`
 *
 * The China edition (`qoderclicn`, qoder.com.cn) is the same CLI under another
 * brand, so QoderCnAdapter (qoder-cn.js) only swaps the edition table.
 *
 * Decisions worth knowing before editing this file (the verified facts behind
 * them are in qoder-runtime.js):
 *
 *   THE USER'S CONFIG ROOT STAYS. `--config-dir` / QODER_CONFIG_DIR would
 *   isolate a run completely, but the root holds the browser sign-in
 *   (<root>/.auth/user): moving it signs the agent out. Isolation is done
 *   layer by layer instead — the token in the env (read before any saved
 *   sign-in), `-m` (above every settings file), `--strict-mcp-config` (only
 *   the workspace server), and a flag settings layer for the rest.
 *
 *   NOTHING LANDS IN THE PROJECT OR THE SHELL. Transcripts, memory and plans
 *   live under the config root; the one write the CLI makes outside it on a
 *   fresh machine — rewriting the shell's rc files — is turned off with
 *   <prefix>NO_RC.
 *
 *   STOP KILLS THE TREE. The CLI starts its shell commands in sessions of
 *   their own and leaves its MCP servers running when terminated, so neither
 *   is reached through its process group. The descendants are read from the
 *   process table while the CLI is still alive, then signalled one by one
 *   (Windows: `taskkill /T`, which walks the same tree).
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
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');
const { defaultAgentWorkdir, whichBinary, whereBinary, getEnhancedEnv } = require('../paths');
const {
  EDITIONS,
  QODER_MIN_VERSION,
  buildQoderArgs,
  buildQoderChildEnv,
  classifyQoderRun,
  classifyQoderVersion,
  descendantsOf,
  installHint,
  interpretQoderFrame,
  parseFrame,
  parseProcessTable,
  redactArgs,
  redactSecrets,
  resolveQoderAuth,
  truncate,
} = require('./qoder-runtime');

const IS_WINDOWS = process.platform === 'win32';

// Idle watchdog: with no stdout frame for this long we nudge the channel, and
// after MAX consecutive silences we kill a run that is probably wedged.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2;  // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;      // ~5 min of silence → kill

// The npm edition's floor (`engines.node`); the native binary needs no Node.
const MIN_NODE_MAJOR = 20;

const VERSION_PROBE_TTL_MS = 60000;

// SIGTERM ends the CLI in well under a second; the grace is for a wedged one.
const STOP_GRACE_MS = 3000;

class QoderAdapter extends BaseAdapter {
  /** Which edition this adapter drives. QoderCnAdapter overrides it. */
  static get edition() {
    return EDITIONS.global;
  }

  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.edition = this.constructor.edition;
    this.disabledModules = opts.disabledModules || new Set();
    this._usesPinnedContext = true;
    // channel → { sessionId, workingDir }
    this._channelSessions = {};
    // channel → child process (the in-flight headless run)
    this._channelProcesses = {};
    this._stoppingChannels = new Set();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_${this.edition.type}.json`,
    );
    this._isWindows = IS_WINDOWS;
    this._versionProbe = null; // { at, bin, version, supported }
    this._loadSessions();
  }

  /** The model passed to the CLI, so the workspace never shows another one. */
  modelLabel() {
    return resolveQoderAuth(this.agentEnv, this.edition, this.workspaceModel).model || null;
  }

  // ------------------------------------------------------------------
  // Session persistence (bound to the working directory)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} ${this.edition.label} session(s)`);
        }
      }
    } catch {
      this._log(`Could not load ${this.edition.label} sessions file, starting fresh`);
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * A resumable session id for this channel, or null. The CLI files a
   * transcript under the directory it ran in (<root>/projects/<dir>), and
   * `-r` from anywhere else fails — so resume only from the same directory.
   */
  _resumableSession(channel, workingDir) {
    const entry = this._channelSessions[channel];
    if (!entry || !entry.sessionId) return null;
    if (entry.workingDir && workingDir && entry.workingDir !== workingDir) return null;
    return entry.sessionId;
  }

  _rememberSession(channel, sessionId, workingDir) {
    if (!sessionId) return;
    const prev = this._channelSessions[channel];
    if (prev && prev.sessionId === sessionId && prev.workingDir === workingDir) return;
    this._channelSessions[channel] = { sessionId, workingDir };
    this._saveSessions();
  }

  _clearSession(channel) {
    if (this._channelSessions[channel]) {
      delete this._channelSessions[channel];
      this._saveSessions();
    }
  }

  // ------------------------------------------------------------------
  // Shutdown
  // ------------------------------------------------------------------

  stop() {
    super.stop();
    void this._stopAllProcesses('Agent stopped.');
  }

  async _stopAllProcesses(message = 'Execution stopped.') {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running ${this.edition.label} process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * End the CLI and everything it started. Resolves true once the CLI is gone.
   *
   * SIGTERM, not SIGINT: during startup (MCP servers still connecting) the CLI
   * sits on SIGINT for ~30s, while SIGTERM ends it in under a second.
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
  // Binary resolution (cross-platform)
  // ------------------------------------------------------------------

  /**
   * Node interpreter for the npm edition's JS entry point: the launcher's
   * managed runtime, else the one running this daemon when it is new enough.
   */
  _findNodeBin(minMajor = MIN_NODE_MAJOR) {
    const home = os.homedir();
    const candidates = this._isWindows
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'),
         path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    for (const c of candidates) {
      if (fs.existsSync(c) && (!minMajor || this._nodeMajor(c) >= minMajor)) return c;
    }
    const ownMajor = parseInt(String(process.versions.node).split('.')[0], 10) || 0;
    return ownMajor >= minMajor ? process.execPath : null;
  }

  _nodeMajor(nodeBin) {
    try {
      const out = execFileSync(nodeBin, ['--version'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
      const m = String(out).match(/v(\d+)\./);
      return m ? parseInt(m[1], 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Locate the CLI. The official installer (the registry's route) leaves a
   * native binary at ~/.local/bin/<bin> → ~/<root>/bin/<bin>/<bin>-<ver> on
   * Unix, and %USERPROFILE%\<root>\bin\<bin>\<bin>.exe on Windows; the older
   * npm package is still found for anyone who installed that way.
   */
  _findQoderBinary() {
    const home = os.homedir();
    const { bin, npmPackage, configDirName } = this.edition;
    const ext = this._isWindows ? '.cmd' : '';
    const prefixes = [
      path.join(home, '.openagents', 'runtimes', this.edition.type, 'node_modules'),
      path.join(home, '.openagents', 'nodejs', 'node_modules'),
    ];

    // Tier 0: an OpenAgents-managed npm prefix (shim, then the entry itself).
    for (const root of prefixes) {
      const c = path.join(root, '.bin', `${bin}${ext}`);
      if (fs.existsSync(c)) return c;
    }
    for (const root of prefixes) {
      const entry = path.join(root, ...npmPackage, 'bundle', `${bin}.js`);
      if (fs.existsSync(entry)) return entry;
    }

    // Tier 1: the official installer's own locations.
    const native = this._isWindows
      ? [path.join(home, configDirName, 'bin', bin, `${bin}.exe`)]
      : [path.join(home, '.local', 'bin', bin), path.join(home, configDirName, 'bin', bin, bin)];
    for (const c of native) if (fs.existsSync(c)) return c;

    // Tier 2: PATH, via the codepage-safe lookup.
    const viaWhere = whereBinary(bin);
    if (viaWhere) return viaWhere;

    // Tier 3: next to the current Node (npm global), and npm's usual homes.
    const nearNode = path.join(path.dirname(process.execPath), `${bin}${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;
    const npmHomes = this._isWindows
      ? [path.join(process.env.APPDATA || '', 'npm', `${bin}.cmd`)]
      : [path.join(home, '.npm-global', 'bin', bin), `/opt/homebrew/bin/${bin}`, `/usr/local/bin/${bin}`];
    for (const c of npmHomes) if (fs.existsSync(c)) return c;

    // Tier 4: deep scan of every known bin dir (nvm/fnm/volta/homebrew/…).
    return whichBinary(bin) || null;
  }

  /**
   * Resolve an npm shim to [nodeBin, jsEntry]; null for the native binary or
   * when no suitable Node exists. Running the entry directly keeps a Windows
   * .cmd shim — and cmd.exe's 8191-character command line, which the
   * kilobytes of briefing in argv would overflow — out of the path.
   */
  _resolveToNodeCmd(binPath) {
    if (this._isWindows && binPath.toLowerCase().endsWith('.cmd')) {
      try {
        const cmdDir = path.dirname(path.resolve(binPath));
        const content = fs.readFileSync(binPath, 'utf-8');
        const jsMatch = content.match(/%dp0%\\([^\s"*?]+\.m?js)/i);
        if (jsMatch) {
          const target = path.resolve(cmdDir, jsMatch[1]);
          const nodeBin = fs.existsSync(target) ? this._findNodeBin() : null;
          if (nodeBin) return [nodeBin, target];
        }
      } catch {}
      return null;
    }
    try {
      let target = binPath;
      if (fs.lstatSync(binPath).isSymbolicLink()) {
        target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
      }
      if (/\.(c|m)?js$/.test(target) || this._isNodeShebangScript(target)) {
        const nodeBin = this._findNodeBin();
        return nodeBin ? [nodeBin, target] : null;
      }
    } catch {}
    return null;
  }

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

  /** How to spawn the CLI: { command, args }. */
  _spawnPlan(binPath, args) {
    const resolved = this._resolveToNodeCmd(binPath);
    if (resolved) return { command: resolved[0], args: [resolved[1], ...args] };
    if (this._isWindows && binPath.toLowerCase().endsWith('.cmd')) {
      return { command: 'cmd.exe', args: ['/c', binPath, ...args] };
    }
    return { command: binPath, args };
  }

  // ------------------------------------------------------------------
  // Version preflight (cached; HARD minimum QODER_MIN_VERSION)
  // ------------------------------------------------------------------

  /** Run `--version` and return raw output. Isolated for testing. */
  _readVersionRaw(bin) {
    try {
      const plan = this._spawnPlan(bin, ['--version']);
      return execFileSync(plan.command, plan.args, {
        encoding: 'utf-8',
        timeout: 15000,
        windowsHide: true,
        env: buildQoderChildEnv(getEnhancedEnv(this.agentEnv), { edition: this.edition }),
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
    const verdict = classifyQoderVersion(this._readVersionRaw(bin));
    this._versionProbe = { ...verdict, bin, at: now };
    return this._versionProbe;
  }

  // ------------------------------------------------------------------
  // Workspace MCP server
  // ------------------------------------------------------------------

  /**
   * Write the MCP config that gives this run the workspace_* tools, and return
   * its path (null when the server cannot be located — the run proceeds
   * without workspace tools). It carries the workspace token, so it is 0600
   * in an OpenAgents directory, never the project or the CLI's config root,
   * and the caller deletes it when the run ends.
   */
  _writeMcpConfig(channel) {
    try {
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
      if (!resolved) {
        this._log('Could not find the openagents binary — workspace MCP tools are unavailable this run');
        return null;
      }

      const config = {
        mcpServers: {
          'openagents-workspace': {
            command: resolved.command,
            args: resolved.args,
            env: { OA_WORKSPACE_TOKEN: this.token },
          },
        },
      };

      const dir = path.join(os.homedir(), '.openagents', 'mcp-configs');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${this.edition.type}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch {}
      return file;
    } catch (e) {
      this._log(`Could not write the MCP config: ${redactSecrets(e && e.message)}`);
      return null;
    }
  }

  /** Locate this package's own CLI, which hosts the workspace MCP server. */
  _resolveMcpServerCmd(mcpArgs) {
    const siblingBin = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (fs.existsSync(siblingBin)) {
      // The MCP server is this package's own code: any Node that runs the
      // daemon runs it.
      return { command: this._findNodeBin(0), args: [siblingBin, ...mcpArgs] };
    }

    const home = os.homedir();
    const ext = this._isWindows ? '.cmd' : '';
    const candidates = [];
    try {
      const runtimesRoot = path.join(home, '.openagents', 'runtimes');
      for (const d of fs.readdirSync(runtimesRoot, { withFileTypes: true })) {
        if (d.isDirectory()) {
          candidates.push(path.join(runtimesRoot, d.name, 'node_modules', '.bin', `openagents${ext}`));
        }
      }
    } catch {}
    candidates.push(path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `openagents${ext}`));

    let bin = candidates.find((c) => fs.existsSync(c)) || null;
    if (!bin) bin = whereBinary('openagents');
    if (!bin) return null;

    const resolved = this._resolveToNodeCmd(bin);
    if (resolved) return { command: resolved[0], args: [...resolved.slice(1), ...mcpArgs] };
    return { command: bin, args: mcpArgs };
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
   * Run one headless turn and consume its stream-json output. The reply comes
   * off the `result` frame; assistant frames only drive the live ticker.
   *
   * @returns {Promise<object>} { code, signal, result, sessionId, anyOutput,
   *   lastAssistantText, apiErrors, userStopped, stderr }
   */
  _runQoder(channel, bin, args, workingDir, prompt, env = {}, secrets = []) {
    // Stopped while this turn was being prepared: start nothing.
    if (this._stoppedBeforeStart(channel)) return Promise.resolve({ userStopped: true });
    return new Promise((resolve) => {
      const plan = this._spawnPlan(bin, args);
      this._log(`Spawning: ${path.basename(plan.command)} ${redactArgs(plan.args).join(' ')} (cwd=${workingDir})`);

      let proc;
      try {
        proc = spawn(plan.command, plan.args, {
          cwd: workingDir,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          // Own process group: a stop reaches the CLI and the MCP servers it
          // started (its shell commands are walked separately).
          detached: !this._isWindows,
          windowsHide: true,
        });
      } catch (e) {
        resolve({ code: null, signal: null, result: null, sessionId: null, anyOutput: false, userStopped: false, spawnError: e && e.message });
        return;
      }

      this._channelProcesses[channel] = proc;

      let settled = false;
      let stdoutBuf = '';
      let stderrBuf = '';
      let anyOutput = false;
      let result = null;
      let sessionId = null;
      let lastAssistantText = '';
      const apiErrors = [];
      let lastFrameAt = Date.now();
      let silences = 0;
      let lastToolLabel = null;
      let killedByWatchdog = false;
      let exitInfo = null;
      let closeFallback = null;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        if (closeFallback) clearTimeout(closeFallback);
        if (this._channelProcesses[channel] === proc) delete this._channelProcesses[channel];
        resolve(payload);
      };

      const onFrame = (line) => {
        const frame = parseFrame(line);
        if (!frame) return;
        lastFrameAt = Date.now();
        silences = 0;
        anyOutput = true;

        const ev = interpretQoderFrame(frame);
        if (ev.kind === 'result') {
          result = ev;
          if (ev.sessionId) sessionId = ev.sessionId;
          return;
        }
        if (ev.kind === 'init') {
          if (ev.sessionId) sessionId = ev.sessionId;
          for (const s of ev.mcpServers) {
            if (s && s.status && s.status !== 'connected') {
              this._log(`MCP server ${s.name} is ${s.status} — its tools are unavailable this run`);
            }
          }
          return;
        }
        if (ev.kind === 'assistant') {
          if (ev.apiError) {
            apiErrors.push(ev.apiError);
            return;
          }
          if (ev.texts.length) lastAssistantText = ev.texts.join('\n');
          for (const text of ev.texts) {
            void this.sendThinking(channel, text).catch(() => {});
          }
          for (const tool of ev.tools) {
            if (tool.todos) {
              const wsTodos = tool.todos.map((t) => ({
                content: t.content, status: t.status || 'pending', assignee: t.assignee,
              }));
              void this.sendTodos(channel, wsTodos).catch(() => {});
            }
            // Only announce a CHANGE of activity.
            const label = tool.preview ? `${tool.name} › ${tool.preview}` : tool.name;
            if (label && label !== lastToolLabel) {
              lastToolLabel = label;
              void this.sendStatus(channel, label).catch(() => {});
            }
          }
          return;
        }
        if (ev.kind === 'status') {
          void this.sendStatus(channel, ev.text).catch(() => {});
          return;
        }
        if (ev.kind === 'unknown') {
          this._log(`Unrecognized frame (ignored): ${ev.raw}`);
        }
      };

      const done = () => {
        if (settled) return;
        if (stdoutBuf.trim()) { try { onFrame(stdoutBuf); } catch {} stdoutBuf = ''; }
        const userStopped = this._stoppingChannels.has(channel);
        this._stoppingChannels.delete(channel);
        const { code = null, signal = null } = exitInfo || {};
        finish({
          code,
          signal: killedByWatchdog ? 'SIGKILL' : signal,
          result,
          sessionId,
          anyOutput,
          lastAssistantText,
          apiErrors,
          userStopped,
          stderr: redactSecrets(stderrBuf, secrets),
        });
      };

      // A killed child's pipes can emit 'error' (EPIPE/ECONNRESET); unhandled,
      // that would take the daemon down.
      proc.stdout.on('error', () => {});
      proc.stderr.on('error', () => {});
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk;
        let nl;
        while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          try { onFrame(line); } catch (e) { this._log(`Frame handling failed: ${redactSecrets(e && e.message, secrets)}`); }
        }
      });

      proc.stderr.on('data', (chunk) => {
        stderrBuf = truncate(stderrBuf + chunk, 8000);
      });

      proc.on('error', (e) => {
        finish({ code: null, signal: null, result, sessionId, anyOutput, lastAssistantText, apiErrors, userStopped: false, spawnError: e && e.message });
      });

      proc.on('exit', (code, signal) => {
        exitInfo = { code, signal };
        // 'close' waits for every holder of the pipes; an MCP server the CLI
        // left running would keep them open and the turn would never end.
        closeFallback = setTimeout(done, 2000);
      });

      proc.on('close', (code, signal) => {
        if (!exitInfo) exitInfo = { code, signal };
        done();
      });

      const watchdog = setInterval(() => {
        if (Date.now() - lastFrameAt < WATCHDOG_INTERVAL_MS) return;
        silences += 1;
        if (silences === WATCHDOG_NUDGE_AT) {
          void this.sendStatus(channel, 'still working...').catch(() => {});
        }
        if (silences >= WATCHDOG_MAX) {
          this._log('No output for ~5 minutes — killing a wedged run');
          killedByWatchdog = true;
          void this._stopProcess(proc);
        }
      }, WATCHDOG_INTERVAL_MS);

      try {
        proc.stdin.on('error', () => {});
        proc.stdin.write(prompt, 'utf-8');
        proc.stdin.end();
      } catch (e) {
        this._log(`Could not write the prompt to stdin: ${redactSecrets(e && e.message, secrets)}`);
      }
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

    const label = this.edition.label;
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

    const bin = this._findQoderBinary();
    if (!bin) {
      await this.sendError(channel, `${label} not found. Install it with: ${installHint(this.edition)}`);
      return;
    }

    const ver = this._checkVersion(bin);
    if (ver.supported === false) {
      this._log(`Refusing to start: ${label} ${ver.version} < minimum ${QODER_MIN_VERSION}`);
      await this.sendError(channel,
        `${label} ${ver.version} is below the minimum supported version ${QODER_MIN_VERSION}. ` +
        `Upgrade with: ${installHint(this.edition)}`);
      return;
    }
    if (ver.supported === null) {
      this._log(`Could not determine the ${label} version — proceeding leniently`);
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

    const auth = resolveQoderAuth(this.agentEnv, this.edition, this.workspaceModel);
    const browserEnabled = await this.getBrowserEnabled();

    // The Claude builder is reused verbatim: Qoder takes the same
    // --append-system-prompt hook and names MCP tools the same way, so the
    // briefing is character-for-character the one that adapter writes.
    const systemPrompt = buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: channel,
      mode: this._mode,
      model: auth.model || null,
      browserEnabled,
      toolMode: 'mcp',
      ...this.pinnedPromptOpts(channel),
    });

    const env = buildQoderChildEnv(getEnhancedEnv(this.agentEnv), { edition: this.edition, pat: auth.pat });
    const secrets = auth.pat ? [auth.pat] : [];

    // One retry: a saved session the CLI no longer has (pruned, or the turn
    // that created it never reached the model) fails the resume, and the turn
    // is worth re-running fresh.
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumeId = attempt === 0 ? this._resumableSession(channel, workingDir) : null;
      const newSessionId = resumeId ? null : crypto.randomUUID();

      let prompt = content;
      if (!resumeId) {
        const recap = await this._buildChannelRecap(channel, content);
        if (recap) prompt = `${recap}\n\n---\n\n${content}`;
      }

      const mcpConfigPath = this._writeMcpConfig(channel);
      const args = buildQoderArgs({
        appendSystemPrompt: systemPrompt,
        model: auth.model,
        resumeSessionId: resumeId || undefined,
        newSessionId: newSessionId || undefined,
        mcpConfigPath: mcpConfigPath || undefined,
        planMode: this._mode === 'plan',
        // The native fetch can't render JS and bypasses the workspace browser,
        // as in the Claude adapter.
        extraDisallowedTools: browserEnabled ? ['WebFetch'] : [],
      });

      let run;
      try {
        run = await this._runQoder(channel, bin, args, workingDir, prompt, env, secrets);
      } finally {
        if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
      }

      if (run.userStopped) {
        // A stopped session stays resumable, so the channel keeps its thread.
        this._rememberSession(channel, run.sessionId || resumeId || newSessionId, workingDir);
        return;
      }

      if (run.spawnError) {
        await this.sendError(channel,
          `${label} could not be started (${redactSecrets(run.spawnError, secrets)}). Reinstall it with: ${installHint(this.edition)}`);
        return;
      }

      const verdict = classifyQoderRun(run, this.edition);

      if (resumeId && attempt === 0 && (verdict.kind === 'stale_session' || (!verdict.ok && !run.anyOutput && verdict.kind !== 'auth'))) {
        this._log(`Resume of session ${resumeId} failed (${verdict.kind}) — clearing and retrying fresh`);
        this._clearSession(channel);
        continue;
      }

      // A run that never reached the model leaves no transcript to resume,
      // so only a turn that got going is remembered.
      if (verdict.ok || run.lastAssistantText || (run.result && !['auth', 'quota'].includes(verdict.kind))) {
        this._rememberSession(channel, run.sessionId || resumeId || newSessionId, workingDir);
      }

      const resultText = run.result && run.result.text ? run.result.text.trim() : '';
      const finalText = verdict.ok ? (resultText || (run.lastAssistantText || '').trim()) : '';

      if (verdict.ok) {
        try {
          await this.sendResponse(channel, finalText || 'No response generated. Please try again.');
        } catch {}
        return;
      }

      // The model answered, then a later step failed: deliver the answer with
      // the reason appended rather than replacing it.
      const partial = (run.lastAssistantText || '').trim();
      if (partial && verdict.kind !== 'auth') {
        this._log(`Run reported ${verdict.kind} but returned text; text delivered`);
        try { await this.sendResponse(channel, `${partial}\n\n_${verdict.userMessage}_`); } catch {}
        return;
      }

      this._log(`Run failed (${verdict.kind}, exit ${run.code}): ${redactSecrets(truncate(run.stderr || '', 300), secrets)}`);
      try { await this.sendError(channel, verdict.userMessage); } catch {}
      return;
    }
  }
}

module.exports = QoderAdapter;
