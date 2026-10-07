/**
 * Hermes adapter for OpenAgents workspace.
 *
 * Bridges Nous Research's Hermes Agent CLI (https://github.com/NousResearch/hermes-agent)
 * to an OpenAgents workspace by spawning `hermes chat -q <prompt> -Q` per
 * incoming message and posting the response back to the workspace channel.
 *
 * Mirrors the Python adapter at sdk/src/openagents/adapters/hermes.py:
 * - per-channel Hermes session IDs persisted to ~/.openagents/sessions/
 * - profile auto-detection from the agent name (falls back to 'default')
 * - workspace context injection (identity + recent history + agent roster)
 * - subprocess isolation (hermes manages its own HERMES_HOME per profile)
 *
 * One workspace thread is one Hermes session, resumed with `--resume` on every
 * later message. Two rules keep that session — and the provider's prompt cache
 * behind it — worth resuming:
 * - a session is only given up when Hermes says it no longer exists. A turn
 *   that fails, runs out of iterations or is stopped still belongs to it;
 * - the workspace instructions ride alongside the conversation as a prefill
 *   message instead of being written into it again with every user message.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFile } = require('child_process');
// spawn() here is the WSL bridge from ../wsl: same signature as
// child_process.spawn, and a straight pass-through unless the resolved CLI
// lives on the other side of the Windows/WSL boundary.
const { spawn, bridgeSpawn } = require('../wsl');

const BaseAdapter = require('./base');
const { buildOpenclawSystemPrompt } = require('./workspace-prompt');
const { isRecapEligible } = require('./decision-log');
const { REASON } = require('./health-status');
const { whichBinary, whereBinary } = require('../paths');

const IS_WINDOWS = process.platform === 'win32';
const HERMES_INSTALL_HINT = IS_WINDOWS
  ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex"'
  : 'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash';
const SESSION_ID_RE = /session_id:\s*(\S+)/;
const SESSION_LINE_RE = /^session_id:\s*\S+$/;
// What Hermes prints, in place of a session_id, when `--resume` names a
// session it no longer has.
const SESSION_NOT_FOUND_RE = /session not found/i;
const MAX_HISTORY_ENTRIES = 12;
const OPENAGENTS_RULES = [
  '\n## OpenAgents-specific Rules',
  '- Your final text response is posted back to the workspace automatically.',
  '- If you need to ask the user something, ask in normal text. Do not try to open an interactive prompt.',
  '- Do not reveal secrets, tokens, raw auth headers, or internal command lines.',
  '- Keep status concise. Focus on useful output over theatre.',
];
// Hermes sends the messages in this file at the head of every model request
// without storing them in the session.
const PREFILL_ENV = 'HERMES_PREFILL_MESSAGES_FILE';
// The CLI has read that variable since June 2026 (it is in the tree by the
// 14th); the 2026.4.16 release still took the path from config.yaml only.
// `hermes --version` prints the release date as "(YYYY.M.D)".
const PREFILL_ENV_SINCE = [2026, 6, 15];
const RELEASE_DATE_RE = /\((\d{4})\.(\d{1,2})\.(\d{1,2})\)/;
const PREFILL_CLOSING = [
  '',
  '---',
  '',
  'The text above is standing context from the OpenAgents workspace, not a message to answer. The conversation follows.',
];

class HermesAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {string} [opts.hermesProfile] - explicit Hermes profile, or 'auto'
   * @param {string} [opts.hermesSource]  - `--source` label (default: 'tool')
   * @param {number} [opts.maxTurns]      - `--max-turns` value
   * @param {boolean} [opts.yolo]         - pass `--yolo` to skip prompts
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    // Pin the channel's decision log + glossary into the context prefix.
    this._usesPinnedContext = true;
    this.hermesProfile = this._resolveProfile(opts.hermesProfile, this.agentName);
    this.hermesSource = opts.hermesSource || 'tool';
    this.maxTurns = Number.isInteger(opts.maxTurns) ? opts.maxTurns : 60;
    this.yolo = !!opts.yolo;

    this._channelSessions = {};
    this._channelProcesses = {};
    // { bin, ok }: whether the resolved hermes reads PREFILL_ENV.
    this._prefillEnvSupport = null;
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_hermes.json`,
    );
    this._loadSessions();

    this._hermesBin = this._findHermesBinary();
    if (this._hermesBin) {
      this._log(`Using Hermes binary: ${this._hermesBin} (profile=${this.hermesProfile})`);
    } else {
      this._log(`Warning: hermes CLI not found. Install: ${HERMES_INSTALL_HINT}`);
    }
  }

  // ------------------------------------------------------------------
  // Binary discovery (multi-tier, matching codex/claude pattern)
  // ------------------------------------------------------------------

  _findHermesBinary() {
    const home = os.homedir();

    // Tier 1: PATH (enriched env so we see the dirs the launcher adds; a fresh
    // install updates the user PATH, which the running daemon won't pick up).
    // windowsHide stops a console window from flashing.
    // Codepage-safe lookup (whereBinary forces UTF-8 output + verifies existence
    // so a non-ASCII/Chinese username isn't mangled into an ENOENT). Native
    // Windows is supported (install.ps1); the installer adds venv\Scripts to the
    // user PATH, which a running daemon won't see — hence the enriched env
    // (whereBinary's default) + the explicit candidates in Tier 2.
    const viaWhere = whereBinary('hermes');
    if (viaWhere) return viaWhere;

    // Tier 2: Common install locations. The native Windows installer
    // (install.ps1) provisions a portable venv and drops hermes.exe under
    // %LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts (with the uv shim in
    // %LOCALAPPDATA%\hermes\bin). The Unix installer uses ~/.local/bin.
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const candidates = IS_WINDOWS ? [
      path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
      path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.cmd'),
      path.join(localAppData, 'hermes', 'bin', 'hermes.exe'),
      path.join(localAppData, 'hermes', 'bin', 'hermes.cmd'),
      path.join(home, '.hermes', 'bin', 'hermes.exe'),
      path.join(home, '.hermes', 'bin', 'hermes.cmd'),
      path.join(home, '.hermes', 'bin', 'hermes'),
      path.join(home, '.local', 'bin', 'hermes.exe'),
      path.join(home, '.local', 'bin', 'hermes.cmd'),
      path.join(home, '.local', 'bin', 'hermes'),
    ] : [
      path.join(home, '.hermes', 'bin', 'hermes'),
      path.join(home, '.local', 'bin', 'hermes'),
      '/opt/homebrew/bin/hermes',
      '/usr/local/bin/hermes',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    // Tier 3: Deep scan of every known bin dir — which ends inside WSL when
    // nothing native turned up, so a hermes the user set up in their distro is
    // found here and comes back marked for the ../wsl spawn bridge. Native
    // Windows (Tiers 1-2) is still preferred.
    const viaWhich = whichBinary('hermes');
    if (viaWhich) return viaWhich;

    return null;
  }

  /**
   * Preflight gate (run by the daemon before join). Hermes can do nothing
   * without its CLI, so when none can be resolved we surface a precise
   * 'runtime_missing' reason and skip the workspace join — instead of joining,
   * reporting "online" and then failing every message. That contradiction is
   * exactly what users hit: the workspace showed a green hermes and "all set"
   * while the smoke test on the same screen said "Not installed", because
   * `create_agent --install` treats a failed third-party install script as a
   * warning and connects the agent anyway.
   *
   * Re-resolves rather than trusting the constructor's lookup: an install that
   * landed after the daemon started must not need a restart to be seen. NOTE:
   * 'runtime_missing' (binary gone/never landed at run time), NOT
   * 'not_installed' — install detection lives in the installer.
   */
  preflight() {
    if (!this._hermesBin) this._hermesBin = this._findHermesBinary();
    if (!this._hermesBin) {
      return {
        ok: false,
        reason: REASON.RUNTIME_MISSING,
        message: `Hermes CLI not found — install with: ${HERMES_INSTALL_HINT}`,
      };
    }
    this._log(`Hermes CLI resolved: ${this._hermesBin}`);
    return { ok: true };
  }

  _resolveProfile(explicit, agentName) {
    if (explicit && explicit !== '' && explicit !== 'auto') return explicit;
    // Match agent name to an existing ~/.hermes/profiles/<name> if present
    try {
      const profileDir = path.join(os.homedir(), '.hermes', 'profiles', agentName);
      if (fs.existsSync(profileDir)) return agentName;
    } catch {}
    return 'default';
  }

  // ------------------------------------------------------------------
  // Session persistence (per-channel Hermes session IDs)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Hermes session(s)`);
        }
      }
    } catch {
      this._log('Could not load Hermes sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  _forgetSession(channelName) {
    if (!(channelName in this._channelSessions)) return;
    delete this._channelSessions[channelName];
    this._saveSessions();
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  async _getAgentsText() {
    try {
      const agents = await this.client.getAgents(this.workspaceId, this.token);
      if (!Array.isArray(agents) || agents.length === 0) return '';
      const lines = agents
        .map((a) => {
          const name = a.agentName || a.agent_name || a.name;
          if (!name) return null;
          const role = a.role || 'member';
          const status = a.status || 'unknown';
          return `- ${name} (${role}, ${status})`;
        })
        .filter(Boolean);
      return lines.length ? `## Available Workspace Agents\n${lines.join('\n')}` : '';
    } catch {
      return '';
    }
  }

  /**
   * What was said in this channel before the message being answered — for a
   * Hermes session that starts with nothing: a thread the agent joins midway,
   * or one whose earlier session can no longer be resumed. A resumed session
   * holds its own history and is never given this.
   *
   * Bounded, because the whole prompt travels as a single argv entry.
   */
  async _getRecentHistoryText(channelName, currentMessage) {
    try {
      const messages = await this.client.getRecentMessages(
        this.workspaceId, channelName, this.token, 30,
      );
      const lines = (messages || [])
        .filter((m) => isRecapEligible(m, currentMessage))
        .slice(-MAX_HISTORY_ENTRIES)
        .map((m) => {
          const sender = m.senderName || m.senderType || 'unknown';
          return `- ${sender}: ${m.content.trim().slice(0, 400)}`;
        });
      return lines.length ? `## Recent Workspace Messages\n${lines.join('\n')}` : '';
    } catch {
      return '';
    }
  }

  /**
   * The workspace's standing instructions for a channel: who the agent is
   * here, the mode, the workspace API, the pinned decisions and glossary.
   */
  _buildWorkspaceInstructions(channelName) {
    return [
      buildOpenclawSystemPrompt({
        agentName: this.agentName,
        workspaceId: this.workspaceId,
        channelName,
        endpoint: this.endpoint,
        token: this.token,
        mode: this._mode,
        model: this.modelLabel(),
        disabledModules: this.disabledModules,
        ...this.pinnedPromptOpts(channelName),
      }),
      ...OPENAGENTS_RULES,
    ].join('\n').trim();
  }

  /**
   * The prompt for one turn.
   *
   * A session that is starting out is told who else is in the workspace and
   * what was said before; a resumed one has its own history and gets the
   * user's message as it is. `instructions` is only passed when they could not
   * go out as a prefill and have to travel in the message instead.
   */
  async _buildPrompt(channelName, content, resumeId, instructions = '') {
    const parts = [];
    if (instructions) parts.push(instructions);
    if (!resumeId) {
      const [agentsText, historyText] = await Promise.all([
        this._getAgentsText(),
        this._getRecentHistoryText(channelName, content),
      ]);
      if (agentsText) parts.push('\n' + agentsText);
      if (historyText) parts.push('\n' + historyText);
    }
    const context = parts.join('\n').trim();
    if (context) return `${context}\n\n---\n\nUser message:\n${content}`;
    // The prompt is the value of `-q`; one starting with a dash would be read
    // as another flag.
    return content.startsWith('-') ? `User message:\n${content}` : content;
  }

  // ------------------------------------------------------------------
  // Workspace instructions as a Hermes prefill
  // ------------------------------------------------------------------

  /** What `hermes --version` prints; it opens with e.g. "Hermes Agent v0.21.4 (2026.9.24)". */
  _hermesVersionText() {
    const { file, args } = bridgeSpawn(this._hermesBin, ['--version']);
    return new Promise((resolve, reject) => {
      execFile(file, args, {
        env: { ...(this.agentEnv || process.env) },
        timeout: 20000,
        windowsHide: true,
      }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    });
  }

  /** True when a `hermes --version` output names a release that reads PREFILL_ENV. */
  _readsPrefillEnv(versionText) {
    const m = RELEASE_DATE_RE.exec(String(versionText || ''));
    if (!m) return false;
    const released = m.slice(1, 4).map(Number);
    const i = released.findIndex((n, k) => n !== PREFILL_ENV_SINCE[k]);
    return i === -1 || released[i] > PREFILL_ENV_SINCE[i];
  }

  /**
   * Whether this hermes takes its prefill file from the environment. One that
   * does not would simply start without the workspace instructions, so a
   * version that cannot be read counts as too old. Asked once per binary.
   */
  async _supportsPrefillEnv() {
    const known = this._prefillEnvSupport;
    if (known && known.bin === this._hermesBin) return known.ok;
    let ok = false;
    try { ok = this._readsPrefillEnv(await this._hermesVersionText()); } catch {}
    if (!ok) this._log(`This hermes does not read ${PREFILL_ENV}; sending the workspace instructions with each message`);
    this._prefillEnvSupport = { bin: this._hermesBin, ok };
    return ok;
  }

  /**
   * Write the instructions where Hermes will pick them up as a prefill: one
   * user message, placed ahead of the conversation on every model request and
   * never stored in the session.
   *
   * Prepending them to each user message, as this adapter used to, wrote a
   * fresh ~18 KB copy into the session every turn. The provider's prompt cache
   * had never seen that copy, so it was new input each time, and it grew the
   * conversation by that much per message however short the message — towards
   * the point where Hermes compresses the conversation, which rewrites the
   * cached prefix as well. Sending them once per session is not an option
   * either: that compression folds old messages into a "reference only"
   * summary, instructions included. As a prefill they are always there,
   * always current, and identical from one request to the next.
   *
   * Returns the file's path, or null when they have to go in the message.
   */
  async _writePrefill(instructions) {
    if (!(await this._supportsPrefillEnv())) return null;
    const file = path.join(os.tmpdir(), `openagents-hermes-${crypto.randomBytes(8).toString('hex')}.json`);
    const content = [instructions, ...PREFILL_CLOSING].join('\n');
    try {
      // Owner-only: the instructions carry the workspace token.
      fs.writeFileSync(file, JSON.stringify([{ role: 'user', content }]), { mode: 0o600 });
      return file;
    } catch (e) {
      this._log(`Could not write the Hermes prefill file (${e.message}); sending workspace instructions with the message`);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Output parsing
  // ------------------------------------------------------------------

  _parseHermesOutput(raw, meta) {
    let sessionId = null;
    let body = raw;

    // Hermes -Q mode emits session_id to stderr (meta); the response body is
    // on stdout (raw). Older Hermes printed session_id on stdout, so fall
    // back to extracting it from the body when stderr carried none.
    if (meta) {
      const m = SESSION_ID_RE.exec(meta);
      if (m) sessionId = m[1];
    }
    if (!sessionId) {
      const m = SESSION_ID_RE.exec(body);
      if (m) {
        sessionId = m[1];
        body = body.replace(SESSION_ID_RE, '');
      }
    }

    const lines = [];
    for (const line of body.split(/\r?\n/)) {
      const stripped = line.trim();
      if (!stripped) continue;
      if (stripped.startsWith('↻ Resumed session ')) continue;
      lines.push(line);
    }
    return { text: lines.join('\n').trim(), sessionId };
  }

  /** Hermes's stderr without the session bookkeeping it prints on every run. */
  _stderrDetail(stderr) {
    return String(stderr || '')
      .split(/\r?\n/)
      .filter((line) => {
        const stripped = line.trim();
        return stripped && !SESSION_LINE_RE.test(stripped) && !stripped.startsWith('↻ Resumed session ');
      })
      .join('\n')
      .trim();
  }

  // ------------------------------------------------------------------
  // Subprocess lifecycle
  // ------------------------------------------------------------------

  _buildHermesCmd(prompt, resumeSessionId) {
    if (!this._hermesBin) {
      throw new Error(`hermes CLI not found. Install with: ${HERMES_INSTALL_HINT}`);
    }
    const args = [];
    if (this.hermesProfile && this.hermesProfile !== 'default') {
      args.push('-p', this.hermesProfile);
    }
    args.push(
      'chat',
      '-q', prompt,
      '-Q',
      '--source', this.hermesSource,
      '--max-turns', String(this.maxTurns),
    );
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    if (this.yolo) args.push('--yolo');
    return args;
  }

  /**
   * Run one Hermes turn and report what became of it.
   *
   * `sessionId` is what Hermes itself reported for this run. It prints one
   * whenever the turn got as far as the session — finished or not — and none
   * when the turn never began. `detail` is its stderr without that
   * bookkeeping; `stopped` says the user stopped the turn.
   *
   * @returns {Promise<{stopped: boolean, exitCode: number|null, text: string,
   *   sessionId: string|null, detail: string}>}
   */
  async _runHermes(prompt, channelName, resumeId = null, prefillFile = null) {
    // Stopped while this turn was being prepared: start nothing (no tokens).
    if (this._stoppedBeforeStart(channelName)) {
      return { stopped: true, exitCode: null, text: '', sessionId: null, detail: '' };
    }
    const args = this._buildHermesCmd(prompt, resumeId);
    this._log(`Running hermes (profile=${this.hermesProfile}, channel=${channelName}, resume=${!!resumeId})`);

    const env = { ...(this.agentEnv || process.env) };
    if (prefillFile) env[PREFILL_ENV] = prefillFile;

    // A hermes that lives inside WSL is rewritten to `wsl.exe -e <path> …` by
    // the bridge in ../wsl (which also forces detached off, there being no
    // process group on the far side, and hands the distro the agent's env via
    // WSLENV). hermes then uses its own config — ~/.hermes inside the distro —
    // for model and keys. Nothing to special-case here.
    const proc = spawn(this._hermesBin, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: this.workingDir,
      // No process group on Windows (can't signal one); windowsHide keeps a
      // console from flashing up.
      detached: !IS_WINDOWS,
      windowsHide: true,
    });
    this._channelProcesses[channelName] = proc;

    let stdout = '';
    let stderr = '';
    let spawnError = null;
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });

    // 'exit' can fire with output still in the pipes, and the session id is
    // the last thing Hermes prints. 'close' means they are drained — but it
    // never comes while a process the agent left running holds them open, so
    // it is only waited for briefly.
    const exitCode = await new Promise((resolve) => {
      let code = null;
      let drain = null;
      const done = () => { clearTimeout(drain); resolve(code); };
      proc.on('exit', (c) => { code = c; drain = setTimeout(done, 1000); });
      proc.on('close', done);
      proc.on('error', (e) => { spawnError = e; code = -1; done(); });
    });
    delete this._channelProcesses[channelName];

    // Hermes -Q mode: response body on stdout, session metadata
    // (session_id:, resume banner) on stderr — parse both streams.
    const { text, sessionId } = this._parseHermesOutput(stdout, stderr);
    return {
      stopped: this._stopRequestedDuringTurn(channelName),
      exitCode,
      text,
      sessionId,
      detail: spawnError ? spawnError.message : this._stderrDetail(stderr),
    };
  }

  /**
   * One prompt-and-run against a given session (null starts a new one), and
   * the bookkeeping that follows from it.
   */
  async _attemptTurn(channelName, content, resumeId) {
    const instructions = this._buildWorkspaceInstructions(channelName);
    const prefillFile = await this._writePrefill(instructions);
    let run;
    try {
      const prompt = await this._buildPrompt(channelName, content, resumeId, prefillFile ? '' : instructions);
      run = await this._runHermes(prompt, channelName, resumeId, prefillFile);
    } finally {
      // Hermes reads it once, at startup.
      if (prefillFile) try { fs.unlinkSync(prefillFile); } catch {}
    }

    // Whatever the exit code, a reported session exists and holds this turn.
    if (run.sessionId && run.sessionId !== this._channelSessions[channelName]) {
      this._channelSessions[channelName] = run.sessionId;
      this._saveSessions();
    }
    return run;
  }

  /**
   * Answer one message in the channel's Hermes session, starting a new session
   * only when there is none to resume.
   *
   * Hermes exits non-zero for every turn that does not finish: a provider
   * error, the iteration limit, a user stop. Each of those still prints the
   * session id — the session is intact and the turn is in it — so none of them
   * is a reason to let go of it. Reading any non-zero exit as "the resume
   * failed" used to drop the session and run the same prompt again in an empty
   * one: the conversation was lost, the work was done twice (tool calls
   * included, for a turn that had spent its iterations), and the user was
   * shown the second failure instead of Hermes's account of the first.
   *
   * What does call for a new session is a resumed turn that never began — no
   * session id comes back, typically with "Session not found". The saved id is
   * only replaced once the new run reports one of its own, or dropped when
   * Hermes said outright that it is gone: a Hermes that cannot start at all
   * (no credentials, say) says nothing about the session either.
   */
  async _converse(channelName, content) {
    const resumeId = this._channelSessions[channelName] || null;
    const run = await this._attemptTurn(channelName, content, resumeId);
    const neverBegan = !run.stopped && run.exitCode !== 0 && !run.sessionId;
    if (!resumeId || !neverBegan) return run;

    this._log(`Hermes could not resume session ${resumeId} (code=${run.exitCode}), starting a new one`);
    if (SESSION_NOT_FOUND_RE.test(run.detail)) this._forgetSession(channelName);
    return this._attemptTurn(channelName, content, null);
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 }); } catch {}
      } else {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch {
          proc.kill('SIGTERM');
        }
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {
              proc.kill('SIGKILL');
            }
            resolve();
          }, 5000);
          proc.on('exit', () => { clearTimeout(timeout); resolve(); });
        });
      }
    } catch {}
  }

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    const content = (msg.content || '').trim();
    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing workspace message from ${sender} in ${msgChannel}`);

    // Re-resolve per message: the constructor's lookup is a snapshot, and an
    // agent that was created before its CLI finished installing would
    // otherwise stay broken until the daemon restarts.
    if (!this._hermesBin) this._hermesBin = this._findHermesBinary();
    if (!this._hermesBin) {
      const message = `Hermes CLI not found — install with: ${HERMES_INSTALL_HINT}`;
      this._reportStatus(REASON.RUNTIME_MISSING, message);
      await this.sendError(msgChannel, message);
      return;
    }

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      const run = await this._converse(msgChannel, content);
      // The stop handler has already told the channel.
      if (run.stopped) return;

      if (run.exitCode === 0) {
        await this.sendResponse(msgChannel, run.text || 'No response generated. Please try again.');
      } else if (run.text) {
        // The turn did not finish, and stdout is Hermes's own account of why,
        // after whatever answer it had reached. Worth more to the user than
        // an exit code.
        this._log(`Hermes turn did not finish (code=${run.exitCode})`);
        await this.sendError(msgChannel, run.text);
      } else {
        throw new Error(`hermes exited with code ${run.exitCode}: ${run.detail.slice(0, 600)}`);
      }
    } catch (e) {
      this._log(`Hermes adapter error: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Static: configure Hermes's native model config from LLM env vars
  // ------------------------------------------------------------------

  /**
   * Point Hermes at a custom OpenAI-compatible endpoint from user-provided
   * LLM_API_KEY / LLM_BASE_URL / LLM_MODEL values. Called by saveAgentEnv when
   * type === 'hermes', same pattern as OpenClaw's configureNativeAuth.
   *
   * Hermes has no env-var path for a custom endpoint (OPENAI_BASE_URL is
   * honored only for its built-in openai provider) — the supported form is the
   * `model:` section of its config.yaml:
   *   model: { default: <id>, provider: custom, base_url: <url>, api_key: <key> }
   * Rather than hand-writing that YAML (and clobbering user config), drive
   * Hermes's own `hermes config set` CLI: it owns the schema, merges into the
   * existing file, and resolves its platform config path itself (~/.hermes on
   * Unix, %LOCALAPPDATA%\hermes on native Windows, in-distro under WSL).
   *
   * Without this, a remotely-created hermes agent died on every message with
   * "No inference provider configured" — the workspace's API-key field was a
   * silent no-op for this type.
   *
   * Only acts when LLM_BASE_URL is set: a user signed in via `hermes setup`
   * (the Nous login) must keep their own provider selection untouched.
   */
  static configureNativeAuth(env) {
    const vals = env || {};
    const baseUrl = String(vals.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
    if (!baseUrl) return { skipped: true, reason: 'no LLM_BASE_URL' };
    const model = String(vals.LLM_MODEL || '').trim();
    const apiKey = String(vals.LLM_API_KEY || '').trim();

    // Borrow the adapter's binary resolution without running the constructor.
    const probe = Object.create(HermesAdapter.prototype);
    probe._log = () => {};
    const bin = probe._findHermesBinary();
    if (!bin) return { skipped: true, reason: 'hermes binary not found' };

    const { execFileSync } = require('child_process');
    const run = (args) => {
      // Same rewrite the spawn bridge does, for the one call here that needs to
      // be synchronous: an in-distro hermes is only reachable through wsl.exe.
      const { file, args: argv } = bridgeSpawn(bin, args);
      execFileSync(file, argv, {
        stdio: 'ignore',
        timeout: 20000,
        windowsHide: true,
      });
    };

    run(['config', 'set', 'model.provider', 'custom']);
    run(['config', 'set', 'model.base_url', baseUrl]);
    if (model) run(['config', 'set', 'model.default', model]);
    if (apiKey) run(['config', 'set', 'model.api_key', apiKey]);
    return { configured: true };
  }
}

module.exports = HermesAdapter;
