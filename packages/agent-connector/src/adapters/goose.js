/**
 * Goose adapter for OpenAgents workspace.
 *
 * Bridges the Goose CLI (block/goose) to an OpenAgents workspace via Goose's
 * official headless mode:
 *
 *   goose run --output-format stream-json --name <session> [--resume] \
 *             --no-profile --with-builtin developer \
 *             --max-turns N --max-tool-repetitions M --system <ctx> -i -
 *
 * - The task prompt is written to the child's stdin (`-i -`), never argv.
 * - stdout is parsed incrementally as NDJSON stream-json (goose-stream.js);
 *   stderr is drained concurrently.
 * - Each (workspace, agent, channel) maps to a stable, unique Goose session
 *   name so conversations resume per-channel and never cross-talk.
 * - Provider/model/key/host come from native Goose env vars (this.agentEnv);
 *   the key is never placed on the command line or in logs.
 * - GOOSE_MODE=auto runs tools without interactive approval (required for
 *   headless); only the built-in `developer` extension is enabled by default.
 *
 * Port of sdk/src/openagents/adapters/goose.py. Verified against block/goose
 * v1.38.0. Goose is currently Beta — real end-to-end runs are pending.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync, execFileSync } = require('child_process');

const BaseAdapter = require('./base');
const { GooseStreamParser, classifyGooseError, redactSecrets } = require('./goose-stream');
const {
  buildWorkspaceIdentity,
  buildCollaborationPrompt,
  buildModePrompt,
} = require('./workspace-prompt');
const { whichBinary, getEnhancedEnv, defaultAgentWorkdir } = require('../paths');

const IS_WINDOWS = process.platform === 'win32';

const DEFAULT_INACTIVITY_TIMEOUT = 900; // seconds
const DEFAULT_MAX_TURNS = 100;
const DEFAULT_MAX_TOOL_REPETITIONS = 12;
const STDERR_CAP = 64 * 1024;
const STATUS_PREVIEW = 280;

// Minimum Goose CLI version verified against the stable tag (block/goose
// v1.37.0). Older releases may lack stream-json / the flags used here, so we
// refuse them with a clear upgrade prompt rather than failing obscurely.
const MIN_GOOSE_VERSION = [1, 37, 0];

/** Parse `goose --version` output (e.g. "goose 1.37.0") → [1,37,0], or null. */
function parseGooseVersion(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True if parsed >= minimum (or unknown — lenient). */
function gooseVersionMeetsMinimum(parsed, minimum = MIN_GOOSE_VERSION) {
  if (!parsed) return true;
  for (let i = 0; i < 3; i++) {
    const a = parsed[i] || 0;
    const b = minimum[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function tooOldMessage(parsed) {
  const cur = parsed ? parsed.join('.') : 'unknown';
  const minv = MIN_GOOSE_VERSION.join('.');
  return `Goose CLI ${cur} is too old — OpenAgents requires Goose >= ${minv} `
    + '(headless stream-json support). Upgrade it: curl -fsSL '
    + 'https://github.com/block/goose/releases/download/stable/download_cli.sh '
    + '| CONFIGURE=false bash';
}

/**
 * Stable, unique, filesystem-safe Goose session name for a channel.
 * Mirrors goose_session_name() in goose_stream.py / goose.py.
 */
function gooseSessionName(workspaceId, agentName, channel) {
  const digest = crypto
    .createHash('sha256')
    .update(`${workspaceId}|${agentName}|${channel}`)
    .digest('hex');
  return `oa_${digest.slice(0, 16)}`;
}

/** Locate the real `goose` CLI across platforms (PATH + well-known dirs). */
function findGooseBinary() {
  const home = os.homedir();
  // PATH (enriched with nvm/homebrew/etc), windowsHide avoids a console flash.
  try {
    const env = getEnhancedEnv();
    if (IS_WINDOWS) {
      const r = execSync('where goose.exe 2>nul || where goose.cmd 2>nul || where goose 2>nul', {
        encoding: 'utf-8', timeout: 5000, windowsHide: true, env,
      });
      const hit = r.split(/\r?\n/)[0].trim();
      if (hit) return hit;
    } else {
      const hit = execSync('command -v goose', {
        encoding: 'utf-8', timeout: 5000, windowsHide: true, env,
      }).trim();
      if (hit) return hit;
    }
  } catch {}

  const candidates = IS_WINDOWS ? [
    path.join(process.env.USERPROFILE || home, 'goose', 'goose.exe'),
    path.join(home, '.local', 'bin', 'goose.exe'),
  ] : [
    path.join(home, '.local', 'bin', 'goose'),  // official installer default
    '/opt/homebrew/bin/goose',                  // macOS Homebrew (Apple silicon)
    '/usr/local/bin/goose',                     // macOS Homebrew (Intel) / Linux
    path.join(home, 'bin', 'goose'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }

  // Deep scan of every known bin dir (nvm/fnm/volta/homebrew/…).
  const viaWhich = whichBinary('goose');
  if (viaWhich) return viaWhich;
  return null;
}

class GooseAdapter extends BaseAdapter {
  /**
   * @param {object} opts BaseAdapter opts plus { disabledModules, workingDir }
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    // channel → Goose session name. Persisted so the mapping survives a daemon
    // restart (Goose stores the conversation itself in its SQLite session DB).
    this._channelSessions = {};
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_goose.json`,
    );
    this._loadSessions();

    this._channelProcesses = {};
    this._stoppingChannels = new Set();

    // One-time minimum-version pre-flight (cached for the adapter lifetime).
    this._versionChecked = false;
    this._versionTooOld = null;

    this._gooseBinary = findGooseBinary();
    if (this._gooseBinary) {
      this._log(`Using Goose CLI: ${this._gooseBinary}`);
    } else {
      this._log('goose CLI not found. Install (non-interactively): '
        + 'curl -fsSL '
        + 'https://github.com/block/goose/releases/download/stable/download_cli.sh '
        + '| CONFIGURE=false bash');
    }

    this._secrets = this._collectSecretValues();
  }

  // -- session mapping persistence ----------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          for (const [k, v] of Object.entries(data)) {
            if (typeof v === 'string') this._channelSessions[k] = v;
          }
          this._log(`Loaded ${Object.keys(this._channelSessions).length} Goose session mapping(s)`);
        }
      }
    } catch {
      this._log('Could not load Goose sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  // -- environment / provider config --------------------------------------

  _collectSecretValues() {
    const env = this.agentEnv || process.env;
    const secrets = [];
    for (const [key, val] of Object.entries(env)) {
      if (!val || typeof val !== 'string' || val.length < 4) continue;
      const upper = key.toUpperCase();
      if (upper.includes('API_KEY') || upper.includes('TOKEN') || upper.includes('SECRET')) {
        secrets.push(val);
      }
    }
    return secrets;
  }

  _buildEnv() {
    const env = { ...(this.agentEnv || process.env) };
    const mode = String(env.GOOSE_MODE || '').trim().toLowerCase();
    if (mode === 'auto' || mode === 'chat') {
      env.GOOSE_MODE = mode;
    } else {
      if (mode === 'approve' || mode === 'smart_approve') {
        this._log(`GOOSE_MODE=${mode} waits for interactive approval and cannot run `
          + "headless; overriding to 'auto' for this agent.");
      }
      env.GOOSE_MODE = 'auto';
    }
    return env;
  }

  _maxTurns() {
    const env = this.agentEnv || process.env;
    const n = parseInt(env.GOOSE_MAX_TURNS, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TURNS;
  }

  _maxToolRepetitions() {
    const env = this.agentEnv || process.env;
    const n = parseInt(env.GOOSE_MAX_TOOL_REPETITIONS, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOOL_REPETITIONS;
  }

  _inactivityTimeout() {
    const env = this.agentEnv || process.env;
    const n = parseFloat(env.GOOSE_INACTIVITY_TIMEOUT);
    return Number.isFinite(n) && n >= 30 ? n : DEFAULT_INACTIVITY_TIMEOUT;
  }

  _buildSystemPrompt(channelName) {
    let prompt = buildWorkspaceIdentity(this.agentName, this.workspaceId, channelName, this._mode)
      + buildCollaborationPrompt()
      + buildModePrompt(this._mode);
    if (this.workingDir) {
      prompt += `\n## Project Directory\nYou are working in: ${this.workingDir}\n`
        + 'Make all file changes within this directory.\n';
    }
    return prompt;
  }

  _resolveCwd() {
    if (!this.workingDir) return defaultAgentWorkdir(this.agentName);
    let stat;
    try {
      stat = fs.statSync(this.workingDir);
    } catch {
      throw new Error(`Project directory does not exist: ${this.workingDir}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Project path is not a directory: ${this.workingDir}`);
    }
    return this.workingDir;
  }

  _safe(text) {
    return redactSecrets(text, this._secrets);
  }

  // -- control actions (stop) ---------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        await this._stopChannel(channel, 'Execution stopped by user.');
      } else {
        await this._stopAll('Execution stopped by user.');
      }
      return;
    }
    await super._onControlAction(action, payload);
  }

  async _stopChannel(channel, message) {
    const proc = this._channelProcesses[channel];
    const hadQueue = !!(this._channelQueues[channel] && this._channelQueues[channel].length);
    if (proc) {
      this._stoppingChannels.add(channel);
      await this._stopProcess(proc);
      delete this._channelProcesses[channel];
    }
    delete this._channelQueues[channel];
    if (proc || hadQueue) {
      try { await this.sendStatus(channel, message); } catch {}
    }
  }

  async _stopAll(message) {
    for (const channel of Object.keys(this._channelProcesses)) {
      // eslint-disable-next-line no-await-in-loop
      await this._stopChannel(channel, message);
    }
  }

  /** Override BaseAdapter.stop so daemon shutdown tears down in-flight runs. */
  stop() {
    this._stopAll('Task interrupted — daemon restarting. Send another message to continue.')
      .catch(() => {});
    super.stop();
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { proc.kill('SIGINT'); } catch {}
        const exited = await new Promise((resolve) => {
          if (proc.exitCode !== null) { resolve(true); return; }
          const timeout = setTimeout(() => resolve(false), 1500);
          proc.once('exit', () => { clearTimeout(timeout); resolve(true); });
        });
        if (!exited) {
          try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 }); } catch {}
        }
      } else {
        // Kill the whole process group (Goose's shell commands, dev servers and
        // any MCP/extension children share it — we spawn detached).
        try { process.kill(-proc.pid, 'SIGTERM'); } catch {
          proc.kill('SIGTERM');
        }
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          const timeout = setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {
              proc.kill('SIGKILL');
            }
            const reap = setTimeout(finish, 1000);
            proc.once('exit', () => { clearTimeout(reap); finish(); });
          }, 1500);
          proc.once('exit', () => { clearTimeout(timeout); finish(); });
        });
      }
    } catch {}
  }

  // -- message handler ----------------------------------------------------

  async _handleMessage(msg) {
    const content = (msg.content || '').trim();
    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.slice(0, 80)}...`);

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      // null → stopped or a failure already reported; '' → empty success; str → answer.
      const result = await this._runGoose(content, msgChannel);
      if (result === null) return;
      if (result) {
        await this.sendResponse(msgChannel, result);
      } else {
        await this.sendResponse(
          msgChannel,
          'Goose ran but produced no response. This usually means no provider/model is '
          + 'configured — set GOOSE_PROVIDER and GOOSE_MODEL (and a key) for this agent, '
          + 'or run `goose configure` once outside OpenAgents.',
        );
      }
    } catch (e) {
      if (this._stoppingChannels.has(msgChannel)) {
        this._stoppingChannels.delete(msgChannel);
        return;
      }
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${this._safe(e.message)}`);
    } finally {
      this._stoppingChannels.delete(msgChannel);
    }
  }

  // -- subprocess execution ----------------------------------------------

  _buildCmd(sessionName, resume, systemPrompt) {
    const binary = this._gooseBinary || findGooseBinary();
    if (!binary) {
      throw new Error('goose CLI not found. Install (non-interactively): '
        + 'curl -fsSL '
        + 'https://github.com/block/goose/releases/download/stable/download_cli.sh '
        + '| CONFIGURE=false bash');
    }
    this._gooseBinary = binary;
    const cmd = [
      binary, 'run',
      '--output-format', 'stream-json',
      '--name', sessionName,
      '--no-profile',
      '--with-builtin', 'developer',
      '--max-turns', String(this._maxTurns()),
      '--max-tool-repetitions', String(this._maxToolRepetitions()),
    ];
    if (resume) cmd.push('--resume');
    cmd.push('--system', systemPrompt, '-i', '-');
    return cmd;
  }

  /**
   * Run one headless `goose run`. Resolves null (stopped/failure already
   * reported), '' (empty success), or the answer text.
   */
  /**
   * Check the installed Goose CLI meets MIN_GOOSE_VERSION once (cached).
   * Returns an upgrade-prompt string if it is definitively too old, else null
   * (new enough, missing, or undeterminable — lenient).
   */
  _versionTooOldMessage() {
    if (this._versionChecked) return this._versionTooOld;
    this._versionChecked = true;
    this._versionTooOld = null;
    const binary = this._gooseBinary || findGooseBinary();
    if (!binary) return null;
    let parsed = null;
    try {
      const out = execFileSync(binary, ['--version'], {
        encoding: 'utf-8', timeout: 10000, windowsHide: true,
      });
      parsed = parseGooseVersion(out);
    } catch {
      return null; // can't determine → don't block
    }
    if (!gooseVersionMeetsMinimum(parsed)) this._versionTooOld = tooOldMessage(parsed);
    return this._versionTooOld;
  }

  _runGoose(content, channel, retry = false) {
    let cwd;
    try {
      cwd = this._resolveCwd();
    } catch (e) {
      return this.sendError(channel, e.message).then(() => null, () => null);
    }

    // Refuse a Goose CLI older than the verified-stable minimum.
    const tooOld = this._versionTooOldMessage();
    if (tooOld) return this.sendError(channel, tooOld).then(() => null, () => null);

    const sessionName = this._channelSessions[channel]
      || gooseSessionName(this.workspaceId, this.agentName, channel);
    const resume = Object.prototype.hasOwnProperty.call(this._channelSessions, channel);
    const systemPrompt = this._buildSystemPrompt(channel);

    let cmd;
    try {
      cmd = this._buildCmd(sessionName, resume, systemPrompt);
    } catch (e) {
      return this.sendError(channel, e.message).then(() => null, () => null);
    }

    const env = this._buildEnv();
    const parser = new GooseStreamParser();
    const captured = { finalText: null };
    let stderr = '';
    let lastActivity = Date.now();

    this._log(`CLI: goose run --output-format stream-json --name ${sessionName}`
      + `${resume ? ' --resume' : ''} --no-profile --with-builtin developer`);

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(cmd[0], cmd.slice(1), {
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
          cwd,
          detached: !IS_WINDOWS, // own process group for tree kill
          windowsHide: true,
        });
      } catch (e) {
        this.sendError(channel, `Failed to start Goose: ${this._safe(e.message)}`)
          .then(() => resolve(null), () => resolve(null));
        return;
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

      let settled = false;
      let pending = Promise.resolve();
      const dispatch = (ev) => {
        pending = pending.then(() => this._dispatchEvent(channel, ev, captured)).catch(() => {});
      };

      // Inactivity watchdog: kill a truly hung run (no output for a long time).
      const timeoutSec = this._inactivityTimeout();
      const watchdog = setInterval(() => {
        if (proc.exitCode !== null) return;
        if ((Date.now() - lastActivity) / 1000 > timeoutSec) {
          this._log(`Goose produced no output for ${timeoutSec}s — treating as hung, killing.`);
          this._stoppingChannels.add(channel);
          this._stopProcess(proc).catch(() => {});
          this.sendError(
            channel,
            'Goose appears to have hung (no output for a long time) and was stopped. '
            + 'Try a smaller task or check the provider.',
          ).catch(() => {});
        }
      }, Math.min(30000, timeoutSec * 1000));

      if (proc.stdout) {
        proc.stdout.on('data', (chunk) => {
          lastActivity = Date.now();
          for (const ev of parser.feed(chunk.toString('utf-8'))) dispatch(ev);
        });
      }
      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => {
          lastActivity = Date.now();
          if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf-8');
        });
      }

      // Write the prompt via stdin, then close it. Goose reads stdin to EOF
      // before processing, so writing+closing here is required and safe.
      if (proc.stdin) {
        proc.stdin.on('error', () => {});
        try {
          proc.stdin.write(content, 'utf-8');
          proc.stdin.end();
        } catch { /* child gone — close handler reports it */ }
      }

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        if (this._channelProcesses[channel] === proc) delete this._channelProcesses[channel];
        this.sendError(channel, `Failed to run Goose: ${this._safe(err.message)}`)
          .then(() => resolve(null), () => resolve(null));
      });

      // 'close' fires after stdout/stderr drain — never parse a truncated stream.
      proc.on('close', async (code) => {
        if (settled) return;
        settled = true;
        clearInterval(watchdog);
        if (this._channelProcesses[channel] === proc) delete this._channelProcesses[channel];

        for (const ev of parser.finish()) dispatch(ev);
        await pending;

        if (this._stoppingChannels.has(channel)) {
          resolve(null);
          return;
        }

        const stderrText = stderr.trim();

        // Auto-heal a stale/missing session (Goose exits non-zero when --resume
        // names a session it can't find). Recreate once.
        if (resume && code && !retry && stderrText.toLowerCase().includes('no session found')) {
          this._log(`Goose session ${sessionName} missing; creating a fresh one.`);
          delete this._channelSessions[channel];
          this._saveSessions();
          await this.sendStatus(
            channel,
            'Previous Goose session was unavailable — starting a new one (earlier context is reset).',
          );
          resolve(await this._runGoose(content, channel, true));
          return;
        }

        // Failure: non-zero exit OR an error event (Goose can exit 0 after an
        // agent error). A non-zero exit is never a success, even with partial text.
        if (code !== 0 || parser.hadError) {
          const detail = parser.errorMessage || stderrText;
          const message = classifyGooseError(detail)
            || (detail ? this._safe(detail).slice(0, 500) : `Goose exited with code ${code}.`);
          await this.sendError(channel, this._safe(message));
          resolve(null);
          return;
        }

        if (!Object.prototype.hasOwnProperty.call(this._channelSessions, channel)) {
          this._channelSessions[channel] = sessionName;
          this._saveSessions();
        }
        resolve(captured.finalText || '');
      });
    });
  }

  async _dispatchEvent(channel, event, captured) {
    const kind = event.kind;
    if (kind === 'final') {
      captured.finalText = event.text || '';
      return;
    }
    if (kind === 'tool') {
      const name = event.name || 'tool';
      const summary = this._safe(event.summary || '');
      await this.sendStatus(channel, `🔧 ${name}${summary ? ` — ${summary}` : ''}`);
    } else if (kind === 'progress') {
      // Intermediate assistant narration is assistant output, not internal
      // reasoning — post it as transient status, never as a "thinking" message.
      let text = this._safe(event.text || '').trim();
      if (text) {
        if (text.length > STATUS_PREVIEW) text = text.slice(0, STATUS_PREVIEW) + '…';
        await this.sendStatus(channel, text);
      }
    } else if (kind === 'thinking') {
      // Genuine model thinking content (ThinkingContent) — legitimately a
      // thinking message.
      let text = this._safe(event.text || '').trim();
      if (text) {
        if (text.length > STATUS_PREVIEW) text = text.slice(0, STATUS_PREVIEW) + '…';
        await this.sendThinking(channel, text);
      }
    } else if (kind === 'notification') {
      const text = this._safe(event.text || '').trim();
      if (text) await this.sendStatus(channel, text.slice(0, STATUS_PREVIEW));
    }
    // tool_result / complete / error → no direct status (error handled by caller)
  }
}

GooseAdapter.gooseSessionName = gooseSessionName;
GooseAdapter.findGooseBinary = findGooseBinary;
GooseAdapter.parseGooseVersion = parseGooseVersion;
GooseAdapter.gooseVersionMeetsMinimum = gooseVersionMeetsMinimum;
GooseAdapter.MIN_GOOSE_VERSION = MIN_GOOSE_VERSION;

module.exports = GooseAdapter;
