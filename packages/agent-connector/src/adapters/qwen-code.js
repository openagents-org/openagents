/**
 * Qwen Code adapter for OpenAgents workspace.
 *
 * Bridges Alibaba's Qwen Code CLI (`npm i -g @qwen-code/qwen-code`, binary
 * `qwen`) to an OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one headless `qwen --output-format stream-json` run per user message,
 *     prompt piped over stdin; stopping the run stops the task
 *   - workspace tools over MCP, the same stdio server the Claude adapter wires
 *     up, pointed at with `--mcp-config`
 *   - session continuity per channel: the CLI's `session_id` comes back on the
 *     init frame and is replayed with `--resume` on the channel's next turn
 *
 * Four CLI-specific decisions are worth knowing before editing this file
 * (the verified facts behind them are in qwen-code-stream.js):
 *
 *   AUTO-MEMORY IS OFF. Left on, a memory-extractor subagent runs after every
 *   turn and the result frame waits for it — minutes, on a long session. The
 *   adapter loads a "system defaults" settings layer that turns it off; the
 *   user's own ~/.qwen/settings.json still outranks it.
 *
 *   THE KEY IS THE AGENT'S, AS A SET. Key, base URL and model come together
 *   from the agent's form (LLM_*) or together from OPENAI_*, and `--auth-type
 *   openai` is passed whenever there is a key. Without one, the CLI's own
 *   settings decide, so a provider configured with /auth keeps working.
 *
 *   SESSIONS BELONG TO A DIRECTORY. The CLI files a transcript under the
 *   working directory it ran in, and `--resume` from anywhere else fails. The
 *   channel's session is remembered together with its directory.
 *
 *   ON WINDOWS THE CLI IS TWO PROCESSES. Its entry script relaunches itself as
 *   a child (`node --expose-gc cli.js`), and killing the parent — which is all
 *   `ChildProcess.kill()` does there — leaves that child running the turn. Stop
 *   therefore goes straight to `taskkill /T`.
 *
 * Verified end to end against @qwen-code/qwen-code 0.25.1.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
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
  buildQwenArgs,
  buildQwenChildEnv,
  buildQwenSystemDefaults,
  classifyQwenRun,
  classifyQwenVersion,
  interpretQwenFrame,
  parseFrame,
  qwenSystemDefaultsSource,
  redactArgs,
  redactSecrets,
  resolveQwenCredentials,
  truncate,
  QWEN_MIN_VERSION,
} = require('./qwen-code-stream');

const IS_WINDOWS = process.platform === 'win32';

// Idle watchdog: with no stdout frame for this long we nudge the channel, and
// after MAX consecutive silences we kill a run that is probably wedged.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2;  // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;      // ~5 min of silence → kill

// The CLI's own floor (`engines.node` in its package.json), so an interpreter
// under it cannot run the agent at all.
const MIN_NODE_MAJOR = 22;

// Cache window for the version probe, so preflight never spawns `--version`
// more than once per window across channels.
const VERSION_PROBE_TTL_MS = 60000;

// Grace periods for a stop. The CLI answers SIGINT within ~100ms (it cancels
// the turn and kills its own shell tools), so escalation is for a wedged run.
const STOP_GRACE_MS = 3000;

const INSTALL_HINT = 'npm install -g @qwen-code/qwen-code';
const PACKAGE_DIR = ['@qwen-code', 'qwen-code'];

class QwenCodeAdapter extends BaseAdapter {
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
    // channel → child process (the in-flight headless run)
    this._channelProcesses = {};
    this._stoppingChannels = new Set();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_qwen-code.json`,
    );
    this._isWindows = IS_WINDOWS;
    this._versionProbe = null; // { at, bin, version, supported }
    this._loadSessions();
  }

  /**
   * The model this agent actually runs — exactly what is passed to the CLI,
   * so the workspace never shows a model the run did not use.
   */
  modelLabel() {
    return resolveQwenCredentials(this.agentEnv, this.workspaceModel).model || null;
  }

  // ------------------------------------------------------------------
  // Session persistence (Qwen Code session ids, bound to working dir)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Qwen Code session(s)`);
        }
      }
    } catch {
      this._log('Could not load Qwen Code sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * A resumable session id for this channel, or null.
   *
   * Qwen Code stores a transcript under the directory it ran in
   * (~/.qwen/projects/<dir>/chats), so a saved id from a different directory
   * would not resolve — resume only when the directory still matches.
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
    this._log(`Stopping ${entries.length} running Qwen Code process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * Stop a run. Resolves true once the process has exited, false when that
   * could not be confirmed.
   *
   * POSIX: SIGINT to the process group, which the CLI handles by cancelling the
   * turn and killing its own shell tools (they run in a PTY session of their
   * own, outside our group), then SIGTERM and SIGKILL for a wedged run.
   *
   * Windows: `taskkill /T /F` straight away. There is no SIGINT to send — Node
   * maps every kill() to TerminateProcess — and terminating only the entry
   * process would orphan the child it relaunched the CLI in (file header).
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null || proc.signalCode) return true;
    try {
      if (this._isWindows) {
        this._killTree(proc.pid);
        let exited = await this._waitExit(proc, STOP_GRACE_MS);
        if (!exited) {
          try { proc.kill(); } catch {}
          exited = await this._waitExit(proc, 1000);
        }
        return exited;
      }
      const signalGroup = (sig) => {
        try { process.kill(-proc.pid, sig); } catch { try { proc.kill(sig); } catch {} }
      };
      signalGroup('SIGINT');
      let exited = await this._waitExit(proc, STOP_GRACE_MS);
      if (!exited) {
        signalGroup('SIGTERM');
        exited = await this._waitExit(proc, 1500);
      }
      if (!exited) {
        signalGroup('SIGKILL');
        exited = await this._waitExit(proc, 1000);
      }
      return exited;
    } catch {
      return false;
    }
  }

  /** Kill a Windows process tree. Isolated for testing. */
  _killTree(pid) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 5000, windowsHide: true });
    } catch {}
  }

  _waitExit(proc, ms) {
    return new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode) { resolve(true); return; }
      const t = setTimeout(() => resolve(false), ms);
      proc.once('exit', () => { clearTimeout(t); resolve(true); });
    });
  }

  // ------------------------------------------------------------------
  // Binary resolution (cross-platform)
  // ------------------------------------------------------------------

  /**
   * Node interpreter used to execute a JS entry point.
   *
   * Prefer the launcher's managed runtime, and fall back to the interpreter
   * running this daemon when it clears `minMajor` (by default the CLI's own
   * floor). Returning null means "no suitable Node" and the caller spawns the
   * shim directly instead of guessing.
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

  /** Major version of a Node binary, or 0 when it cannot be read. */
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
   * Locate the Qwen Code CLI.
   *
   * The isolated runtime prefix is checked first so the version the launcher
   * installed wins over anything else on PATH. Tier 3 covers the official
   * standalone installer (install-qwen-standalone.sh / .ps1), which bundles
   * its own Node and puts a wrapper in ~/.local/bin or
   * %LOCALAPPDATA%\qwen-code\bin.
   */
  _findQwenBinary() {
    const home = os.homedir();
    const ext = this._isWindows ? '.cmd' : '';

    const prefixes = [
      path.join(home, '.openagents', 'runtimes', 'qwen-code', 'node_modules'),
      path.join(home, '.openagents', 'nodejs', 'node_modules'),
    ];

    // Tier 0: npm shim inside an OpenAgents-managed prefix.
    for (const root of prefixes) {
      const c = path.join(root, '.bin', `qwen${ext}`);
      if (fs.existsSync(c)) return c;
    }

    // Tier 0b: the package's own entry point, run under Node directly.
    for (const root of prefixes) {
      const entry = path.join(root, ...PACKAGE_DIR, 'cli-entry.js');
      if (fs.existsSync(entry)) return entry;
    }

    // Tier 1: PATH, via the codepage-safe lookup (a non-ASCII username would
    // otherwise be mangled into an ENOENT) using the enriched PATH.
    const viaWhere = whereBinary('qwen');
    if (viaWhere) return viaWhere;

    // Tier 2: next to the current Node interpreter (npm global installs).
    const nearNode = path.join(path.dirname(process.execPath), `qwen${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: common install locations, the standalone installer's included.
    const env = process.env;
    const candidates = [];
    if (env.QWEN_INSTALL_BIN_DIR) candidates.push(path.join(env.QWEN_INSTALL_BIN_DIR, `qwen${ext}`));
    if (env.QWEN_INSTALL_ROOT) candidates.push(path.join(env.QWEN_INSTALL_ROOT, 'bin', `qwen${ext}`));
    if (this._isWindows) {
      candidates.push(
        path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'qwen-code', 'bin', 'qwen.cmd'),
        path.join(env.APPDATA || '', 'npm', 'qwen.cmd'),
      );
    } else {
      candidates.push(
        path.join(home, '.local', 'bin', 'qwen'),
        path.join(home, '.npm-global', 'bin', 'qwen'),
        '/opt/homebrew/bin/qwen',
        '/usr/local/bin/qwen',
      );
    }
    for (const c of candidates) if (fs.existsSync(c)) return c;

    // Tier 4: deep scan of every known bin dir (nvm/fnm/volta/homebrew/…).
    return whichBinary('qwen') || null;
  }

  /**
   * True when `dir` is a standalone install: the release archive's layout,
   * with its manifest, its bundled Node, and the CLI's entry script.
   */
  _isStandaloneRoot(dir) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
      if (!manifest || manifest.name !== '@qwen-code/qwen-code') return false;
    } catch {
      return false;
    }
    return fs.existsSync(path.join(dir, 'lib', 'cli-entry.js'))
      && fs.existsSync(this._standaloneNode(dir));
  }

  _standaloneNode(dir) {
    return this._isWindows
      ? path.join(dir, 'node', 'node.exe')
      : path.join(dir, 'node', 'bin', 'node');
  }

  /**
   * The standalone install a binary path belongs to, or null.
   *
   * The path is either the archive's own launcher (<root>/bin/qwen[.cmd]) or
   * the installer's one-line wrapper on PATH, which names that launcher by
   * absolute path (`exec '<root>/bin/qwen' "$@"` / `call "<root>\bin\qwen.cmd" %*`).
   */
  _findStandaloneRoot(binPath) {
    const direct = path.resolve(path.dirname(binPath), '..');
    if (this._isStandaloneRoot(direct)) return direct;
    try {
      if (fs.statSync(binPath).size > 4096) return null;
      const text = fs.readFileSync(binPath, 'utf-8');
      const m = text.match(/(["'])([^"'\r\n]+?[\\/]bin[\\/]qwen(?:\.cmd)?)\1/i);
      if (m) {
        const root = path.resolve(path.dirname(m[2]), '..');
        if (this._isStandaloneRoot(root)) return root;
      }
    } catch {}
    return null;
  }

  /**
   * Resolve a shim to [nodeBin, jsEntry] so the JS entry point runs directly.
   * Returns null when no suitable Node exists or the target isn't a JS entry,
   * leaving the caller to spawn the shim as-is.
   */
  _resolveToNodeCmd(binPath, minMajor = MIN_NODE_MAJOR) {
    if (this._isWindows && binPath.toLowerCase().endsWith('.cmd')) {
      try {
        const cmdDir = path.dirname(path.resolve(binPath));
        const content = fs.readFileSync(binPath, 'utf-8');
        const jsMatch = content.match(/%dp0%\\([^\s"*?]+\.m?js)/i);
        if (jsMatch) {
          const target = path.resolve(cmdDir, jsMatch[1]);
          const nodeBin = fs.existsSync(target) ? this._findNodeBin(minMajor) : null;
          if (nodeBin) return [nodeBin, target];
        }
      } catch {}
      return null;
    }

    if (binPath.endsWith('.mjs') || binPath.endsWith('.js')) {
      const nodeBin = this._findNodeBin(minMajor);
      return nodeBin ? [nodeBin, binPath] : null;
    }

    try {
      let target = binPath;
      if (fs.lstatSync(binPath).isSymbolicLink()) {
        target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
      }
      if (target.endsWith('.mjs') || target.endsWith('.js') || this._isNodeShebangScript(target)) {
        const nodeBin = this._findNodeBin(minMajor);
        return nodeBin ? [nodeBin, target] : null;
      }
    } catch {}
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

  /**
   * How to spawn the CLI: { command, args, env } where env is an overlay.
   *
   * Every route ends at the CLI's JS entry under a Node that can run it,
   * because a Windows .cmd shim would put the whole command line — the
   * kilobytes-long system prompt included — through cmd.exe and its
   * 8191-character limit:
   *   - a standalone install runs on its own bundled Node, with the launcher
   *     path its shim would have exported;
   *   - an npm install runs on the launcher's Node (>= 22);
   *   - anything else is spawned as found.
   */
  _spawnPlan(binPath, args) {
    const root = this._findStandaloneRoot(binPath);
    if (root) {
      return {
        command: this._standaloneNode(root),
        args: [path.join(root, 'lib', 'cli-entry.js'), ...args],
        env: { QWEN_CODE_LAUNCHER_PATH: path.join(root, 'bin', this._isWindows ? 'qwen.cmd' : 'qwen') },
      };
    }
    const resolved = this._resolveToNodeCmd(binPath);
    if (resolved) return { command: resolved[0], args: [resolved[1], ...args], env: {} };
    if (this._isWindows && binPath.toLowerCase().endsWith('.cmd')) {
      return { command: 'cmd.exe', args: ['/c', binPath, ...args], env: {} };
    }
    return { command: binPath, args, env: {} };
  }

  // ------------------------------------------------------------------
  // Version preflight (cached; HARD minimum QWEN_MIN_VERSION)
  // ------------------------------------------------------------------

  /** Run `--version` and return raw output. Isolated for testing. */
  _readVersionRaw(bin) {
    try {
      const plan = this._spawnPlan(bin, ['--version']);
      return execFileSync(plan.command, plan.args, {
        encoding: 'utf-8',
        timeout: 15000,
        windowsHide: true,
        env: { ...getEnhancedEnv(this.agentEnv), ...plan.env },
      });
    } catch (e) {
      // A CLI that errors on --version still tells us its version sometimes.
      return (e && (e.stdout || e.stderr)) ? String(e.stdout || e.stderr) : '';
    }
  }

  /** Cached version verdict for a resolved binary. */
  _checkVersion(bin) {
    const now = Date.now();
    if (this._versionProbe && this._versionProbe.bin === bin && now - this._versionProbe.at < VERSION_PROBE_TTL_MS) {
      return this._versionProbe;
    }
    const verdict = classifyQwenVersion(this._readVersionRaw(bin));
    this._versionProbe = { ...verdict, bin, at: now };
    return this._versionProbe;
  }

  // ------------------------------------------------------------------
  // Settings layer
  // ------------------------------------------------------------------

  /**
   * Write the system-defaults settings file this run loads, and return its
   * path — or null to leave the CLI's own lookup alone.
   *
   * A machine-wide system-defaults file is merged in (and wins) rather than
   * replaced. One that exists but cannot be read is left in charge: the
   * adapter's settings are worth less than an administrator's.
   */
  _writeSystemDefaults() {
    const target = path.join(os.homedir(), '.openagents', 'qwen-code', 'system-defaults.json');
    try {
      let existing = null;
      const source = qwenSystemDefaultsSource(this.agentEnv, process.platform);
      if (source && path.resolve(source) !== target && fs.existsSync(source)) {
        try {
          existing = JSON.parse(fs.readFileSync(source, 'utf-8'));
        } catch {
          this._log(`Could not parse ${source}; leaving Qwen Code's system defaults as they are`);
          return null;
        }
      }
      const content = JSON.stringify(buildQwenSystemDefaults(existing), null, 2);
      let current = null;
      try { current = fs.readFileSync(target, 'utf-8'); } catch {}
      if (current !== content) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // Atomic replace: another channel's run may be reading it right now.
        const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, target);
      }
      return target;
    } catch (e) {
      this._log(`Could not write the Qwen Code settings layer: ${redactSecrets(e && e.message)}`);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Workspace MCP server
  // ------------------------------------------------------------------

  /**
   * Write the MCP config that gives this run the workspace_* tools, and return
   * its path (or null when the server entry point cannot be located — the run
   * still proceeds, just without workspace tools).
   *
   * The file carries the workspace token, so it is written 0600 into an
   * OpenAgents-owned directory rather than the user's project or their
   * ~/.qwen config. The caller deletes it when the run ends.
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
      const file = path.join(dir, `qwen-code-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch {}
      return file;
    } catch (e) {
      this._log(`Could not write the MCP config: ${redactSecrets(e && e.message)}`);
      return null;
    }
  }

  /**
   * Locate this package's own CLI, which hosts the workspace MCP server.
   * Returns { command, args } or null.
   */
  _resolveMcpServerCmd(mcpArgs) {
    const siblingBin = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (fs.existsSync(siblingBin)) {
      // The MCP server is this package's own code: any Node that runs the
      // daemon runs it, so the CLI's newer floor does not apply.
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

    const resolved = this._resolveToNodeCmd(bin, 0);
    if (resolved) return { command: resolved[0], args: [...resolved.slice(1), ...mcpArgs] };
    return { command: bin, args: mcpArgs };
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  /**
   * Short transcript of recent channel chat, used to re-seed a fresh session.
   * Only needed when there is no session to resume — the CLI already holds the
   * history in that case.
   */
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
   * Run one headless turn and consume its stream-json output.
   *
   * The prompt goes in over stdin; the reply comes off the single `result`
   * frame. Assistant frames only drive the live ticker, so a change to the
   * streaming shape costs a progress update, never the answer.
   *
   * @returns {Promise<object>} { code, signal, result, sessionId, anyOutput,
   *   lastAssistantText, apiErrors, userStopped, stderr }
   */
  _runQwen(channel, bin, args, workingDir, prompt, env = {}) {
    // Stopped while this turn was being prepared: start nothing (no tokens).
    if (this._stoppedBeforeStart(channel)) return Promise.resolve({ userStopped: true });
    return new Promise((resolve) => {
      const plan = this._spawnPlan(bin, args);
      this._log(`Spawning: ${path.basename(plan.command)} ${redactArgs(plan.args).join(' ')} (cwd=${workingDir})`);

      let proc;
      try {
        proc = spawn(plan.command, plan.args, {
          cwd: workingDir,
          env: { ...env, ...plan.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          // Own process group, so a stop reaches the CLI and anything it left
          // in our group.
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
      // The most recent assistant text, kept as a fallback answer for a clean
      // run whose result frame came back empty.
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

        const ev = interpretQwenFrame(frame);
        if (ev.kind === 'result') {
          result = ev;
          if (ev.sessionId) sessionId = ev.sessionId;
          return;
        }
        if (ev.kind === 'init') {
          // The id arrives here, BEFORE any model call — which is what keeps a
          // channel resumable even when the turn itself fails.
          if (ev.sessionId) sessionId = ev.sessionId;
          for (const s of ev.mcpServers) {
            if (s.status && s.status !== 'connected') {
              this._log(`MCP server ${s.name} is ${s.status} — its tools are unavailable this run`);
            }
          }
          return;
        }
        if (ev.kind === 'assistant') {
          apiErrors.push(...ev.apiErrors);
          if (ev.texts.length) lastAssistantText = ev.texts.join('\n');
          for (const text of ev.texts) {
            void this.sendThinking(channel, text).catch(() => {});
          }
          for (const tool of ev.tools) {
            // Only announce a CHANGE of activity: a run touching thirty files
            // would otherwise post thirty near-identical status lines.
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
        // Runs once: 'close' can still arrive after the fallback timer ended
        // the turn, by which time this channel may be on its next turn.
        if (settled) return;
        // Flush a trailing line with no newline (the result frame, if the CLI
        // exits without one).
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
          stderr: redactSecrets(stderrBuf),
        });
      };

      // A stopped or killed child's pipes can emit 'error' (EPIPE/ECONNRESET,
      // seen on macOS); unhandled, that would take the daemon down.
      proc.stdout.on('error', () => {});
      proc.stderr.on('error', () => {});

      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString('utf-8');
        let nl;
        while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          try { onFrame(line); } catch (e) { this._log(`Frame handling failed: ${redactSecrets(e && e.message)}`); }
        }
      });

      proc.stderr.on('data', (chunk) => {
        // Bounded: a long run must not grow it without limit.
        stderrBuf = truncate(stderrBuf + chunk.toString('utf-8'), 8000);
      });

      proc.on('error', (e) => {
        finish({ code: null, signal: null, result, sessionId, anyOutput, lastAssistantText, apiErrors, userStopped: false, spawnError: e && e.message });
      });

      proc.on('exit', (code, signal) => {
        exitInfo = { code, signal };
        // 'close' waits for every holder of the pipes. Something the CLI left
        // running could keep them open, and the turn would never end.
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
        this._log(`Could not write the prompt to stdin: ${redactSecrets(e && e.message)}`);
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

    const bin = this._findQwenBinary();
    if (!bin) {
      await this.sendError(channel, `Qwen Code CLI not found. Install it with: ${INSTALL_HINT}`);
      return;
    }

    // HARD minimum gate. A confirmed-older CLI rejects this adapter's argv; an
    // undetermined version (supported === null) proceeds leniently.
    const ver = this._checkVersion(bin);
    if (ver.supported === false) {
      this._log(`Refusing to start: Qwen Code ${ver.version} < minimum ${QWEN_MIN_VERSION}`);
      await this.sendError(channel,
        `Qwen Code ${ver.version} is below the minimum supported version ${QWEN_MIN_VERSION} ` +
        `(the first release that accepts --mcp-config). Upgrade with: ${INSTALL_HINT}`);
      return;
    }
    if (ver.supported === null) {
      this._log('Could not determine the Qwen Code version — proceeding leniently');
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

    const creds = resolveQwenCredentials(this.agentEnv, this.workspaceModel);

    // The Claude builder is reused verbatim: Qwen Code takes the same
    // --append-system-prompt hook, names MCP tools the same way
    // (mcp__<server>__<tool>), and reaches the workspace through the same
    // stdio MCP server, so the briefing is character-for-character the one
    // that adapter already writes.
    const systemPrompt = buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: channel,
      mode: this._mode,
      model: creds.model || null,
      browserEnabled: await this.getBrowserEnabled(),
      toolMode: 'mcp',
    });

    const env = buildQwenChildEnv(getEnhancedEnv(this.agentEnv), {
      creds,
      defaultsPath: this._writeSystemDefaults() || '',
    });

    // One retry: a stale session id (its transcript pruned, or the directory
    // re-keyed) fails the resume, and the turn is worth re-running fresh.
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumeId = attempt === 0 ? this._resumableSession(channel, workingDir) : null;

      // Resuming → the CLI already holds the history, so send the bare turn.
      // Fresh → prepend a recap of the channel.
      let prompt = content;
      if (!resumeId) {
        const recap = await this._buildChannelRecap(channel, content);
        if (recap) prompt = `${recap}\n\n---\n\n${content}`;
      }

      const mcpConfigPath = this._writeMcpConfig(channel);
      const args = buildQwenArgs({
        appendSystemPrompt: systemPrompt,
        authType: creds.apiKey ? 'openai' : '',
        model: creds.model,
        resumeSessionId: resumeId || undefined,
        mcpConfigPath: mcpConfigPath || undefined,
        planMode: this._mode === 'plan',
      });

      let run;
      try {
        run = await this._runQwen(channel, bin, args, workingDir, prompt, env);
      } finally {
        if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
      }

      if (run.userStopped) {
        // A stopped session is still resumable (verified), so the channel
        // keeps its conversation.
        this._rememberSession(channel, run.sessionId || resumeId, workingDir);
        return;
      }

      if (run.spawnError) {
        await this.sendError(channel,
          `Qwen Code CLI could not be started (${redactSecrets(run.spawnError)}). Reinstall it with: ${INSTALL_HINT}`);
        return;
      }

      const verdict = classifyQwenRun(run);

      // A resume the CLI could not find is the stale-session case: drop the
      // binding and retry once from scratch.
      if (resumeId && attempt === 0 && (verdict.kind === 'stale_session' || (!verdict.ok && !run.anyOutput))) {
        this._log(`Resume of session ${resumeId} failed (${verdict.kind}) — clearing and retrying fresh`);
        this._clearSession(channel);
        continue;
      }

      // Persist the session id for the next turn. It comes off the init frame,
      // so this survives a turn that failed at the model call.
      this._rememberSession(channel, run.sessionId || resumeId, workingDir);

      const resultText = run.result && run.result.text ? run.result.text.trim() : '';
      const finalText = resultText || (verdict.ok ? (run.lastAssistantText || '').trim() : '');

      if (verdict.ok) {
        try {
          await this.sendResponse(channel, finalText || 'No response generated. Please try again.');
        } catch {}
        return;
      }

      // A failed run that still produced text (the model answered, then a later
      // step failed) delivers the text with the reason appended rather than
      // replacing an answer the user can use.
      if (finalText) {
        this._log(`Run reported ${verdict.kind} but returned text; text delivered`);
        try { await this.sendResponse(channel, `${finalText}\n\n_${verdict.userMessage}_`); } catch {}
        return;
      }

      this._log(`Run failed (${verdict.kind}, exit ${run.code}): ${redactSecrets(truncate(run.stderr || '', 300))}`);
      try { await this.sendError(channel, verdict.userMessage); } catch {}
      return;
    }
  }
}

module.exports = QwenCodeAdapter;
