/**
 * Qoder adapter for OpenAgents workspace.
 *
 * Bridges Alibaba's Qoder CLI — `qodercli` (international) or `qoderclicn`
 * (China, 中国版) — to an OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one headless `qodercli -p --output-format stream-json` run per user
 *     message; killing the process group stops the task
 *   - workspace tools over MCP, the same stdio server the Claude adapter wires
 *     up, pointed at with `--mcp-config`
 *   - session continuity per channel: the CLI's `session_id` comes back on the
 *     init frame and is replayed with `--resume` on the channel's next turn
 *
 * Qoder CLI speaks the Claude Code stream-json contract, which is why this
 * adapter mirrors the Claude/CodeBuddy shape. Three Qoder-specific decisions
 * are worth knowing before editing this file:
 *
 *   THE EXIT CODE IS NOT THE VERDICT. A failed model call is reported inside
 *   the result frame (`is_error: true`), so verdicts come from
 *   classifyQoderRun(), which reads that frame first.
 *
 *   THE PROMPT IS PIPED, NOT PASSED. `-p/--print` is a boolean (unlike Claude
 *   Code's value-taking `-p`), so the turn goes in over stdin — a long briefing
 *   plus recap can never hit the argv limit and a quote in a user message is
 *   not a command-line injection. There is also no `--verbose`: stream-json
 *   streams without it, and passing one is a hard "unknown option" error.
 *
 *   TWO BUILDS, TWO ACCOUNTS. The China and international editions are
 *   different binaries with different config roots (`~/.qoder-cn` and
 *   `~/.qoder`) and independent sign-ins. `QODER_REGION` pins one; without it
 *   the signed-in build is preferred, then the international one.
 *
 * Verified end to end against qodercli/qoderclicn 1.1.52.
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
  buildQoderArgs,
  classifyQoderRun,
  classifyQoderVersion,
  compareVersions,
  interpretQoderFrame,
  parseFrame,
  redactArgs,
  redactSecrets,
  rankQoderRegions,
  qoderBinaryNames,
  truncate,
  REGIONS,
  QODER_MIN_VERSION,
} = require('./qoder-stream');

const IS_WINDOWS = process.platform === 'win32';

// Max wall-clock for a single headless run, after which the process group is
// killed and the turn reported as interrupted.

// Idle watchdog: with no stdout frame for this long we nudge the channel, and
// after MAX consecutive silences we kill a run that is probably wedged.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2;  // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;      // ~5 min of silence → kill

// The CLI's own floor (its launcher refuses to start below this), so an
// interpreter under it cannot run the agent at all.
const MIN_NODE_MAJOR = 18;

// Cache window for the version / executability probe, so preflight never
// spawns `--version` more than once per window across channels.
const VERSION_PROBE_TTL_MS = 60000;

// Where the CLI installs itself. Both editions use a native installer, so the
// versioned binary lives a level down under the product's own directory rather
// than in an npm prefix.
const INSTALL_HINT =
  'curl -fsSL https://qoder.com/install.sh | bash  (China: https://qoder.com.cn/install.sh)';

class QoderAdapter extends BaseAdapter {
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
      `${this.workspaceId}_${this.agentName}_qoder.json`,
    );
    this._versionProbe = null; // { at, bin, version, supported }
    this._loadSessions();
  }

  // ------------------------------------------------------------------
  // Session persistence (Qoder session ids, bound to working dir)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Qoder session(s)`);
        }
      }
    } catch {
      this._log('Could not load Qoder sessions file, starting fresh');
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
   * Qoder stores a session's transcript against the directory it ran in, so
   * a saved id from a different directory would not resolve — resume only when
   * the directory still matches.
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
    this._log(`Stopping ${entries.length} running Qoder process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * Stop a run gracefully, then forcefully.
   *
   * SIGINT first, which the CLI handles by finishing the turn it is on rather
   * than tearing down mid-write. Escalation targets the whole POSIX process
   * group (the CLI spawns shell tools of its own) or `taskkill /T` on Windows.
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { proc.kill('SIGINT'); } catch {}
        const exited = await this._waitExit(proc, 1500);
        if (!exited) {
          try { execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { timeout: 5000, windowsHide: true }); } catch {}
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
  // Binary resolution (cross-platform)
  // ------------------------------------------------------------------

  /**
   * Node interpreter used to execute the CLI's JS entry point.
   *
   * Prefer the launcher's managed runtime, and fall back to the interpreter
   * running this daemon when it clears the CLI's own Node floor. Returning null
   * means "no suitable Node" and the caller spawns the shim directly instead of
   * guessing.
   */
  _findNodeBin() {
    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'),
         path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    for (const c of candidates) {
      if (fs.existsSync(c) && this._nodeMajor(c) >= MIN_NODE_MAJOR) return c;
    }
    const ownMajor = parseInt(String(process.versions.node).split('.')[0], 10) || 0;
    return ownMajor >= MIN_NODE_MAJOR ? process.execPath : null;
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
   * The Qoder editions to probe, most preferred first.
   *
   * An explicit `QODER_REGION` wins; otherwise the edition the user is actually
   * signed in to is preferred (its `<home>/.auth/user` file exists), so a
   * machine with only one account needs no configuration.
   */
  _qoderRegionOrder() {
    const home = os.homedir();
    const signedIn = {};
    for (const [region, spec] of Object.entries(REGIONS)) {
      try { signedIn[region] = fs.existsSync(path.join(home, spec.home, '.auth', 'user')); }
      catch { signedIn[region] = false; }
    }
    return rankQoderRegions(this.agentEnv.QODER_REGION, signedIn);
  }

  /** The binary names to search, in region preference order. */
  _qoderBinNames() {
    return this._qoderRegionOrder().flatMap((region) => qoderBinaryNames(region));
  }

  /**
   * The newest `<name>-<version>` executable in `dir`, or null.
   *
   * The native installer keeps every downloaded version side by side and
   * updates a `version.txt` pointer, but the filename itself carries the
   * version — taking the highest one beats trusting directory order.
   */
  _newestVersionedBinary(dir, name) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return null; }
    let best = null;
    let bestVersion = null;
    for (const entry of entries) {
      const m = entry.match(new RegExp(`^${name}-(\\d+\\.\\d+\\.\\d+.*)$`));
      if (!m) continue;
      if (bestVersion === null || compareVersions(m[1], bestVersion) > 0) {
        bestVersion = m[1];
        best = path.join(dir, entry);
      }
    }
    return best;
  }

  /**
   * Locate the Qoder CLI for the preferred edition.
   *
   * Both editions install natively (no npm prefix), dropping a versioned binary
   * under the edition's own `bin/<name>/<name>-<version>` (for example `~/.qoder-cn/bin/qoderclicn/qoderclicn-1.1.52`), with a shim on PATH. A
   * launcher-managed runtime is still checked first so a managed copy wins.
   */
  _findQoderBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';
    const regions = this._qoderRegionOrder();
    const names = this._qoderBinNames();

    // Tier 0: shim inside an OpenAgents-managed prefix.
    const prefixes = [
      path.join(home, '.openagents', 'runtimes', 'qoder', 'node_modules'),
      path.join(home, '.openagents', 'nodejs', 'node_modules'),
    ];
    for (const root of prefixes) {
      for (const name of names) {
        const c = path.join(root, '.bin', `${name}${ext}`);
        if (fs.existsSync(c)) return c;
      }
    }

    // Tier 1: PATH, via the codepage-safe lookup (a non-ASCII username would
    // otherwise be mangled into an ENOENT) using the enriched PATH.
    for (const name of names) {
      const viaWhere = whereBinary(name);
      if (viaWhere) return viaWhere;
    }

    // Tier 2: the native installer's own layout — one directory per edition,
    // keyed by its primary binary, holding every version it has downloaded
    // (for example `~/.qoder-cn/bin/qoderclicn/qoderclicn-1.1.52`).
    for (const region of regions) {
      const spec = REGIONS[region];
      const dir = path.join(home, spec.home, 'bin', spec.binary);
      const best = this._newestVersionedBinary(dir, spec.binary);
      if (best) return best;
    }

    // Tier 3: common shim locations.
    for (const name of names) {
      const candidates = IS_WINDOWS ? [
        path.join(process.env.LOCALAPPDATA || '', 'Qoder', 'bin', `${name}.exe`),
        path.join(process.env.APPDATA || '', 'npm', `${name}.cmd`),
      ] : [
        path.join(home, '.local', 'bin', name),
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }

    // Tier 4: deep scan of every known bin dir (nvm/fnm/volta/homebrew/…).
    for (const name of names) {
      const viaWhich = whichBinary(name);
      if (viaWhich) return viaWhich;
    }

    return null;
  }

  /**
   * Resolve a shim to [nodeBin, jsEntry] so the JS entry point runs directly.
   * Returns null when no suitable Node exists or the target isn't a JS entry,
   * leaving the caller to spawn the shim as-is.
   */
  _resolveToNodeCmd(binPath) {
    const nodeBin = this._findNodeBin();
    if (!nodeBin) return null;

    if (binPath.endsWith('.mjs') || binPath.endsWith('.js')) return [nodeBin, binPath];

    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) {
      try {
        const cmdDir = path.dirname(path.resolve(binPath));
        const content = fs.readFileSync(binPath, 'utf-8');
        const jsMatch = content.match(/%dp0%\\([^\s"*?]+(?:\.m?js)?)/i);
        if (jsMatch) {
          const target = path.resolve(cmdDir, jsMatch[1]);
          if (fs.existsSync(target) && !target.toLowerCase().endsWith('.exe')) return [nodeBin, target];
        }
      } catch {}
      return null;
    }

    try {
      let target = binPath;
      if (fs.lstatSync(binPath).isSymbolicLink()) {
        target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
      }
      if (target.endsWith('.mjs') || target.endsWith('.js')) return [nodeBin, target];
      if (this._isNodeShebangScript(target)) return [nodeBin, target];
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

  /** Resolve [cmd, ...args] for spawning, handling node-script wrappers. */
  _spawnableCmd(binPath, args) {
    const resolved = this._resolveToNodeCmd(binPath);
    if (resolved) return [...resolved, ...args];
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) return ['cmd.exe', '/c', binPath, ...args];
    return [binPath, ...args];
  }

  // ------------------------------------------------------------------
  // Version preflight (cached; HARD minimum 1.0.0)
  // ------------------------------------------------------------------

  /** Run `--version` and return raw output. Isolated for testing. */
  _readVersionRaw(bin) {
    try {
      const [cmd, ...args] = this._spawnableCmd(bin, ['--version']);
      return execFileSync(cmd, args, {
        encoding: 'utf-8',
        timeout: 15000,
        windowsHide: true,
        env: getEnhancedEnv(this.agentEnv),
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
    const verdict = classifyQoderVersion(this._readVersionRaw(bin));
    this._versionProbe = { ...verdict, bin, at: now };
    return this._versionProbe;
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
   * ~/.qoder config. The caller deletes it when the run ends.
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
            type: 'stdio',
            command: resolved.command,
            args: resolved.args,
            env: { OA_WORKSPACE_TOKEN: this.token },
          },
        },
      };

      const dir = path.join(os.homedir(), '.openagents', 'mcp-configs');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `qoder-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
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
      const node = this._findNodeBin();
      if (node) return { command: node, args: [siblingBin, ...mcpArgs] };
    }

    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';
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
   * @returns {Promise<object>} { code, signal, result, sessionId, anyOutput, lastAssistantText, userStopped, stderr }
   */
  _runQoder(channel, bin, args, workingDir, prompt) {
    // Stopped while this turn was being prepared: start nothing (no tokens).
    if (this._stoppedBeforeStart(channel)) return Promise.resolve({ userStopped: true });
    return new Promise((resolve) => {
      const [cmd, ...spawnArgs] = this._spawnableCmd(bin, args);
      this._log(`Spawning: ${path.basename(cmd)} ${redactArgs(spawnArgs).join(' ')} (cwd=${workingDir})`);

      let proc;
      try {
        proc = spawn(cmd, spawnArgs, {
          cwd: workingDir,
          env: getEnhancedEnv(this.agentEnv),
          stdio: ['pipe', 'pipe', 'pipe'],
          // Own process group so the CLI's own shell tools die with it.
          detached: !IS_WINDOWS,
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
      // The most recent assistant text, kept as a fallback answer. The CLI
      // builds the result frame's `result` from its last completed assistant
      // message, so an empty one on an otherwise clean run means the answer was
      // streamed but never summarized — posting "no response" over text the
      // user already watched arrive is the worse failure.
      let lastAssistantText = '';
      let lastFrameAt = Date.now();
      let silences = 0;
      let lastToolLabel = null;
      let killedByWatchdog = false;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
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
          // The id arrives here, BEFORE any model call — which is what keeps a
          // channel resumable even when the turn itself fails.
          if (ev.sessionId) sessionId = ev.sessionId;
          return;
        }
        if (ev.kind === 'assistant') {
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
        // Bounded: stderr carries progress under --verbose and must not grow
        // without limit on a long run.
        stderrBuf = truncate(stderrBuf + chunk.toString('utf-8'), 8000);
      });

      proc.on('error', (e) => {
        finish({ code: null, signal: null, result, sessionId, anyOutput, lastAssistantText, userStopped: false, spawnError: e && e.message });
      });

      proc.on('close', (code, signal) => {
        // Flush a trailing line with no newline (the result frame, if the CLI
        // exits without one).
        if (stdoutBuf.trim()) { try { onFrame(stdoutBuf); } catch {} }
        const userStopped = this._stoppingChannels.has(channel);
        this._stoppingChannels.delete(channel);
        finish({
          code,
          signal: killedByWatchdog ? 'SIGKILL' : signal,
          result,
          sessionId,
          anyOutput,
          lastAssistantText,
          userStopped,
          stderr: redactSecrets(stderrBuf),
        });
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

    const bin = this._findQoderBinary();
    if (!bin) {
      await this.sendError(channel, `Qoder CLI not found. Install it with: ${INSTALL_HINT}`);
      return;
    }

    // HARD minimum gate. A confirmed-older CLI has no stream-json contract to
    // parse; an undetermined version (supported === null) proceeds leniently.
    const ver = this._checkVersion(bin);
    if (ver.supported === false) {
      this._log(`Refusing to start: Qoder ${ver.version} < minimum ${QODER_MIN_VERSION}`);
      await this.sendError(channel,
        `Qoder CLI ${ver.version} is below the minimum supported version ${QODER_MIN_VERSION} ` +
        `(the line that ships headless stream-json output). Upgrade with: ${INSTALL_HINT}`);
      return;
    }
    if (ver.supported === null) {
      this._log('Could not determine the Qoder version — proceeding leniently');
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

    // The Claude builder is reused verbatim: Qoder takes the same
    // --append-system-prompt hook and reaches the workspace through the same
    // stdio MCP server, so the briefing it needs is character-for-character the
    // one that adapter already writes. A Qoder-shaped copy would be a fork
    // to keep in sync for no behavioral difference.
    const systemPrompt = buildClaudeSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: channel,
      mode: this._mode,
      model: this.modelLabel(),
      browserEnabled: await this.getBrowserEnabled(),
      toolMode: 'mcp',
    });

    const model = (this.workspaceModel || this.agentEnv.QODER_MODEL || '').trim();
    const effort = (this.agentEnv.QODER_REASONING_EFFORT || '').trim();
    const maxTurns = parseInt(this.agentEnv.QODER_MAX_TURNS || '', 10);

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
      const args = buildQoderArgs({
        appendSystemPrompt: systemPrompt,
        model,
        effort,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
        resumeSessionId: resumeId || undefined,
        mcpConfigPath: mcpConfigPath || undefined,
        planMode: this._mode === 'plan',
      });

      let run;
      try {
        run = await this._runQoder(channel, bin, args, workingDir, prompt);
      } finally {
        if (mcpConfigPath) { try { fs.unlinkSync(mcpConfigPath); } catch {} }
      }

      if (run.userStopped) return;

      if (run.spawnError) {
        await this.sendError(channel,
          `Qoder CLI could not be started (${redactSecrets(run.spawnError)}). Reinstall it with: ${INSTALL_HINT}`);
        return;
      }

      const verdict = classifyQoderRun(run);

      // A resume that produced nothing usable is the stale-session case: drop
      // the binding and retry once from scratch.
      if (resumeId && !verdict.ok && !run.anyOutput && attempt === 0) {
        this._log(`Resume of session ${resumeId} produced nothing — clearing and retrying fresh`);
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

      try { await this.sendError(channel, verdict.userMessage); } catch {}
      return;
    }
  }
}

module.exports = QoderAdapter;
