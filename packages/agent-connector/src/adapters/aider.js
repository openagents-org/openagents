/**
 * Aider adapter for OpenAgents workspace.
 *
 * Bridges Aider (https://aider.chat) to an OpenAgents workspace by running the
 * CLI in its official non-interactive *scripting* mode:
 *
 *   aider --message-file <tmp> --yes-always --no-pretty --no-stream \
 *         --no-auto-commits --no-dirty-commits --no-gitignore \
 *         --chat-history-file <per-channel> --input-history-file <per-channel> \
 *         [--restore-chat-history] [--model <model>]
 *
 * Differs from the Amp adapter in every Aider-specific dimension:
 *  - Prompt is written to a private per-task message file (--message-file), so
 *    a long prompt never hits ARG_MAX / shell quoting; never string-concatenated.
 *  - Aider has no JSON event protocol — plain text is drained incrementally,
 *    notable progress lines relayed as `status`, and the cleaned transcript sent
 *    once as the final answer. The exit code decides success (non-zero is never
 *    reported as success even with stdout).
 *  - Per-channel `--chat-history-file` + `--restore-chat-history` give isolated,
 *    resumable sessions stored under ~/.openagents/sessions/aider (never in the
 *    project). A corrupt history file degrades to a fresh session.
 *  - Git auto-commit is OFF by default (--no-auto-commits --no-dirty-commits)
 *    and the tracked .gitignore is never rewritten (--no-gitignore); Aider's
 *    local cache is excluded via .git/info/exclude.
 *  - Multi-provider auth: a generic LLM_API_KEY is mapped to the right provider
 *    env var from the model string; keys never reach the command line or logs.
 *
 * Reuses all shared connectivity / dispatch / state machinery in BaseAdapter.
 *
 * Mirrors the Python adapter: sdk/src/openagents/adapters/aider.py
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { whichBinary, getEnhancedEnv, aiderBinDirs } = require('../paths');

const IS_WINDOWS = process.platform === 'win32';
// Terminate if Aider produces no output for this long (a wedged turn). Resets
// on any stdout activity, so a slow-but-progressing task is never killed.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STATUS_UPDATES = 60;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const BLANKS_RE = /\n{3,}/g;
const PROGRESS_RE =
  /^(Applied edit|Edited |Wrote |Created |Added |Removed |Committing|Commit |Running |Scanning |Repo-map|Reformatting|Skipped |Renamed )/i;

const ERROR_SIGNATURES = [
  [['authenticationerror', 'invalid api key', 'incorrect api key', 'no api key',
    'missing these environment variables', 'api key not found', '401',
    'unauthorized', 'permission denied to access model'],
    'Authentication failed — check the API key for the selected model/provider.'],
  [['notfounderror', 'model_not_found', 'does not exist', 'unknown model',
    'could not find model', 'you do not have access to model'],
    'Model not found or not accessible — check the model name and that your key has access.'],
  [['rate limit', 'ratelimiterror', '429', 'quota', 'insufficient_quota'],
    'Rate-limited or out of quota at the model provider — try again later.'],
  [['connectionerror', 'timeout', 'could not connect', 'getaddrinfo',
    'temporary failure in name resolution', 'network is unreachable',
    'failed to establish a new connection'],
    'Network error reaching the model provider — check connectivity and the base URL.'],
  [['permission denied', 'eacces', 'read-only file system', 'operation not permitted'],
    'File permission error in the working directory.'],
  [['gitcommanderror', 'fatal: not a git repository', 'git failed', 'not a git repo'],
    'Git error while applying changes.'],
];

function aiderInstallHint() {
  return IS_WINDOWS
    ? 'powershell -NoProfile -Command "irm https://aider.chat/install.ps1 | iex"'
    : 'curl -LsSf https://aider.chat/install.sh | sh';
}

function isTruthy(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
}

function cleanOutput(text) {
  return String(text || '').replace(ANSI_RE, '').replace(BLANKS_RE, '\n\n').trim();
}

function classifyError(stderr, stdout) {
  const blob = `${stderr}\n${stdout}`.toLowerCase();
  for (const [needles, message] of ERROR_SIGNATURES) {
    if (needles.some((n) => blob.includes(n))) return message;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider resolution — must stay behaviourally identical to the Python adapter
// (sdk/src/openagents/adapters/aider.py). Aider routes through LiteLLM, so a
// single generic LLM_API_KEY is injected into the provider-specific env var the
// chosen model expects. Provider is chosen DETERMINISTICALLY:
//   1. explicit AIDER_PROVIDER (not 'auto') wins;
//   2. else infer from an unambiguous model name (case-insensitive);
//   3. key set but provider undeterminable → config error (never silently OpenAI);
//   4. no key → leave the inherited/native provider env untouched (auto mode).
// Env var names verified against aider's official docs / `aider --help`.
// ---------------------------------------------------------------------------

const VALID_PROVIDERS = [
  'auto', 'openai', 'anthropic', 'openrouter', 'requesty', 'gemini', 'deepseek',
  'openai-compatible',
];
const PROVIDER_KEY_VAR = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  requesty: 'REQUESTY_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'openai-compatible': 'OPENAI_API_KEY',
};

function explicitPrefixProvider(model) {
  const m = String(model || '').trim().toLowerCase();
  if (m.startsWith('openrouter/')) return 'openrouter';
  if (m.startsWith('requesty/')) return 'requesty';
  if (m.startsWith('anthropic/')) return 'anthropic';
  if (m.startsWith('openai/')) return 'openai';
  if (m.startsWith('gemini/') || m.startsWith('google/')) return 'gemini';
  if (m.startsWith('deepseek/')) return 'deepseek';
  return null;
}

function inferProviderFromModel(model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return null;
  const prefixed = explicitPrefixProvider(m);
  if (prefixed) return prefixed;
  if (m.includes('claude') || m.includes('sonnet') || m.includes('opus') || m.includes('haiku')) return 'anthropic';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('gemini')) return 'gemini';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')
      || m.startsWith('o4-') || m.startsWith('chatgpt') || m.includes('gpt-')) return 'openai';
  return null;
}

function normalizeOpenAiModel(model) {
  const m = String(model || '').trim();
  if (!m) return m;
  if (m.toLowerCase().startsWith('openai/')) return m;
  return `openai/${m}`;
}

/**
 * Deterministically resolve the provider env vars (and any model normalization)
 * for a generic LLM_API_KEY.
 * @returns {{ env: object, model: string, error: string|null }}
 *   `env` is the provider vars to inject; `model` is the possibly-normalized
 *   model; `error` is a clear message when the config is invalid/ambiguous (in
 *   which case Aider must NOT start).
 */
