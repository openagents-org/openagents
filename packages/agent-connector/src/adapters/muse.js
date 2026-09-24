/**
 * Muse Code adapter for OpenAgents workspace.
 *
 * Bridges Meta's Muse Code CLI (`curl -fsSL https://dev.meta.ai/install.sh | sh`)
 * to an OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - one headless `muse exec --json` run per user message; killing the
 *     process group stops the task
 *   - workspace tools over MCP, the same stdio server the Claude adapter wires
 *     up, registered in Muse's own settings file
 *   - session continuity per channel: the adapter mints the session UUID and
 *     replays it with `--session-id`, which Muse resumes when it already exists
 *
 * Three decisions worth knowing before editing this file:
 *
 *   THE SANDBOX STAYS ON. Runs pass `--approval-mode never` so a headless turn
 *   never blocks on an approval nobody can give, and nothing else: no
 *   `--disable-sandbox`, no `--yolo`. On Linux the sandbox is a bubblewrap
 *   helper bundled with the CLI; it refuses to run from a world-writable
 *   directory such as /tmp, which is an install-location problem, not a reason
 *   to turn it off.
 *
 *   THE MCP ENTRY LIVES IN THE USER'S SETTINGS FILE, WITHOUT SECRETS. Muse reads
 *   MCP servers from `$XDG_CONFIG_HOME/muse/settings.json` (default
 *   ~/.config/muse). A private config dir would also hide the user's `muse
 *   login` credentials, which live beside it. So the adapter keeps one static
 *   `openagents-workspace` entry there whose values are all `${VAR}`
 *   references, and supplies the token, workspace and channel through the
 *   run's environment. Nothing token-bearing is written to disk or to the
 *   user's project.
 *
 *   THE PROMPT GOES IN A FILE. `--prompt-file` keeps a long briefing + recap
 *   off the command line; the file is 0600 in an OpenAgents-owned directory
 *   and deleted after the run. Muse has no system-prompt flag, so the
 *   workspace briefing opens the first turn of each session.
 *
 * Verified against Muse Code 1.3.0 with the offline `--provider echo` mode;
 * tool-call records and live MCP use still need a run with a real key.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
// spawn() here is the WSL bridge from ../wsl: same signature as
// child_process.spawn, and a straight pass-through off Windows.
const { spawn } = require('../wsl');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, redactSecrets } = require('./utils');
const { buildClaudeSystemPrompt } = require('./workspace-prompt');
const { defaultAgentWorkdir, whichBinary, whereBinary, getEnhancedEnv } = require('../paths');
const {
  buildMuseArgs,
  buildMuseMcpEntry,
  classifyMuseRun,
  classifyMuseVersion,
  interpretMuseRecord,
  mergeMuseSettings,
  museSettingsProblem,
  parseRecord,
  redactArgs,
  truncate,
  MUSE_MIN_VERSION,
} = require('./muse-stream');

const IS_WINDOWS = process.platform === 'win32';

// Idle watchdog: with no stdout record for this long we nudge the channel, and
// after MAX consecutive silences we kill a run that is probably wedged.
const WATCHDOG_INTERVAL_MS = 15000;
const WATCHDOG_NUDGE_AT = 2;  // ~30s of silence → "still working"
const WATCHDOG_MAX = 20;      // ~5 min of silence → kill

// Cache window for the version probe, so preflight never spawns `--version`
// more than once per window across channels.
const VERSION_PROBE_TTL_MS = 60000;

const INSTALL_HINT = 'curl -fsSL https://dev.meta.ai/install.sh | sh';

class MuseAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    // channel → { sessionId, workingDir, started }
    this._channelSessions = {};
    // channel → child process (the in-flight headless run)
    this._channelProcesses = {};
    this._stoppingChannels = new Set();
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_muse.json`,
    );
    this._versionProbe = null; // { at, bin, version, supported }
    this._loadSessions();
  }

  // ------------------------------------------------------------------
  // Session persistence (adapter-minted UUIDs, bound to working dir)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Muse session(s)`);
        }
      }
    } catch {
      this._log('Could not load Muse sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * The channel's session, minting one when there is none or when the saved
   * one belongs to another directory (Muse keys sessions by workspace root).
   */
  _sessionFor(channel, workingDir) {
    const entry = this._channelSessions[channel];
    if (entry && entry.sessionId && (!entry.workingDir || entry.workingDir === workingDir)) return entry;
    const fresh = { sessionId: crypto.randomUUID(), workingDir, started: false };
    this._channelSessions[channel] = fresh;
    this._saveSessions();
    return fresh;
  }

  _markStarted(channel) {
    const entry = this._channelSessions[channel];
    if (entry && !entry.started) {
      entry.started = true;
      this._saveSessions();
    }
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
    this._log(`Stopping ${entries.length} running Muse process(es)...`);
    for (const [channel, proc] of entries) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * Stop a run gracefully, then forcefully. Escalation targets the whole POSIX
   * process group (the CLI spawns shell tools of its own) or `taskkill /T` on
   * Windows.
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
  // Binary resolution
  // ------------------------------------------------------------------

  /**
   * Locate the Muse CLI. The official installer puts a launcher script in
   * ~/.local/bin (or $MUSE_INSTALL_DIR); it self-updates and execs the real
   * binary next to it, so the launcher is what gets spawned.
   */
  _findMuseBinary() {
    const home = os.homedir();
    const installDir = (this.agentEnv && this.agentEnv.MUSE_INSTALL_DIR) || process.env.MUSE_INSTALL_DIR;
    const candidates = [];
    if (installDir) candidates.push(path.join(installDir, IS_WINDOWS ? 'muse.cmd' : 'muse'));
    if (IS_WINDOWS && process.env.LOCALAPPDATA) {
      candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'muse', 'muse.cmd'));
    }
    if (!IS_WINDOWS) candidates.push(path.join(home, '.local', 'bin', 'muse'));
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return whereBinary('muse') || whichBinary('muse') || null;
  }

  /**
   * [cmd, ...args] for spawning. The Windows installer's entry point is a
   * `.cmd` shim, which only cmd.exe can run; argv never carries user text (the
   * prompt is a file), so there is nothing for cmd.exe to misquote.
   */
  _spawnableCmd(bin, args) {
    if (IS_WINDOWS && bin.toLowerCase().endsWith('.cmd')) return ['cmd.exe', '/d', '/s', '/c', bin, ...args];
    return [bin, ...args];
  }

  /** Run `--version` and return raw output. Isolated for testing. */
  _readVersionRaw(bin) {
    try {
      const [cmd, ...args] = this._spawnableCmd(bin, ['--version']);
      return execFileSync(cmd, args, {
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
        env: getEnhancedEnv(this.agentEnv),
      });
    } catch (e) {
      return (e && (e.stdout || e.stderr)) ? String(e.stdout || e.stderr) : '';
    }
  }

  /** Cached version verdict for a resolved binary. */
  _checkVersion(bin) {
    const now = Date.now();
    if (this._versionProbe && this._versionProbe.bin === bin && now - this._versionProbe.at < VERSION_PROBE_TTL_MS) {
      return this._versionProbe;
    }
    const verdict = classifyMuseVersion(this._readVersionRaw(bin));
    this._versionProbe = { ...verdict, bin, at: now };
    return this._versionProbe;
  }

  // ------------------------------------------------------------------
  // Workspace MCP server
  // ------------------------------------------------------------------

  /**
   * Muse's settings file, resolved the way the CLI resolves it for this run:
   * from the env the run is spawned with (agentEnv already carries the
   * daemon's environment), empty meaning unset, and a relative value taken
   * against the run's working directory (verified on 1.3.0).
   */
  _museSettingsPath(workingDir) {
    const xdg = (this.agentEnv || process.env).XDG_CONFIG_HOME;
    const base = xdg ? path.resolve(workingDir || process.cwd(), xdg) : path.join(os.homedir(), '.config');
    return path.join(base, 'muse', 'settings.json');
  }

  /**
   * Make sure Muse's settings carry our MCP entry.
   *
   * Returns `{ tools: boolean, error: string|null }`. `error` means the run must
   * not start: Muse validates the same file at startup and refuses a broken
   * one, so launching anyway would only fail later with a vaguer message. The
   * file is never rewritten in that case — it is the user's configuration.
   */
  _ensureMcpSettings(workingDir) {
    const file = this._museSettingsPath(workingDir);
    let existing = null;
    if (fs.existsSync(file)) {
      let raw;
      try {
        raw = fs.readFileSync(file, 'utf-8');
      } catch (e) {
        return { tools: false, error: `Muse settings at ${file} could not be read (${redactSecrets(e && e.message)}).` };
      }
      try {
        existing = JSON.parse(raw);
      } catch {
        return { tools: false, error: `Muse settings at ${file} are not valid JSON. Fix or remove the file, then retry — Muse refuses to start with it as-is.` };
      }
      const bad = museSettingsProblem(existing);
      if (bad) {
        const why = bad.museRejects
          ? 'Muse refuses to start with it as-is'
          : 'the workspace tools cannot be added without overwriting it';
        return { tools: false, error: `Muse settings at ${file} are malformed: ${bad.problem}. Fix the file, then retry — ${why}.` };
      }
    }

    const server = this._resolveMcpServerCmd();
    if (!server) {
      this._log('Could not find the openagents binary — workspace MCP tools are unavailable this run');
      return { tools: false, error: null };
    }
    const merged = mergeMuseSettings(existing, buildMuseMcpEntry(server));
    if (!merged) return { tools: true, error: null };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
      this._log(`Registered the workspace MCP server in ${file}`);
      return { tools: true, error: null };
    } catch (e) {
      // The file on disk is still the valid one we read, so Muse can start —
      // just without the entry this run.
      this._log(`Could not update Muse settings: ${redactSecrets(e && e.message)}`);
      return { tools: false, error: null };
    }
  }

  /** Node binary to host this package's CLI, preferring the managed runtime. */
  _findNodeBin() {
    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'), path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    return candidates.find((c) => fs.existsSync(c)) || process.execPath;
  }

  /** `{command, args}` that starts this package's `mcp-server`, or null. */
  _resolveMcpServerCmd() {
    const siblingBin = path.resolve(__dirname, '..', '..', 'bin', 'agent-connector.js');
    if (fs.existsSync(siblingBin)) return { command: this._findNodeBin(), args: [siblingBin, 'mcp-server'] };
    const bin = whereBinary('openagents');
    return bin ? { command: bin, args: ['mcp-server'] } : null;
  }

  /** Environment for one run: the agent's env plus what the MCP entry interpolates. */
  _runEnv(channel) {
    return {
      ...getEnhancedEnv(this.agentEnv),
      OA_WORKSPACE_TOKEN: this.token,
      OPENAGENTS_WORKSPACE_ID: this.workspaceId,
      OPENAGENTS_CHANNEL_NAME: channel,
      OPENAGENTS_AGENT_NAME: this.agentName,
      OPENAGENTS_ENDPOINT: this.endpoint,
      OPENAGENTS_DISABLED_MODULES: [...this.disabledModules].join(','),
    };
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  /** Short transcript of recent channel chat, used to seed a fresh session. */
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

  /** Write the prompt to a private file and return its path. */
  _writePromptFile(prompt) {
    const dir = path.join(os.homedir(), '.openagents', 'muse-prompts');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `prompt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.md`);
    fs.writeFileSync(file, prompt, { mode: 0o600 });
    return file;
  }

  _dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  // ------------------------------------------------------------------
  // Run
  // ------------------------------------------------------------------

  /**
   * Run one headless turn and consume its JSONL output. The reply comes off
   * the single `run.terminal.*` record; deltas only feed the ticker.
   *
   * @returns {Promise<object>} { code, signal, terminal, anyOutput, userStopped, stderr }
   */
  _runMuse(channel, bin, args, workingDir, env) {
    if (this._stoppedBeforeStart(channel)) return Promise.resolve({ userStopped: true });
    return new Promise((resolve) => {
      this._log(`Spawning: ${path.basename(bin)} ${redactArgs(args).join(' ')} (cwd=${workingDir})`);

      let proc;
      try {
        const [cmd, ...spawnArgs] = this._spawnableCmd(bin, args);
        proc = spawn(cmd, spawnArgs, {
          cwd: workingDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          // Own process group so the CLI's own shell tools die with it.
          detached: !IS_WINDOWS,
          windowsHide: true,
        });
      } catch (e) {
        resolve({ code: null, signal: null, terminal: null, anyOutput: false, userStopped: false, spawnError: e && e.message });
        return;
      }

      this._channelProcesses[channel] = proc;

      let settled = false;
      let stdoutBuf = '';
      let stderrBuf = '';
      let anyOutput = false;
      let terminal = null;
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

      const onLine = (line) => {
        const record = parseRecord(line);
        if (!record) return;
        lastFrameAt = Date.now();
        silences = 0;
        anyOutput = true;

        const ev = interpretMuseRecord(record);
        if (ev.kind === 'terminal') { terminal = ev; return; }
        if (ev.kind === 'tool') {
          // Only announce a CHANGE of activity, not every call.
          if (ev.label !== lastToolLabel) {
            lastToolLabel = ev.label;
            void this.sendStatus(channel, ev.label).catch(() => {});
          }
          return;
        }
        if (ev.kind === 'task_failed') {
          // Not a run failure — see muse-stream.js. Logged for diagnosis only.
          if (ev.reason) this._log(`Muse task failed (run continues): ${ev.reason}`);
          return;
        }
        if (ev.kind === 'unknown') this._log(`Unrecognized record (ignored): ${ev.raw}`);
      };

      proc.stdout.on('data', (chunk) => {
        stdoutBuf += chunk.toString('utf-8');
        let nl;
        while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
          const line = stdoutBuf.slice(0, nl);
          stdoutBuf = stdoutBuf.slice(nl + 1);
          try { onLine(line); } catch (e) { this._log(`Record handling failed: ${redactSecrets(e && e.message)}`); }
        }
      });

      proc.stderr.on('data', (chunk) => {
        // Bounded: keep the tail, which is where the fatal line is.
        stderrBuf = (stderrBuf + chunk.toString('utf-8')).slice(-8000);
      });

      proc.on('error', (e) => {
        finish({ code: null, signal: null, terminal, anyOutput, userStopped: false, spawnError: e && e.message });
      });

      proc.on('close', (code, signal) => {
        if (stdoutBuf.trim()) { try { onLine(stdoutBuf); } catch {} }
        const userStopped = this._stoppingChannels.has(channel);
        this._stoppingChannels.delete(channel);
        finish({
          code,
          signal: killedByWatchdog ? 'SIGKILL' : signal,
          terminal,
          anyOutput,
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

    // Never silently fall back to the launcher/repo dir — a wrong cwd is a
    // destructive surprise, not a default.
    const workingDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    if (this.workingDir && !this._dirExists(this.workingDir)) {
      await this.sendError(channel, `Working directory does not exist: ${this.workingDir}`);
      return;
    }
    try { fs.mkdirSync(workingDir, { recursive: true }); } catch {}

    const bin = this._findMuseBinary();
    if (!bin) {
      await this.sendError(channel, `Muse Code CLI not found. Install it with: ${INSTALL_HINT}`);
      return;
    }

    const ver = this._checkVersion(bin);
    if (ver.supported === false) {
      this._log(`Refusing to start: Muse Code ${ver.version} < minimum ${MUSE_MIN_VERSION}`);
      await this.sendError(channel,
        `Muse Code ${ver.version} is below the minimum supported version ${MUSE_MIN_VERSION}. ` +
        `Upgrade with: ${INSTALL_HINT}`);
      return;
    }
    if (ver.supported === null) this._log('Could not determine the Muse Code version — proceeding leniently');

    await this._autoTitleChannel(channel, content);
    await this.sendStatus(channel, 'thinking...');

    const settings = this._ensureMcpSettings(workingDir);
    if (settings.error) {
      await this.sendError(channel, settings.error);
      return;
    }
    const toolsAvailable = settings.tools;
    const model = (this.workspaceModel || this.agentEnv.MUSE_MODEL || '').trim();
    const effort = (this.agentEnv.MUSE_REASONING_EFFORT || '').trim();
    const maxSteps = parseInt(this.agentEnv.MUSE_MAX_MODEL_STEPS || '', 10);

    // One retry: a saved session Muse no longer has fails the resume, and the
    // turn is worth re-running fresh.
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = this._sessionFor(channel, workingDir);
      const resuming = session.started;

      // Resuming → Muse already holds the briefing and history, so send the
      // bare turn. Fresh → briefing, then a recap of the channel.
      let prompt = content;
      if (!resuming) {
        const briefing = buildClaudeSystemPrompt({
          agentName: this.agentName,
          workspaceId: this.workspaceId,
          channelName: channel,
          mode: this._mode,
          model: this.modelLabel(),
          browserEnabled: await this.getBrowserEnabled(),
          toolMode: 'mcp',
        });
        const recap = await this._buildChannelRecap(channel, content);
        const parts = [briefing];
        if (!toolsAvailable) parts.push('(Workspace MCP tools are unavailable in this run.)');
        if (recap) parts.push(recap);
        parts.push(`---\n\n${content}`);
        prompt = parts.join('\n\n');
      }

      let promptFile;
      try {
        promptFile = this._writePromptFile(prompt);
      } catch (e) {
        await this.sendError(channel, `Could not prepare the prompt: ${redactSecrets(e && e.message)}`);
        return;
      }

      const args = buildMuseArgs({
        promptFile,
        sessionId: session.sessionId,
        model,
        effort,
        maxSteps: Number.isFinite(maxSteps) ? maxSteps : undefined,
        planMode: this._mode === 'plan',
      });

      let run;
      try {
        run = await this._runMuse(channel, bin, args, workingDir, this._runEnv(channel));
      } finally {
        try { fs.unlinkSync(promptFile); } catch {}
      }

      if (run.userStopped) return;

      if (run.spawnError) {
        await this.sendError(channel,
          `Muse Code could not be started (${redactSecrets(run.spawnError)}). Reinstall it with: ${INSTALL_HINT}`);
        return;
      }

      const verdict = classifyMuseRun(run);

      if (resuming && !run.terminal && !run.anyOutput && attempt === 0 && verdict.kind !== 'auth_required') {
        this._log(`Resume of session ${session.sessionId} produced nothing — clearing and retrying fresh`);
        this._clearSession(channel);
        continue;
      }

      // Any record means Muse created the session on disk.
      if (run.anyOutput) this._markStarted(channel);

      const text = run.terminal && run.terminal.text ? run.terminal.text.trim() : '';

      if (verdict.ok) {
        try { await this.sendResponse(channel, text || 'No response generated. Please try again.'); } catch {}
        return;
      }

      // A failed run that still produced text delivers the text with the
      // reason appended rather than replacing an answer the user can use.
      if (text) {
        try { await this.sendResponse(channel, `${text}\n\n_${verdict.userMessage}_`); } catch {}
        return;
      }

      if (verdict.kind === 'cli_error' && run.stderr) this._log(`Muse stderr: ${truncate(run.stderr, 2000)}`);
      try { await this.sendError(channel, verdict.userMessage); } catch {}
      return;
    }
  }
}

module.exports = MuseAdapter;
