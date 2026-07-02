/**
 * mini-SWE-agent adapter for OpenAgents workspace.
 *
 * Bridges the mini-swe-agent CLI (https://mini-swe-agent.com) to an OpenAgents
 * workspace as a plain shell-based coding agent. Each workspace message spawns
 * ONE non-interactive `mini` run in the task's workspace directory and exits:
 *
 *   mini [--model <model>] --yolo --exit-immediately \
 *        [--cost-limit <n>] --output <trajectory> --task <prompt>
 *
 * Design notes (verified against the mini CLI docs):
 *  - `mini` defaults to *confirm* mode (interactive) and, when the agent wants
 *    to finish, PROMPTS for the next step instead of exiting. `--yolo` runs LM
 *    commands without confirmation and `--exit-immediately` makes it exit on
 *    finish — BOTH are required for a headless one-shot run, or the daemon would
 *    hang waiting on stdin. stdin is also given /dev/null (stdio 'ignore') so a
 *    stray prompt (e.g. the first-run setup wizard) can never wedge the process.
 *  - mini is a Python process with no JSON event protocol: stdout is drained as
 *    a best-effort progress log (ANSI-stripped, relayed as `thinking`, capped)
 *    and the cleaned transcript tail is sent once as the final answer. The exit
 *    code decides success (non-zero is never reported as success). PYTHONUNBUFFERED
 *    is set so stdout streams instead of being fully buffered; NO_COLOR keeps
 *    rich/ANSI escapes out of the relayed log.
 *  - Each run gets its own --output trajectory file under ~/.openagents/sessions
 *    (never in the project), removed afterwards, so concurrent channel runs never
 *    clash on a shared trajectory.
 *  - Stateless per task: mini keeps no memory across workspace messages (there is
 *    no fabricated persistent session). The agent is auto-authorized to run shell
 *    commands via --yolo — consistent with how Goose (GOOSE_MODE=auto) and Copilot
 *    (--no-ask-user) already auto-execute; there is no shared per-command approval
 *    gate to hook into.
 *  - Config: mini's config is set via the MSWEA_MINI_CONFIG_PATH env var (which
 *    mini reads as its default config file), forwarded through the agent env. We
 *    intentionally do NOT pass --config: a single --config / MSWEA_MINI_CONFIG_PATH
 *    REPLACES mini's built-in mini.yaml (agent prompt templates, step/env config)
 *    rather than merging (verified in mini's run/mini.py), so the launcher field
 *    is documented as a FULL config file, not a partial override.
 *  - Multi-provider auth is left to mini/LiteLLM: the user supplies the model
 *    (MSWEA_MODEL_NAME or the Model field) and provider keys (ANTHROPIC_API_KEY /
 *    OPENAI_API_KEY / …) through the agent environment, which flows through
 *    unchanged. Keys never reach the command line or the logs.
 *
 * Reuses all shared connectivity / dispatch / state machinery in BaseAdapter;
 * only the mini-specific subprocess invocation and parsing live here. Node-only
 * adapter (like Cline / Copilot) — there is no Python mirror.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { whichBinary, getEnhancedEnv, aiderBinDirs } = require('../paths');
const {
  REASON,
  classifySpawnError,
  redactDiagnostic,
  shouldUseShellForBinary,
} = require('./health-status');

const IS_WINDOWS = process.platform === 'win32';
// Terminate if mini produces no output for this long (a wedged turn). Resets on
// any stdout activity, so a slow-but-progressing task is never killed.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
// Cap how many stdout lines are relayed as `thinking` progress, so a task that
// prints large command output (diffs, test logs) can't flood the channel. The
// full transcript is still collected for the final answer.
const MAX_STREAM_UPDATES = 60;
// Cap the size of the final transcript we post back. mini's own closing summary
// is at the END of stdout, so we keep the tail when truncating.
const FINAL_RESPONSE_MAX = 12000;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const BLANKS_RE = /\n{3,}/g;

// Error signatures → an actionable message. mini routes model calls through
// LiteLLM, so the failure surface mirrors Aider's; a couple of mini-specific
// cases (cost limit, no model configured) are added.
const ERROR_SIGNATURES = [
  [['authenticationerror', 'invalid api key', 'incorrect api key', 'no api key',
    'missing these environment variables', 'api key not found', '401',
    'unauthorized', 'permission denied to access model'],
    'Authentication failed — configure a model API key (e.g. ANTHROPIC_API_KEY or '
    + 'OPENAI_API_KEY) for the selected model in the agent environment.'],
  [['notfounderror', 'model_not_found', 'does not exist', 'unknown model',
    'could not find model', 'you do not have access to model'],
    'Model not found or not accessible — check MSWEA_MODEL_NAME / the Model field '
    + 'and that your key has access.'],
  [['you must provide a model', 'no model', 'set up a model', 'model is required',
    'run `mini-extra config setup`', 'run mini-extra config setup'],
    'No model configured — set MSWEA_MODEL_NAME (or the Model field / a --config '
    + 'file), or run `mini-extra config setup`.'],
  [['cost limit', 'costlimit', 'exceeded the cost', 'limitreached', 'limit reached'],
    'Stopped: the configured cost limit (MSWEA_COST_LIMIT) was reached before the '
    + 'task finished.'],
  [['rate limit', 'ratelimiterror', '429', 'quota', 'insufficient_quota'],
    'Rate-limited or out of quota at the model provider — try again later.'],
  [['connectionerror', 'timeout', 'could not connect', 'getaddrinfo',
    'temporary failure in name resolution', 'network is unreachable',
    'failed to establish a new connection'],
    'Network error reaching the model provider — check connectivity and the base URL.'],
];

function miniInstallHint() {
  return 'pip install mini-swe-agent';
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

/**
 * Wrap a workspace message as a self-contained coding task. mini works on the
 * files directly via shell (it does NOT use the OpenAgents MCP tools), so the
 * prompt is a plain instruction — no workspace/MCP context, and deliberately no
 * SWE-bench / patch / benchmark wording.
 */
