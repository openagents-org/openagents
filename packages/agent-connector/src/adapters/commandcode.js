/**
 * Command Code adapter for OpenAgents workspace.
 *
 * Bridges the Command Code CLI (https://commandcode.ai, `npm i -g command-code`)
 * to an OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one headless `command-code -p --output-format json` subprocess per user
 *     message; killing the process group stops the task
 *   - the NDJSON stream is parsed by commandcode-stream.js and mapped to the
 *     standard OpenAgents events (thinking / status / response / error)
 *   - real session continuity: the run's `sessionId` comes back on the result
 *     line and is replayed with `--resume` on the channel's next turn
 *   - workspace collaboration via a generated SKILL.md loaded with `--skill`
 *
 * Three CLI-specific decisions are worth knowing before editing this file:
 *
 *   THE PROMPT IS PIPED, NOT PASSED. `-p` is given no value and the prompt goes
 *   in over stdin. A workspace turn is skill header + recap + user message,
 *   which routinely outgrows a Windows command line, and a quote inside a user
 *   message would otherwise be a command-line injection.
 *
 *   THE BINARY IS NEVER `cmd`. The npm package installs four equivalent bins —
 *   `cmd`, `cmdc`, `command-code`, `commandcode` — and `cmd` is the Windows
 *   command shell. We resolve `command-code` (and only fall back to names that
 *   can't collide with a system shell), so a Windows agent never launches
 *   cmd.exe by accident.
 *
 *   THE SKILL LIVES IN OUR OWN DIRECTORY. Command Code discovers skills from
 *   `.commandcode/skills/` in the project and `~/.commandcode/skills/` in the
 *   user's home. Writing to either would put a token-bearing file inside the
 *   user's repo (and into their commits) or into their personal config. The
 *   skill is written under ~/.openagents/ instead and loaded explicitly with
 *   `--skill`, which is documented to work alongside normal discovery.
 *
 * Minimum supported CLI is 1.0.0 (HARD gate) — the release that introduced
 * `-p --output-format json`. A confirmed-older CLI refuses to start; an
 * undetermined version proceeds leniently.
 *
 * Verified against the documented headless contract of command-code 1.36.0.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildCommandCodeSkillMd, workspaceSkillName } = require('./workspace-prompt');
const { defaultAgentWorkdir, whichBinary, whereBinary, getEnhancedEnv } = require('../paths');
const {
  buildCommandCodeArgs,
  parseFrame,
  interpretCommandCodeFrame,
  classifyCommandCodeExit,
  classifyCommandCodeVersion,
  redactArgs,
  redactSecrets,
  truncate,
  COMMANDCODE_PINNED_VERSION,
  COMMANDCODE_MIN_VERSION,
} = require('./commandcode-stream');

const IS_WINDOWS = process.platform === 'win32';

// Max wall-clock for a single headless run, after which the process group is
// killed and the turn reported as interrupted.
const TIMEOUT_MS = 600000; // 10 minutes

// Idle watchdog: with no stdout frame for this long we nudge the channel, and
// after MAX consecutive silences we kill a run that is probably wedged.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2;  // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;      // ~5 min of silence → kill

// Command Code requires Node 22+. The launcher ships v22.x at
// ~/.openagents/nodejs, but a daemon running under an older interpreter must
// not silently pick that one to execute the CLI's .mjs entry point.
const MIN_NODE_MAJOR = 22;

// Cache window for the version / executability probe, so preflight never
// spawns `--version` more than once per window across channels.
const VERSION_PROBE_TTL_MS = 60000;

// Bin names the npm package installs, best first. `cmd` is deliberately
// ABSENT: on Windows it resolves to the system command shell, and there is no
// platform where we need it — the package points all four names at the same
// entry point.
const BIN_NAMES = ['command-code', 'commandcode', 'cmdc'];

const INSTALL_HINT = `npm install -g command-code@${COMMANDCODE_PINNED_VERSION}`;

class CommandCodeAdapter extends BaseAdapter {
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
      `${this.workspaceId}_${this.agentName}_commandcode.json`,
    );
    this._versionProbe = null; // { at, bin, version, supported }
    this._loadSessions();
  }

  // ------------------------------------------------------------------
  // Session persistence (Command Code session ids, bound to working dir)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Command Code session(s)`);
        }
      }
    } catch {
      this._log('Could not load Command Code sessions file, starting fresh');
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
   * Command Code keys its session catalog by working directory, so a saved id
   * from a different directory would not resolve — resume only when the
   * directory still matches.
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
  // Control actions (stop / restart)
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && payload.channel) || null;
      if (channel) {
        const proc = this._channelProcesses[channel];
        if (proc) {
          this._stoppingChannels.add(channel);
          await this._stopProcess(proc);
          delete this._channelProcesses[channel];
          delete this._channelQueues[channel];
          try { await this.sendResponse(channel, 'Execution stopped.'); } catch {}
        }
        return;
      }
      await this._stopAllProcesses();
      return;
    }
    return super._onControlAction(action, payload);
  }

  stop() {
    super.stop();
    void this._stopAllProcesses('Agent stopped.');
  }

  async _stopAllProcesses(message = 'Execution stopped.') {
    const entries = Object.entries(this._channelProcesses);
    if (!entries.length) return;
    this._log(`Stopping ${entries.length} running Command Code process(es)...`);
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
   * SIGINT first — Command Code documents exit code 130 for an interrupted run,
   * so it handles the signal and commits the turn it was on rather than tearing
   * down mid-write. Escalation targets the whole POSIX process group (the CLI
   * spawns shell tools of its own) or `taskkill /T` on Windows.
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
   * Node interpreter used to execute the CLI's .mjs entry point.
   *
   * Command Code requires Node 22+. The launcher ships one at
   * ~/.openagents/nodejs, so prefer it; only fall back to the interpreter
   * running this daemon when it is itself new enough. Returning null means "no
   * suitable Node" and the caller spawns the shim directly instead of guessing.
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
   * Locate the Command Code CLI.
   *
   * Every tier iterates BIN_NAMES, which deliberately excludes `cmd` — see the
   * file header. The isolated runtime prefix is checked first so the version
   * the launcher installed wins over anything else on PATH.
   */
  _findCommandCodeBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';

    const prefixes = [
      path.join(home, '.openagents', 'runtimes', 'commandcode', 'node_modules'),
      path.join(home, '.openagents', 'nodejs', 'node_modules'),
    ];

    // Tier 0: npm shim inside an OpenAgents-managed prefix.
    for (const root of prefixes) {
      for (const name of BIN_NAMES) {
        const c = path.join(root, '.bin', `${name}${ext}`);
        if (fs.existsSync(c)) return c;
      }
    }

    // Tier 0b: the package's own entry point. Running it under Node skips the
    // shim entirely, which on Windows avoids cmd.exe's 8191-char command line.
    for (const root of prefixes) {
      const entry = path.join(root, 'command-code', 'dist', 'index.mjs');
      if (fs.existsSync(entry)) return entry;
    }

    // Tier 1: PATH, via the codepage-safe lookup (a non-ASCII username would
    // otherwise be mangled into an ENOENT) using the enriched PATH.
    for (const name of BIN_NAMES) {
      const viaWhere = whereBinary(name);
      if (viaWhere) return viaWhere;
    }

    // Tier 2: next to the current Node interpreter (npm global installs).
    for (const name of BIN_NAMES) {
      const nearNode = path.join(path.dirname(process.execPath), `${name}${ext}`);
      if (fs.existsSync(nearNode)) return nearNode;
    }

    // Tier 3: common install locations.
    for (const name of BIN_NAMES) {
      const candidates = IS_WINDOWS ? [
        path.join(process.env.APPDATA || '', 'npm', `${name}.cmd`),
      ] : [
        path.join(home, '.local', 'bin', name),
        path.join(home, '.npm-global', 'bin', name),
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }

    // Tier 4: deep scan of every known bin dir (nvm/fnm/volta/homebrew/…).
    for (const name of BIN_NAMES) {
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
        const jsMatch = content.match(/%dp0%\\([^\s"*?]+\.m?js)/i);
        if (jsMatch) return [nodeBin, path.resolve(cmdDir, jsMatch[1])];
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
    const verdict = classifyCommandCodeVersion(this._readVersionRaw(bin));
    this._versionProbe = { ...verdict, bin, at: now };
    return this._versionProbe;
  }

  // ------------------------------------------------------------------
  // Workspace skill
  // ------------------------------------------------------------------

  /**
   * Write the workspace SKILL.md and return the directory to pass to `--skill`.
   *
   * The file carries the workspace token, so it is written 0600 into an
   * OpenAgents-owned tree — never into the user's project (where it would be
   * committed) or `~/.commandcode/skills/` (their personal config). Returns
   * null on failure; the run still proceeds, just without workspace tools.
   */
  _writeWorkspaceSkill(channel) {
    try {
      const skillName = workspaceSkillName(this.agentName);
      const root = path.join(
        os.homedir(), '.openagents', 'commandcode-skills',
        `${this.workspaceId}_${this.agentName}`.replace(/[^A-Za-z0-9._-]/g, '_'),
      );
      const skillDir = path.join(root, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      const md = buildCommandCodeSkillMd({
        endpoint: this.endpoint,
        workspaceId: this.workspaceId,
        token: this.token,
        agentName: this.agentName,
        channelName: channel,
        disabledModules: this.disabledModules,
      });
      const file = path.join(skillDir, 'SKILL.md');
      fs.writeFileSync(file, md, { mode: 0o600 });
      try { fs.chmodSync(file, 0o600); } catch {}
      return skillDir;
    } catch (e) {
      this._log(`Could not write the workspace skill: ${redactSecrets(e && e.message)}`);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  /**
   * A compact header naming the agent, the channel and the mode. The workspace
   * API reference is NOT inlined here — it lives in the skill, which Command
   * Code activates on demand, keeping an ordinary turn cheap.
   */
  _contextHeader(channel) {
    const skillName = workspaceSkillName(this.agentName);
    const lines = [
      `[OpenAgents workspace] You are "${this.agentName}", a coding agent in workspace channel "${channel}".`,
      `Workspace collaboration (sharing files, the shared browser, other agents) is documented in the "${skillName}" skill — activate it when a request needs the workspace rather than the local project.`,
    ];
    if (this._mode === 'plan') {
      lines.push('You are in PLAN mode: investigate and propose a plan; do not modify files.');
    }
    lines.push('Work in the current working directory. Reply concisely. The user request follows:');
    return lines.join('\n');
  }

  /**
   * Short transcript of recent channel chat, used to re-seed a fresh session.
   * Only needed when there is no session to resume — Command Code already has
   * the history in that case.
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

  // ------------------------------------------------------------------
  // Run
  // ------------------------------------------------------------------

  /**
   * Run one headless turn and consume its NDJSON stream.
   *
   * The prompt goes in over stdin and the reply comes out of the single
   * `result` line — event frames only drive the live ticker, so a new upstream
   * event type costs a progress update, never the answer.
   *
   * @returns {Promise<object>} { code, signal, result, anyOutput, userStopped, stderrSessionId }
   */
  _runCommandCode(channel, bin, args, workingDir, prompt) {
    return new Promise((resolve) => {
      const [cmd, ...spawnArgs] = this._spawnableCmd(bin, args);
      this._log(`Spawning: ${path.basename(cmd)} ${redactArgs(spawnArgs).join(' ')} (cwd=${workingDir})`);

      let proc;
      try {
        proc = spawn(cmd, spawnArgs, {
          cwd: workingDir,
          env: {
            ...getEnhancedEnv(this.agentEnv),
            // A background self-update would swap the CLI under a running
            // daemon, moving the JSON contract this adapter parses.
            COMMANDCODE_SKIP_UPDATES: '1',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          // Own process group so the CLI's own shell tools die with it.
          detached: !IS_WINDOWS,
          windowsHide: true,
        });
      } catch (e) {
        resolve({ code: null, signal: null, result: null, anyOutput: false, userStopped: false, spawnError: e && e.message });
        return;
      }

      this._channelProcesses[channel] = proc;

      let settled = false;
      let stdoutBuf = '';
      let stderrBuf = '';
      let anyOutput = false;
      let result = null;
      let lastFrameAt = Date.now();
      let silences = 0;
      let lastToolLabel = null;
      let killedByWatchdog = false;

      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        clearTimeout(timeout);
        if (this._channelProcesses[channel] === proc) delete this._channelProcesses[channel];
        resolve(payload);
      };

      const onFrame = (line) => {
        const frame = parseFrame(line);
        if (!frame) return;
        lastFrameAt = Date.now();
        silences = 0;
        anyOutput = true;

        const ev = interpretCommandCodeFrame(frame);
        if (ev.kind === 'result') {
          result = ev;
          return;
        }
        if (ev.kind === 'tool') {
          // Only announce a CHANGE of activity: a run touching thirty files
          // would otherwise post thirty near-identical status lines.
          if (ev.state === 'running' && ev.label && ev.label !== lastToolLabel) {
            lastToolLabel = ev.label;
            const detail = ev.description ? `${ev.label} — ${ev.description}` : `${ev.label}...`;
            void this.sendStatus(channel, detail).catch(() => {});
          }
          return;
        }
        if (ev.kind === 'error') {
          this._log(`Run error: ${ev.message}`);
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
        finish({ code: null, signal: null, result, anyOutput, userStopped: false, spawnError: e && e.message });
      });

      proc.on('close', (code, signal) => {
        // Flush a trailing line with no newline (the result line, if the CLI
        // exits without one).
        if (stdoutBuf.trim()) { try { onFrame(stdoutBuf); } catch {} }
        const userStopped = this._stoppingChannels.has(channel);
        this._stoppingChannels.delete(channel);
        finish({
          code,
          signal: killedByWatchdog ? 'SIGKILL' : signal,
          result,
          anyOutput,
          userStopped,
          stderrSessionId: this._sessionIdFromStderr(stderrBuf),
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

      const timeout = setTimeout(() => {
        this._log(`Run exceeded ${TIMEOUT_MS}ms — killing`);
        killedByWatchdog = true;
        void this._stopProcess(proc);
      }, TIMEOUT_MS);

      // Feed the prompt. stdin is closed immediately: Command Code times out a
      // piped stdin after 30s of silence, so an unclosed pipe would stall.
      try {
        proc.stdin.on('error', () => {});
        proc.stdin.write(prompt, 'utf-8');
        proc.stdin.end();
      } catch (e) {
        this._log(`Could not write the prompt to stdin: ${redactSecrets(e && e.message)}`);
      }
    });
  }

  /**
   * Recover the session id from `--verbose` stderr.
   *
   * The result line's `sessionId` is documented as OPTIONAL — absent exactly
   * when a run fails early — so this is the fallback that keeps a channel
   * resumable after a failed turn.
   */
  _sessionIdFromStderr(stderr) {
    // Deliberately format-agnostic: match the token after `session:` rather
    // than assuming a hex UUID. Pinning the shape to today's id format would
    // silently stop recovering ids the day upstream changes it — and this is
    // the fallback that runs precisely when the result line already failed us.
    const m = String(stderr || '').match(/\bsession:\s*(\S{6,})/i);
    return m ? m[1].trim() : null;
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

    const bin = this._findCommandCodeBinary();
    if (!bin) {
      await this.sendError(channel, `Command Code CLI not found. Install it with: ${INSTALL_HINT}`);
      return;
    }

    // HARD minimum gate. A confirmed-older CLI has no JSON stream to parse; an
    // undetermined version (supported === null) proceeds leniently.
    const ver = this._checkVersion(bin);
    if (ver.supported === false) {
      this._log(`Refusing to start: Command Code ${ver.version} < minimum ${COMMANDCODE_MIN_VERSION}`);
      await this.sendError(channel,
        `Command Code CLI ${ver.version} is below the minimum supported version ${COMMANDCODE_MIN_VERSION} ` +
        `(the release that added headless JSON output). Upgrade with: ${INSTALL_HINT}`);
      return;
    }
    if (ver.supported === null) {
      this._log('Could not determine the Command Code version — proceeding leniently');
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

    const skillDir = this._writeWorkspaceSkill(channel);
    const model = (this.workspaceModel || this.agentEnv.COMMANDCODE_MODEL || '').trim();
    const effort = (this.agentEnv.COMMANDCODE_EFFORT || '').trim();
    const maxTurns = parseInt(this.agentEnv.COMMANDCODE_MAX_TURNS || '', 10);

    // One retry: a stale session id (its transcript pruned, or the directory
    // re-keyed) fails the resume, and the turn is worth re-running fresh.
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumeId = attempt === 0 ? this._resumableSession(channel, workingDir) : null;

      // Resuming → the CLI already holds the history, so send the bare turn.
      // Fresh → prepend the context header and a recap of the channel.
      let prompt;
      if (resumeId) {
        prompt = content;
      } else {
        const header = this._contextHeader(channel);
        const recap = await this._buildChannelRecap(channel, content);
        prompt = recap ? `${header}\n\n${recap}\n\n---\n\n${content}` : `${header}\n\n${content}`;
      }

      const args = buildCommandCodeArgs({
        model,
        effort,
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
        resumeSessionId: resumeId || undefined,
        planMode: this._mode === 'plan',
      });
      if (skillDir) args.push('--skill', skillDir);

      const run = await this._runCommandCode(channel, bin, args, workingDir, prompt);

      if (run.userStopped) return;

      if (run.spawnError) {
        await this.sendError(channel,
          `Command Code CLI could not be started (${redactSecrets(run.spawnError)}). Reinstall it with: ${INSTALL_HINT}`);
        return;
      }

      const verdict = classifyCommandCodeExit(run);

      // A resume that produced nothing usable is the stale-session case: drop
      // the binding and retry once from scratch.
      if (resumeId && !verdict.ok && !verdict.partial && !run.anyOutput && attempt === 0) {
        this._log(`Resume of session ${resumeId} produced nothing — clearing and retrying fresh`);
        this._clearSession(channel);
        continue;
      }

      // Persist the session id for the next turn, preferring the result line
      // and falling back to what --verbose printed to stderr.
      const sessionId = (run.result && run.result.sessionId) || run.stderrSessionId || resumeId;
      this._rememberSession(channel, sessionId, workingDir);

      const finalText = run.result && run.result.finalText ? run.result.finalText.trim() : '';

      if (finalText) {
        // A partial answer (turn limit) is still an answer — deliver it, with
        // the reason it stopped appended rather than replacing it.
        const body = verdict.partial && verdict.userMessage
          ? `${finalText}\n\n_${verdict.userMessage}_`
          : finalText;
        try { await this.sendResponse(channel, body); } catch {}
        if (!verdict.ok && !verdict.partial) {
          this._log(`Run reported ${verdict.kind} but returned text; text delivered`);
        }
        return;
      }

      if (!verdict.ok) {
        try { await this.sendError(channel, verdict.userMessage); } catch {}
        return;
      }

      try { await this.sendResponse(channel, 'No response generated. Please try again.'); } catch {}
      return;
    }
  }

}

module.exports = CommandCodeAdapter;