function resolveAiderProvider(provider, model, apiKey, baseUrl) {
  provider = String(provider || '').trim().toLowerCase();
  model = String(model || '').trim();
  apiKey = String(apiKey || '').trim();
  baseUrl = String(baseUrl || '').trim();

  if (provider && !VALID_PROVIDERS.includes(provider)) {
    return {
      env: {}, model,
      error: `Unknown AIDER_PROVIDER '${provider}'. Valid values: auto, openai, `
        + 'anthropic, openrouter, requesty, gemini, deepseek, openai-compatible.',
    };
  }
  if (!provider) provider = 'auto';

  // No generic key: auto mode — never fabricate/override provider keys.
  if (!apiKey) {
    if (provider === 'openai-compatible') {
      if (!baseUrl) {
        return { env: {}, model, error: 'AIDER_PROVIDER=openai-compatible requires LLM_BASE_URL (the OpenAI-compatible endpoint URL).' };
      }
      return { env: { OPENAI_API_BASE: baseUrl }, model: normalizeOpenAiModel(model), error: null };
    }
    return { env: {}, model, error: null };
  }

  // Generic key present: a concrete provider is required.
  let resolved;
  if (provider === 'auto') {
    const inferred = inferProviderFromModel(model);
    if (!inferred) {
      return {
        env: {}, model,
        error: 'Could not determine the model provider for LLM_API_KEY. Set '
          + 'AIDER_PROVIDER (openai, anthropic, openrouter, requesty, gemini, deepseek, or '
          + 'openai-compatible), use an AIDER_MODEL whose name identifies the '
          + 'provider, or set the native provider key directly.',
      };
    }
    resolved = inferred;
  } else {
    resolved = provider;
    const prefixProv = explicitPrefixProvider(model);
    const effective = resolved === 'openai-compatible' ? 'openai' : resolved;
    if (prefixProv && prefixProv !== effective) {
      return {
        env: {}, model,
        error: `AIDER_PROVIDER=${provider} conflicts with AIDER_MODEL '${model}' `
          + `(which targets ${prefixProv}). Fix the provider or the model.`,
      };
    }
  }

  if (resolved === 'openai-compatible') {
    if (!baseUrl) {
      return { env: {}, model, error: 'AIDER_PROVIDER=openai-compatible requires LLM_BASE_URL (the OpenAI-compatible endpoint URL).' };
    }
    return {
      env: { OPENAI_API_KEY: apiKey, OPENAI_API_BASE: baseUrl },
      model: normalizeOpenAiModel(model), error: null,
    };
  }

  const env = { [PROVIDER_KEY_VAR[resolved]]: apiKey };
  // A base URL only belongs to the OpenAI variable family.
  if (baseUrl && resolved === 'openai') env.OPENAI_API_BASE = baseUrl;
  return { env, model, error: null };
}

class AiderAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    // channel -> running child process (for stop / cleanup)
    this._channelProcesses = {};
    // channels the user explicitly stopped (suppress "no response" noise)
    this._stoppingChannels = new Set();
    // git repos already given the local Aider exclude
    this._gitExcludeDone = new Set();

    this._sessionsDir = path.join(
      os.homedir(), '.openagents', 'sessions', 'aider',
      `${this.workspaceId}_${this.agentName}`,
    );

    this._aiderBin = this._findAiderBinary();
    if (this._aiderBin) {
      this._log(`Using Aider CLI: ${this._aiderBin}`);
    } else {
      this._log(`Warning: Aider CLI not found — install with: ${aiderInstallHint()}`);
    }
  }

  // ------------------------------------------------------------------
  // Binary resolution
  // ------------------------------------------------------------------

  _findAiderBinary() {
    // Shared cross-platform resolver runs `which`/`where` against an ENHANCED
    // PATH (nvm/fnm/volta/homebrew + the Aider install dirs added to paths.js)
    // — covers the GUI/daemon "not on PATH" case for uv-tool / pipx / pip-user
    // installs.
    const resolved = whichBinary('aider');
    if (resolved) return resolved;

    // Explicit fallback over every real install dir (XDG bin, XDG_DATA_HOME/../
    // bin, ~/.local/bin, the uv tools venv) in the installer's own priority.
    const names = IS_WINDOWS ? ['aider.exe', 'aider.cmd', 'aider'] : ['aider'];
    for (const dir of aiderBinDirs()) {
      for (const name of names) {
        const c = path.join(dir, name);
        if (fs.existsSync(c)) return c;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Per-channel session storage
  // ------------------------------------------------------------------

  _safeChannelId(channel) {
    let slug = String(channel || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
    return slug || 'general';
  }

  _chatHistoryFile(channel) {
    return path.join(this._sessionsDir, `${this._safeChannelId(channel)}.chat.history.md`);
  }

  _inputHistoryFile(channel) {
    return path.join(this._sessionsDir, `${this._safeChannelId(channel)}.input.history`);
  }

  _hasHistory(channel) {
    const p = this._chatHistoryFile(channel);
    try {
      const st = fs.statSync(p);
      if (!st.size) return false;
      fs.readFileSync(p, 'utf-8');
      return true;
    } catch (e) {
      if (e && e.code === 'ENOENT') return false;
      // Unreadable/corrupt → degrade to a fresh session.
      this._log(`Aider chat history for ${this._safeChannelId(channel)} unreadable — starting fresh`);
      try { fs.renameSync(p, `${p}.corrupt`); } catch {}
      return false;
    }
  }

  resetChannelSession(channel) {
    for (const p of [this._chatHistoryFile(channel), this._inputHistoryFile(channel)]) {
      try { fs.rmSync(p, { force: true }); } catch {}
    }
  }

  clearAllSessions() {
    try { fs.rmSync(this._sessionsDir, { recursive: true, force: true }); } catch {}
  }

  // ------------------------------------------------------------------
  // Git hygiene — keep Aider's cache out of `git status` without touching the
  // user's tracked .gitignore.
  // ------------------------------------------------------------------

  _ensureLocalGitExclude(workingDir) {
    if (!workingDir || this._gitExcludeDone.has(workingDir)) return;
    this._gitExcludeDone.add(workingDir);
    try {
      const gitDir = path.join(workingDir, '.git');
      if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) return;
      const infoDir = path.join(gitDir, 'info');
      fs.mkdirSync(infoDir, { recursive: true });
      const exclude = path.join(infoDir, 'exclude');
      let existing = '';
      try { existing = fs.readFileSync(exclude, 'utf-8'); } catch {}
      if (!existing.includes('.aider')) {
        const sep = (!existing || existing.endsWith('\n')) ? '' : '\n';
        fs.writeFileSync(exclude, `${existing}${sep}# Added by OpenAgents Aider agent\n.aider*\n`);
      }
    } catch {}
  }

  // ------------------------------------------------------------------
  // Command + env construction
  // ------------------------------------------------------------------

  _model() {
    return String(this.agentEnv.AIDER_MODEL || this.agentEnv.LLM_MODEL || '').trim();
  }

  /**
   * Deterministically resolve provider env + model from the agent config.
   * Pure, so command/env builders and the pre-flight gate stay in sync.
   * @returns {{ env: object, model: string, error: string|null }}
   */
  _resolveConfig() {
    return resolveAiderProvider(
      this.agentEnv.AIDER_PROVIDER,
      this._model(),
      this.agentEnv.LLM_API_KEY,
      this.agentEnv.LLM_BASE_URL || this.agentEnv.OPENAI_API_BASE,
    );
  }

  _buildAiderCmd(channel, msgFile, restore) {
    const autoCommit = isTruthy(this.agentEnv.AIDER_AUTO_COMMITS);
    const cmd = [
      this._aiderBin,
      '--message-file', msgFile,
      '--yes-always',
      '--no-pretty',
      '--no-stream',
      '--no-check-update',
      '--no-gitignore',
      '--no-dirty-commits',
      '--chat-history-file', this._chatHistoryFile(channel),
      '--input-history-file', this._inputHistoryFile(channel),
    ];
    cmd.push(autoCommit ? '--auto-commits' : '--no-auto-commits');
    if (restore) cmd.push('--restore-chat-history');
    // Use the resolved (possibly openai/-normalized) model, not the raw value.
    const model = this._resolveConfig().model;
    if (model) cmd.push('--model', model);
    return cmd;
  }

  _buildSubprocessEnv() {
    const base = getEnhancedEnv(this.agentEnv);
    if (base.NO_COLOR === undefined) base.NO_COLOR = '1';
    base.PYTHONUNBUFFERED = '1';
    Object.assign(base, this._resolveConfig().env);
    return base;
  }

  // ------------------------------------------------------------------
  // Control actions (stop / reset)
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      for (const [channel, proc] of Object.entries(this._channelProcesses)) {
        this._stoppingChannels.add(channel);
        await this._stopProcess(proc);
        delete this._channelProcesses[channel];
        try { await this.sendStatus(channel, 'Execution stopped by user'); } catch {}
      }
      return;
    }
    if (action === 'reset_session' || action === 'clear_session') {
      const channel = (payload && payload.channel) || this.channelName;
      this.resetChannelSession(channel);
      return;
    }
    await super._onControlAction(action, payload);
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 }); } catch {}
        return;
      }
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
          resolve();
        }, 5000);
        proc.on('exit', () => { clearTimeout(timeout); resolve(); });
      });
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
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.length} chars`);

    if (!this._aiderBin) this._aiderBin = this._findAiderBinary();
    if (!this._aiderBin) {
      await this.sendError(msgChannel, `Aider CLI not found. Install with: ${aiderInstallHint()}`);
      return;
    }

    // Pre-flight: resolve the provider/key BEFORE starting Aider so a
    // misconfiguration returns a crisp, actionable error (and never silently
    // injects the key into the wrong provider).
    const resolution = this._resolveConfig();
    if (resolution.error) {
      await this.sendError(msgChannel, `Configuration error: ${resolution.error}`);
      return;
    }

    await this._autoTitleChannel(msgChannel, content);
    this._stoppingChannels.delete(msgChannel);
    this._ensureLocalGitExclude(this.workingDir);
    await this.sendStatus(msgChannel, 'Aider is working...');

    let result;
    try {
      result = await this._runAider(content, msgChannel);
    } catch (e) {
      this._log(`Error handling message: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
      return;
    }

    if (this._stoppingChannels.has(msgChannel)) {
      this._stoppingChannels.delete(msgChannel);
      return;
    }
    const { text, error } = result;
    if (error) {
      await this.sendError(msgChannel, error);
    } else if (text) {
      await this.sendResponse(msgChannel, text);
    } else {
      await this.sendResponse(
        msgChannel,
        'Aider finished with no textual output (any file changes were applied to the working directory).',
      );
    }
  }

  // ------------------------------------------------------------------
  // Subprocess execution
  // ------------------------------------------------------------------

  async _runAider(content, msgChannel) {
    // Defensive re-check (the primary gate is in _handleMessage): never spawn
    // Aider — nor create a temp file — on an invalid configuration.
    const resolution = this._resolveConfig();
    if (resolution.error) {
      return { text: '', error: `Configuration error: ${resolution.error}` };
    }

    fs.mkdirSync(this._sessionsDir, { recursive: true });
    const restore = this._hasHistory(msgChannel);

    // Private per-task message file outside the project. The prompt body never
    // appears on the command line or in a filename/log.
    const msgFile = path.join(
      this._sessionsDir,
      `aider-msg-${process.pid}-${this._msgCounter = (this._msgCounter || 0) + 1}.txt`,
    );
    try {
      fs.writeFileSync(msgFile, content, 'utf-8');
      const cmd = this._buildAiderCmd(msgChannel, msgFile, restore);
      return await this._spawnAider(cmd, msgChannel);
    } finally {
      try { fs.rmSync(msgFile, { force: true }); } catch {}
    }
  }

  _spawnAider(cmd, msgChannel) {
    return new Promise((resolve, reject) => {
      const env = this._buildSubprocessEnv();

      const proc = spawn(cmd[0], cmd.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd: this.workingDir,
        detached: !IS_WINDOWS,
        windowsHide: true,
        shell: IS_WINDOWS && String(cmd[0]).toLowerCase().endsWith('.cmd'),
      });
      this._channelProcesses[msgChannel] = proc;

      // Guard the child's stdio streams against 'error'. When the process is
      // SIGKILL'd on stop, macOS Node can emit a benign EPIPE/ECONNRESET 'error'
      // on stdout/stderr a tick later; with a 'data' listener but no 'error'
      // listener that becomes an uncaughtException which crashes the
      // (single-process, e.g. Node 18) test run with exit 1 and no `not ok`.
      // No-op — data handling below is unchanged.
      if (proc.stdout) proc.stdout.on('error', () => {});
      if (proc.stderr) proc.stderr.on('error', () => {});

      let stdoutBuf = '';
      let stderrBuf = '';
      let lineBuffer = '';
      let statusCount = 0;
      let pending = Promise.resolve();

      let idleTimer = null;
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          this._log(`Aider produced no output for ${IDLE_TIMEOUT_MS / 1000}s — terminating`);
          this._stopProcess(proc);
        }, IDLE_TIMEOUT_MS);
      };
      armIdle();

      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });
      }

      const handleLine = async (raw) => {
        const stripped = raw.replace(ANSI_RE, '').trim();
        if (stripped && statusCount < MAX_STATUS_UPDATES && PROGRESS_RE.test(stripped)) {
          statusCount += 1;
          try { await this.sendStatus(msgChannel, stripped.slice(0, 300)); } catch {}
        }
      };

      proc.stdout.on('data', (chunk) => {
        armIdle();
        const s = chunk.toString('utf-8');
        stdoutBuf += s;
        lineBuffer += s;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
          pending = pending.then(() => handleLine(line)).catch(() => {});
        }
      });

      proc.on('exit', async (code) => {
        if (idleTimer) clearTimeout(idleTimer);
        if (lineBuffer) {
          pending = pending.then(() => handleLine(lineBuffer)).catch(() => {});
        }
        try { await pending; } catch {}
        delete this._channelProcesses[msgChannel];

        if (this._stoppingChannels.has(msgChannel)) {
          resolve({ text: '', error: null });
          return;
        }

        const stdoutText = cleanOutput(stdoutBuf);
        const stderrText = cleanOutput(stderrBuf);
        if (stderrText) this._log(`Aider stderr: ${stderrText.length} chars`);

        if (code !== 0) {
          let diagnostic = classifyError(stderrText, stdoutText);
          if (!diagnostic) {
            const tail = (stderrText || stdoutText).split('\n');
            const detail = tail.length ? tail[tail.length - 1] : '';
            diagnostic = `Aider exited with code ${code}.${detail ? ` ${detail}` : ''}`;
          }
          resolve({ text: '', error: diagnostic });
          return;
        }

        if (!stdoutText) {
          const diagnostic = classifyError(stderrText, stdoutText);
          if (diagnostic) {
            resolve({ text: '', error: diagnostic });
            return;
          }
        }
        resolve({ text: stdoutText, error: null });
      });

      proc.on('error', (err) => {
        if (idleTimer) clearTimeout(idleTimer);
        delete this._channelProcesses[msgChannel];
        reject(err);
      });
    });
  }
}

module.exports = AiderAdapter;