function buildTaskPrompt(userMessage) {
  return [
    'You are working in the current workspace directory.',
    '',
    'User request:',
    userMessage,
    '',
    'Work directly on the files in the current workspace.',
    'Inspect the codebase before editing.',
    'Run relevant tests or checks where practical.',
    'Do not merely describe a solution: make the changes in the workspace.',
    'When finished, summarize:',
    '- what you changed',
    '- which checks/tests you ran',
    '- any remaining limitations',
  ].join('\n');
}

class MiniSweAgentAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    // channel -> running child process (for stop / cleanup)
    this._channelProcesses = {};
    // channels the user explicitly stopped (suppress "no response" noise)
    this._stoppingChannels = new Set();
    this._trajCounter = 0;

    // Per-run trajectory files live here, never in the project directory.
    this._sessionsDir = path.join(
      os.homedir(), '.openagents', 'sessions', 'mini-swe-agent',
      `${this.workspaceId}_${this.agentName}`,
    );

    this._miniBin = this._findMiniBinary();
    if (this._miniBin) {
      this._log(`Using mini-SWE-agent CLI: ${this._miniBin}`);
    } else {
      this._log(`Warning: mini-SWE-agent CLI not found — install with: ${miniInstallHint()}`);
    }
  }

  // ------------------------------------------------------------------
  // Binary resolution
  // ------------------------------------------------------------------

  _findMiniBinary() {
    // Shared cross-platform resolver runs `which`/`where` against an ENHANCED
    // PATH (nvm/fnm/volta/homebrew + pip/pipx/uv user-install dirs) — covers the
    // GUI/daemon "installed but not on PATH" case for a `pip install`.
    const resolved = whichBinary('mini');
    if (resolved) return this._resolveExePreference(resolved, IS_WINDOWS);

    // Explicit fallback over the pip/pipx/uv user-install bin dirs plus the uv
    // tool venv for mini-swe-agent.
    const names = IS_WINDOWS ? ['mini.exe', 'mini.cmd', 'mini'] : ['mini'];
    const dirs = [...aiderBinDirs()];
    const home = os.homedir();
    if (IS_WINDOWS) {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const uvTools = process.env.UV_TOOL_DIR || path.join(appData, 'uv', 'tools');
      dirs.push(path.join(uvTools, 'mini-swe-agent', 'Scripts'));
    } else {
      const uvTools = process.env.UV_TOOL_DIR
        || path.join(home, '.local', 'share', 'uv', 'tools');
      dirs.push(path.join(uvTools, 'mini-swe-agent', 'bin'));
    }
    for (const dir of dirs) {
      for (const name of names) {
        const c = path.join(dir, name);
        if (fs.existsSync(c)) return c;
      }
    }
    return null;
  }

  /**
   * On Windows, prefer a directly-executable `mini.exe` over a `mini.cmd`/`.bat`
   * shim that would otherwise have to be launched through a shell. pip/pipx/uv
   * install a console-script `.exe` wrapper, so this normally resolves to the
   * exe; if the resolver landed on a .cmd/.bat and a sibling .exe exists, use the
   * .exe. No-op off Windows. (A .cmd shim still runs correctly via
   * shouldUseShellForBinary — this just avoids the shell hop.)
   */
  _resolveExePreference(binPath, isWindows) {
    if (!isWindows || !/\.(cmd|bat)$/i.test(String(binPath))) return binPath;
    const exe = path.join(path.dirname(binPath), 'mini.exe');
    return fs.existsSync(exe) ? exe : binPath;
  }

  /**
   * Preflight gate (run by the daemon before join). mini needs a resolvable CLI
   * to do anything useful; when none is found we surface 'runtime_missing' and
   * skip the join. We deliberately do NOT block on a missing model here — mini
   * can read a model from a global config we can't see, and a stray prompt is
   * already made safe by the /dev/null stdin. A genuinely unconfigured model
   * surfaces as a crisp error on the first run instead.
   */
  preflight() {
    if (!this._miniBin) this._miniBin = this._findMiniBinary();
    if (!this._miniBin) {
      return {
        ok: false,
        reason: REASON.RUNTIME_MISSING,
        message: `mini-SWE-agent CLI not found — install with: ${miniInstallHint()}`,
      };
    }
    this._log(`mini-SWE-agent CLI resolved: ${this._miniBin}`);
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Config + command construction
  // ------------------------------------------------------------------

  _model() {
    return String(
      this.agentEnv.MSWEA_MODEL_NAME || this.agentEnv.MSWEA_MODEL
      || this.agentEnv.LLM_MODEL || '',
    ).trim();
  }

  _costLimit() {
    const raw = String(this.agentEnv.MSWEA_COST_LIMIT || '').trim();
    if (!raw) return null;
    return /^\d+(\.\d+)?$/.test(raw) ? raw : null;
  }

  /**
   * Build the mini argv. Order is stable: [--model], --yolo, --exit-immediately,
   * [--cost-limit], [--output], --task <prompt>. The task is always the LAST
   * argument and is passed as a single argv element (never string-concatenated),
   * so quotes / spaces / newlines / shell metacharacters in the prompt are
   * carried verbatim with no shell involvement. Config is NOT a flag here — it
   * flows via the MSWEA_MINI_CONFIG_PATH env var (see the file header).
   */
  _buildMiniArgs({ model, costLimit, trajectoryPath, task }) {
    const args = [];
    if (model) args.push('--model', model);
    args.push('--yolo', '--exit-immediately');
    if (costLimit) args.push('--cost-limit', String(costLimit));
    if (trajectoryPath) args.push('--output', trajectoryPath);
    args.push('--task', task);
    return args;
  }

  _buildSubprocessEnv() {
    const base = getEnhancedEnv(this.agentEnv);
    if (base.NO_COLOR === undefined) base.NO_COLOR = '1';
    // mini is a Python process — force line-buffered stdout so progress streams
    // instead of arriving all at once at exit.
    base.PYTHONUNBUFFERED = '1';
    // Skip mini's interactive first-run setup wizard. mini runs it whenever
    // MSWEA_CONFIGURED is unset (see run/utilities/config.configure_if_first_time),
    // which — under our /dev/null stdin — aborts with a useless "Aborted." even
    // when the user HAS configured a model + key via the agent environment. In a
    // daemon the wizard is never appropriate; the model/keys come from the env.
    if (base.MSWEA_CONFIGURED === undefined) base.MSWEA_CONFIGURED = 'true';
    return base;
  }

  // ------------------------------------------------------------------
  // Control actions (stop)
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
    await super._onControlAction(action, payload);
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 }); } catch {}
        return;
      }
      // POSIX: kill the whole process group (proc was detached) so the shell
      // commands mini spawned under --yolo are reaped too — not left orphaned.
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

  /** True when an error is a child_process spawn failure (vs. a runtime error). */
  _isSpawnError(e) {
    if (!e) return false;
    const code = e.code || e.errno;
    return (
      e.syscall === 'spawn'
      || String(e.syscall || '').startsWith('spawn ')
      || code === 'ENOENT'
      || code === 'EACCES'
      || code === 'EPERM'
    );
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

    if (!this._miniBin) this._miniBin = this._findMiniBinary();
    if (!this._miniBin) {
      const message = `mini-SWE-agent CLI not found — install with: ${miniInstallHint()}`;
      this._reportStatus(REASON.RUNTIME_MISSING, message);
      await this.sendError(msgChannel, message);
      return;
    }

    await this._autoTitleChannel(msgChannel, content);
    this._stoppingChannels.delete(msgChannel);
    await this.sendStatus(msgChannel, 'mini-SWE-agent is working...');

    let result;
    try {
      result = await this._runMini(content, msgChannel);
    } catch (e) {
      // A failure to LAUNCH the process (ENOENT/EACCES) is a distinct, actionable
      // failure — surface it as spawn_failed with the resolved path + code.
      if (this._isSpawnError(e)) {
        const { reason, message } = classifySpawnError(e, {
          label: 'mini-SWE-agent',
          bin: this._miniBin,
        });
        this._log(message);
        this._reportStatus(reason, message);
        await this.sendError(msgChannel, message);
      } else {
        this._log(`Error handling message: ${redactDiagnostic(e.message)}`);
        await this.sendError(
          msgChannel,
          `Error processing message: ${redactDiagnostic(e.message)}`,
        );
      }
      return;
    }

    if (this._stoppingChannels.has(msgChannel)) {
      this._stoppingChannels.delete(msgChannel);
      return;
    }
    const { text, error } = result;
    if (error) {
      await this.sendError(msgChannel, error);
      return;
    }
    // A successful run proves the runtime is healthy — clear any prior error.
    this._reportStatus(null);
    if (text) {
      await this.sendResponse(msgChannel, text);
    } else {
      await this.sendResponse(
        msgChannel,
        'mini-SWE-agent finished with no textual output (any file changes were applied '
        + 'to the workspace directory).',
      );
    }
  }

  // ------------------------------------------------------------------
  // Subprocess execution
  // ------------------------------------------------------------------

  async _runMini(content, msgChannel) {
    fs.mkdirSync(this._sessionsDir, { recursive: true });
    this._trajCounter += 1;
    // Per-run trajectory file — isolates concurrent channel runs from a shared
    // default trajectory. Removed after the run (we rely on stdout, not the
    // trajectory, for the result).
    const trajectoryPath = path.join(
      this._sessionsDir, `traj-${process.pid}-${this._trajCounter}.json`,
    );
    const cmd = [
      this._miniBin,
      ...this._buildMiniArgs({
        model: this._model(),
        costLimit: this._costLimit(),
        trajectoryPath,
        task: buildTaskPrompt(content),
      }),
    ];
    let result;
    try {
      result = await this._spawnMini(cmd, msgChannel);
    } catch (e) {
      // Keep the trajectory on a launch failure — it is most useful exactly when
      // something went wrong.
      this._log(`mini-SWE-agent trajectory kept for debugging: ${trajectoryPath}`);
      throw e;
    }
    // Retain the trajectory on failure / timeout / cancel (when it matters for
    // debugging); only clean it up on a clean success. Timeout and cancel both
    // surface here as result.error and/or a stopping channel.
    const kept = !!result.error || this._stoppingChannels.has(msgChannel);
    if (kept) {
      this._log(`mini-SWE-agent trajectory kept for debugging: ${trajectoryPath}`);
    } else {
      try { fs.rmSync(trajectoryPath, { force: true }); } catch {}
    }
    return result;
  }

  _spawnMini(cmd, msgChannel) {
    return new Promise((resolve, reject) => {
      const env = this._buildSubprocessEnv();

      const proc = spawn(cmd[0], cmd.slice(1), {
        // stdin is /dev/null: mini never has a terminal to prompt against, so a
        // stray confirm / first-run wizard hits EOF and exits instead of hanging.
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        cwd: this.workingDir,
        detached: !IS_WINDOWS,
        windowsHide: true,
        // Args are always an array (no shell string); the shared helper only
        // opts into a shell for Windows .cmd/.bat shims so the daemon, adapter
        // and launcher probe all agree on the rule.
        shell: shouldUseShellForBinary(cmd[0]),
      });
      this._channelProcesses[msgChannel] = proc;
      // Log the flags only — never the task text or any secret. The task is the
      // last argv element; everything before it is safe to log.
      this._log(`Running mini-SWE-agent: ${cmd.slice(0, cmd.indexOf('--task') + 1).map(String).join(' ')} <task>`);

      // Guard the child's stdio streams against a benign post-SIGKILL 'error'
      // (EPIPE/ECONNRESET) that would otherwise crash the process.
      if (proc.stdout) proc.stdout.on('error', () => {});
      if (proc.stderr) proc.stderr.on('error', () => {});

      let stdoutBuf = '';
      let stderrBuf = '';
      let lineBuffer = '';
      let streamCount = 0;
      let pending = Promise.resolve();

      let idleTimer = null;
      const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          this._log(`mini-SWE-agent produced no output for ${IDLE_TIMEOUT_MS / 1000}s — terminating`);
          this._stopProcess(proc);
        }, IDLE_TIMEOUT_MS);
      };
      armIdle();

      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString('utf-8'); });
      }

      const handleLine = async (raw) => {
        const stripped = raw.replace(ANSI_RE, '').trim();
        if (!stripped) return;
        if (streamCount < MAX_STREAM_UPDATES) {
          streamCount += 1;
          try { await this.sendThinking(msgChannel, stripped.slice(0, 500)); } catch {}
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

        // User asked to stop — swallow output, emit no final answer here (the
        // stop handler already sent the "stopped" status).
        if (this._stoppingChannels.has(msgChannel)) {
          resolve({ text: '', error: null });
          return;
        }

        const stdoutText = cleanOutput(stdoutBuf);
        const stderrText = cleanOutput(stderrBuf);
        if (stderrText) this._log(`mini-SWE-agent stderr: ${stderrText.length} chars`);

        if (code !== 0) {
          let diagnostic = classifyError(stderrText, stdoutText);
          if (!diagnostic) {
            const tail = (stderrText || stdoutText).split('\n').filter(Boolean);
            const detail = tail.length ? tail[tail.length - 1] : '';
            diagnostic = `mini-SWE-agent exited with code ${code}.${detail ? ` ${redactDiagnostic(detail)}` : ''}`;
          }
          resolve({ text: '', error: diagnostic });
          return;
        }

        // Exit 0: surface the cleaned transcript (tail-capped — mini's closing
        // summary is at the end). Success ≠ "task definitely fixed", just that
        // mini ran to completion.
        let text = stdoutText;
        if (text.length > FINAL_RESPONSE_MAX) {
          text = `…(earlier output truncated)…\n\n${text.slice(-FINAL_RESPONSE_MAX)}`;
        }
        resolve({ text, error: null });
      });

      proc.on('error', (err) => {
        if (idleTimer) clearTimeout(idleTimer);
        delete this._channelProcesses[msgChannel];
        reject(err);
      });
    });
  }
}

module.exports = MiniSweAgentAdapter;
