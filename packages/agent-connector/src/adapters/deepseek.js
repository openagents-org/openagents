/**
 * DeepSeek Harness adapter for OpenAgents workspace.
 *
 * Bridges DeepSeek's open-source agent harness (https://github.com/deepseek-ai/
 * deepseek-harness, npm `@deepseek-ai/dsh`) by driving its headless profile:
 *
 *   dsh --profile headless --patch <private.yml> "<constant instruction>"
 *
 * Like every other agent here it drives its own CLI subprocess; no SDK is
 * introduced. Mirrors mini.js's one-process-per-message control flow and
 * aider.js's plain-text result handling.
 *
 * Four things are unlike the other adapters, and each has a reason:
 *
 *  1. THE PROMPT IS NEVER IN argv. dsh takes its task as a positional argument
 *     and has no stdin task channel, so putting the workspace prompt there
 *     would publish the workspace token to /proc/<pid>/cmdline and `ps`. The
 *     prompt is written to a private task file and argv carries only a constant
 *     sentence naming it (deepseek-runtime's HEADLESS_TASK_INSTRUCTION). If the
 *     task file cannot be written the run FAILS — it never falls back to argv,
 *     because a fallback would reintroduce exactly the exposure the design
 *     exists to prevent.
 *
 *  2. NO SESSION RESUME. headless creates one fresh persisted session per run
 *     and upstream documents "one submitted task only". Continuity therefore
 *     comes from a bounded workspace recap injected into the task file, not
 *     from anything dsh remembers. That also means the sessions directory grows
 *     once per message, so this adapter garbage-collects it.
 *
 *  3. NO STREAMING. headless prints the last assistant message at the end and
 *     nothing before it. A conventional idle timeout would therefore kill every
 *     healthy long task; the guard here is a TOTAL run timeout instead. For the
 *     same reason the child is awaited on 'close' rather than 'exit': the whole
 *     answer is stdout, and 'exit' can fire with the tail unflushed.
 *
 *  4. NON-INTERACTIVE APPROVAL WITHOUT UNSANDBOXING. dsh's composition sets
 *     approval `ask` everywhere except `danger-full-access`, and a headless run
 *     has no client to answer. The private patch sets approval `never` while
 *     leaving the sandbox at workspace-write, so tool use is non-interactive
 *     but writes stay confined. Reaching the same place via
 *     DSH_PERMISSION_MODE=danger-full-access would also remove the sandbox,
 *     which is why that value is never used to solve this.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, execSync } = require('child_process');

const BaseAdapter = require('./base');
const { whichBinary, getEnhancedEnv } = require('../paths');
const { formatAttachmentsForPrompt } = require('./utils');
const { buildDeepSeekTaskFile } = require('./workspace-prompt');
const { sampleRecap } = require('./decision-log');
const {
  REASON,
  classifySpawnError,
  redactDiagnostic,
} = require('./health-status');
const {
  SUPPORTED_DSH_VERSION,
  dshEntryCandidates,
  buildHeadlessArgs,
  buildDumpConfigArgs,
  buildPrivatePatch,
  classifyDshFailure,
  classifyDshVersion,
  classifyNodeVersion,
  cleanStdout,
  defaultInstallCommand,
  nodeRequirementText,
  resolvePermissionMode,
  safeDshHomeName,
  selectSessionsForGc,
  MAX_STDOUT_BYTES,
  MAX_STDERR_BYTES,
} = require('./deepseek-runtime');

const IS_WINDOWS = process.platform === 'win32';

/**
 * TOTAL wall-clock budget for one run — NOT an idle timeout.
 *
 * dsh emits nothing on stdout until the task finishes, so the "no output for N
 * minutes" guard every other adapter uses would terminate perfectly healthy
 * long tasks. 60 minutes matches pi.js's long-task scale.
 */
const RUN_TIMEOUT_MS = 60 * 60 * 1000;

/** Grace period between SIGTERM and SIGKILL when stopping a run. */
const STOP_GRACE_MS = 5000;

/**
 * Budget for composing the headless profile.
 *
 * `--dump-config` calls no model and does no work beyond reading and merging
 * the profile's own files, so it is fast or it is broken. The generous ceiling
 * covers a cold first run that still has to materialise the profile from the
 * shipped templates.
 */
const BOOTSTRAP_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * The key bootstrap's child is tracked under in `_channelProcesses`.
 *
 * The NUL prefix makes it unrepresentable as a real channel name, so a user
 * `/stop` can reach the bootstrap process through the same registry the
 * per-channel runs use, with no chance of colliding with one of them.
 */
const BOOTSTRAP_KEY = '\u0000bootstrap';

/** How many messages of channel history to pull for the recap. */
const RECAP_HEAD = 30;
const RECAP_TAIL = 60;

/** The environment variable the task file tells the agent to read. */
const TOKEN_ENV = 'OPENAGENTS_WORKSPACE_TOKEN';

function dshInstallHint() {
  return defaultInstallCommand(SUPPORTED_DSH_VERSION);
}

class DeepSeekAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();

    // channel -> running child process (for stop / cleanup)
    this._channelProcesses = {};
    // channels the user explicitly stopped (suppress "no response" noise)
    this._stoppingChannels = new Set();

    // Channels currently inside _handleMessage, whether or not a child exists
    // yet. A run spends real time before it spawns anything — bootstrap, the
    // status post, the recap fetch, the browser-setting lookup — and a `/stop`
    // arriving in that window has no process to kill. Without this set the stop
    // would be silently dropped and the task would start anyway.
    this._busyChannels = new Set();
    // Channels cancelled while busy. Checked at every await boundary and once
    // more immediately before spawning.
    this._cancelledChannels = new Set();
    // Children a kill did NOT demonstrably end. They are no longer attached to
    // a channel, but they may still be alive, so they stay reachable for a
    // retry and keep the session GC from running under a live process.
    this._survivorProcesses = new Set();
    this._taskCounter = 0;
    this._bootstrapPromise = null;
    // Overridable so the timeout paths are testable without 60-minute and
    // 3-minute waits.
    this._runTimeoutMs = opts.runTimeoutMs || RUN_TIMEOUT_MS;
    this._bootstrapTimeoutMs = opts.bootstrapTimeoutMs || BOOTSTRAP_TIMEOUT_MS;

    // A PRIVATE harness home per agent instance. The user's own ~/.dsh is never
    // read or written: sharing it would leak their profiles, patches and saved
    // credentials into an agent, and would make two OpenAgents agents share
    // sessions and settings. The name carries a hash so two agents whose ids
    // slug identically still get separate homes.
    this._dshHome = path.join(
      os.homedir(), '.openagents', 'dsh-homes',
      safeDshHomeName(this.workspaceId, this.agentName),
    );
    this._patchFile = path.join(this._dshHome, 'openagents.patch.yml');
    this._tasksDir = path.join(this._dshHome, 'tasks');

    const resolved = this._resolveDshCommand();
    this._nodeBin = resolved ? resolved[0] : null;
    this._jsEntry = resolved ? resolved[1] : null;
    if (this._jsEntry) {
      this._log(`Using DeepSeek Harness: ${this._jsEntry} (node: ${this._nodeBin})`);
    } else {
      this._log(`Warning: DeepSeek Harness not found — install with: ${dshInstallHint()}`);
    }
  }

  // ------------------------------------------------------------------
  // Binary resolution
  // ------------------------------------------------------------------

  /**
   * The portable Node the launcher installs, else the Node running this daemon.
   * Bare 'node' is never used: a packaged daemon's PATH may not have one.
   */
  _findNodeBin() {
    const home = os.homedir();
    const candidates = IS_WINDOWS
      ? [path.join(home, '.openagents', 'nodejs', 'node.exe')]
      : [path.join(home, '.openagents', 'nodejs', 'node'),
        path.join(home, '.openagents', 'nodejs', 'bin', 'node')];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return process.execPath;
  }

  /**
   * Resolve the `dsh` shim to [nodeBin, jsEntry] so the ESM entry point runs
   * under a Node we control and whose version we have gated.
   *
   * dsh is `"type": "module"` with bin `lib/bin.js`. Running the shim instead
   * would (a) use whatever Node is first on PATH, which may be a version dsh
   * cannot run on, and (b) on Windows wrap a `.cmd` in cmd.exe. Returns null
   * when nothing resolves.
   */
  _resolveDshCommand() {
    const bin = whichBinary('dsh');
    if (!bin) return null;
    const nodeBin = this._findNodeBin();

    // A resolved path that is already the JS entry point (or a symlink to it).
    try {
      let target = bin;
      if (!IS_WINDOWS && fs.lstatSync(bin).isSymbolicLink()) {
        target = path.resolve(path.dirname(bin), fs.readlinkSync(bin));
      }
      if (/\.(js|mjs)$/i.test(target) && fs.existsSync(target)) return [nodeBin, target];
    } catch { /* fall through to the package lookup */ }

    // Otherwise locate lib/bin.js inside the installed package. The candidate
    // layouts are a pure function so every install shape is unit-testable
    // without a filesystem — see dshEntryCandidates.
    const guesses = dshEntryCandidates(bin);
    for (const g of guesses) if (fs.existsSync(g)) return [nodeBin, g];
    return null;
  }

  /** `dsh -V` output, or null. Synchronous: preflight() is a sync contract. */
  _readDshVersion() {
    if (!this._jsEntry) return null;
    try {
      return execFileSync(this._nodeBin, [this._jsEntry, '-V'], {
        encoding: 'utf-8',
        timeout: 15000,
        env: getEnhancedEnv(this.agentEnv),
      }).trim();
    } catch {
      return null;
    }
  }

  /** `node --version` for the Node we will actually launch dsh with. */
  _readNodeVersion() {
    if (this._nodeBin === process.execPath) return process.version;
    try {
      return execFileSync(this._nodeBin, ['--version'], {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Preflight (run by the daemon BEFORE joining the workspace)
  // ------------------------------------------------------------------

  /**
   * Gate everything that can be known without starting a task. The daemon skips
   * the workspace join when this fails, so an unusable runtime never spins a
   * poll loop it can do nothing with.
   *
   * Deliberately ordered cheapest-first: a missing binary makes the version
   * probes meaningless, and both version probes must pass before bootstrap is
   * ever allowed to start a dsh process.
   */
  preflight() {
    if (!this._jsEntry) {
      const resolved = this._resolveDshCommand();
      if (resolved) { this._nodeBin = resolved[0]; this._jsEntry = resolved[1]; }
    }
    if (!this._jsEntry) {
      return {
        ok: false,
        reason: REASON.RUNTIME_MISSING,
        message: `DeepSeek Harness (dsh) not found — install with: ${dshInstallHint()}`,
      };
    }

    const node = classifyNodeVersion(this._readNodeVersion());
    if (node.supported === false) {
      return {
        ok: false,
        reason: REASON.VERSION_INCOMPATIBLE,
        message:
          `DeepSeek Harness cannot run on Node ${node.version} — it requires `
          + `${nodeRequirementText()}.`,
      };
    }

    const entry = this._registryEntry();
    const supported = (entry && entry.install && entry.install.supported_version)
      || SUPPORTED_DSH_VERSION;
    const installCmd = (entry && entry.install && entry.install[this._platformKey()])
      || defaultInstallCommand(supported);
    const gate = classifyDshVersion(this._readDshVersion(), supported, installCmd);
    if (gate.compatible === false || gate.compatible === null) {
      return { ok: false, reason: REASON.VERSION_INCOMPATIBLE, message: gate.message };
    }

    if (!this._apiKey()) {
      return {
        ok: false,
        reason: REASON.LOGIN_REQUIRED,
        message:
          'DeepSeek Harness is not configured — set DEEPSEEK_API_KEY. The agent '
          + 'runs with a private, empty harness home, so there is no saved dsh '
          + 'login to fall back on.',
      };
    }

    this._log(`DeepSeek Harness ${gate.detected} resolved (node ${node.version})`);
    return { ok: true };
  }

  _platformKey() {
    if (IS_WINDOWS) return 'windows';
    return process.platform === 'darwin' ? 'macos' : 'linux';
  }

  /** The bundled registry entry for this agent type, or null. */
  _registryEntry() {
    try {
      // eslint-disable-next-line global-require
      const entries = require('../../registry.json');
      return entries.find((e) => e && e.name === 'deepseek') || null;
    } catch {
      return null;
    }
  }

  _apiKey() {
    return String(this.agentEnv.DEEPSEEK_API_KEY || this.agentEnv.LLM_API_KEY || '').trim();
  }

  _baseUrl() {
    return String(this.agentEnv.DEEPSEEK_BASE_URL || this.agentEnv.LLM_BASE_URL || '').trim();
  }

  _model() {
    return String(this.agentEnv.DEEPSEEK_MODEL || this.agentEnv.LLM_MODEL || '').trim();
  }

  // ------------------------------------------------------------------
  // Bootstrap + private patch
  // ------------------------------------------------------------------

  /**
   * Compose the headless profile once, before any channel runs a task.
   *
   * A fresh DSH_HOME auto-initialises its headless profile from bundled
   * templates on first use. BaseAdapter dispatches channels concurrently, so
   * without this several dsh processes would race to initialise the same
   * profile directory. `--dump-config` composes and prints the tree without
   * booting it: no model call, no API key needed, no task run.
   *
   * The promise is CLEARED on failure. Caching a rejection would make one bad
   * first run permanent for the lifetime of the daemon process.
   */
  _ensureBootstrap() {
    if (!this._bootstrapPromise) {
      this._bootstrapPromise = this._bootstrap().catch((e) => {
        this._bootstrapPromise = null;
        throw e;
      });
    }
    return this._bootstrapPromise;
  }

  async _bootstrap() {
    fs.mkdirSync(this._dshHome, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this._tasksDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this._dshHome, 0o700); } catch { /* best effort (Windows) */ }
    this._writePrivatePatch();

    const args = buildDumpConfigArgs({ jsEntry: this._jsEntry, patchFile: this._patchFile });
    await new Promise((resolve, reject) => {
      const proc = spawn(this._nodeBin, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: this._buildSubprocessEnv('workspace-write'),
        cwd: this.workingDir,
        detached: !IS_WINDOWS,
        windowsHide: true,
      });
      // Bootstrap runs BEFORE any per-run timeout exists and every waiting
      // channel is blocked on it, so a wedged `--dump-config` would hang the
      // whole agent with nothing able to interrupt it. Tracking it under a
      // reserved key makes it reachable from /stop; the timeout is the backstop
      // for a user who never presses it.
      this._channelProcesses[BOOTSTRAP_KEY] = proc;

      let err = '';
      let settled = false;
      let bootTimedOut = false;
      const bootTimeoutError = () => new Error(
        `dsh profile bootstrap timed out after ${this._bootstrapTimeoutMs / 1000}s. `
        + 'The harness composes its profile without calling a model, so this '
        + 'usually means the install is incomplete — reinstall with: '
        + dshInstallHint(),
      );
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        delete this._channelProcesses[BOOTSTRAP_KEY];
        fn(value);
      };
      const timer = setTimeout(async () => {
        // Mark BEFORE killing: the kill produces a `close` with a null exit
        // code, and without this flag that generic "exit null" would win the
        // race and hide the actual reason from the user.
        bootTimedOut = true;
        this._log(`DeepSeek Harness profile bootstrap exceeded ${this._bootstrapTimeoutMs / 1000}s — terminating`);
        await this._stopProcess(proc).catch(() => {});
        finish(reject, bootTimeoutError());
      }, this._bootstrapTimeoutMs);

      proc.stderr.on('data', (d) => {
        if (err.length < MAX_STDERR_BYTES) err += d.toString();
      });
      proc.stderr.on('error', () => {});
      proc.on('error', (e) => finish(reject, bootTimedOut ? bootTimeoutError() : e));
      proc.on('close', (code) => {
        if (bootTimedOut) return finish(reject, bootTimeoutError());
        if (code === 0) return finish(resolve, undefined);
        finish(reject, new Error(
          `dsh profile bootstrap failed (exit ${code}): ${redactDiagnostic(err)}`,
        ));
      });
    });
    this._log(`DeepSeek Harness profile ready in ${this._dshHome}`);
  }

  /**
   * (Re)write the private `--patch` overlay.
   *
   * Rewritten on every run so a changed model setting takes effect without the
   * user having to recreate the agent, and written atomically so a run that
   * starts mid-write can never read a half-file.
   */
  _writePrivatePatch() {
    const { text } = buildPrivatePatch({ model: this._model() });
    const tmp = `${this._patchFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, this._patchFile);
  }

  // ------------------------------------------------------------------
  // Subprocess environment
  // ------------------------------------------------------------------

  /**
   * The child environment is the ONLY channel for secrets: nothing below ever
   * reaches argv, the task file or a log.
   *
   * Note that the daemon merges process.env into the agent environment, so this
   * is "the effective child environment is authoritative", not "the Launcher is
   * the only possible source". What matters for isolation is DSH_HOME: the
   * agent never reads the user's shared harness credentials.
   */
  _buildSubprocessEnv(permissionMode) {
    const env = getEnhancedEnv(this.agentEnv);
    if (env.NO_COLOR === undefined) env.NO_COLOR = '1';

    env.DSH_HOME = this._dshHome;
    env.DSH_PERMISSION_MODE = permissionMode;
    // Telemetry uploads mirror session-log records with no redaction rule, so it
    // is off unconditionally. dsh treats ANY non-empty value as opt-out.
    env.DSH_TELEMETRY_DISABLED = '1';

    const key = this._apiKey();
    if (key) env.DEEPSEEK_API_KEY = key;
    const base = this._baseUrl();
    if (base) env.DEEPSEEK_BASE_URL = base;

    // The task file references this by NAME; the value never appears in it.
    env[TOKEN_ENV] = this.token;
    return env;
  }

  /** The shell expression the task file uses to reference the token. */
  _tokenExpr() {
    return IS_WINDOWS ? `$env:${TOKEN_ENV}` : `$${TOKEN_ENV}`;
  }

  // ------------------------------------------------------------------
  // Control actions (stop)
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      // Mark FIRST, kill second. A channel that is busy but has not spawned yet
      // has nothing to kill, and marking is the only thing that stops it: the
      // handler re-checks this set at every await boundary and again just
      // before spawning.
      for (const channel of this._busyChannels) {
        this._cancelledChannels.add(channel);
        this._stoppingChannels.add(channel);
      }

      for (const [channel, proc] of Object.entries(this._channelProcesses)) {
        // The bootstrap child is tracked here so it can be interrupted, but it
        // belongs to no channel — there is nowhere to post a status to, and
        // marking " bootstrap" as stopping would leak a fake channel name into
        // the suppression set.
        if (channel === BOOTSTRAP_KEY) {
          await this._stopProcess(proc);
          delete this._channelProcesses[channel];
          continue;
        }
        this._stoppingChannels.add(channel);
        const ended = await this._stopProcess(proc);
        delete this._channelProcesses[channel];
        // A kill that could not be shown to have worked keeps the child
        // reachable rather than forgotten — see _survivorProcesses.
        if (!ended) this._survivorProcesses.add(proc);
        try { await this.sendStatus(channel, 'Execution stopped by user'); } catch {}
      }

      // Retry anything an earlier stop or timeout failed to end.
      for (const proc of [...this._survivorProcesses]) {
        if (await this._stopProcess(proc)) this._survivorProcesses.delete(proc);
      }
      return;
    }
    await super._onControlAction(action, payload);
  }

  /**
   * Terminate a child and report whether it is demonstrably gone.
   *
   * The return value is the point: a caller that untracks a process it only
   * *asked* to die loses the handle needed to try again, and tells the session
   * GC the coast is clear while the child may still be writing. `true` means an
   * exit was observed (or the child had already exited); `false` means the kill
   * was best-effort and unconfirmed.
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return true;
    try {
      if (IS_WINDOWS) {
        try {
          execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000 });
          return true;
        } catch { return false; }
      }
      // POSIX: kill the whole process group (the child is detached) so the
      // shell commands dsh spawned for its bash tool are reaped too.
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
          // SIGKILL was sent but no exit has been seen yet. Give the kernel a
          // moment, then report honestly rather than assuming.
          setTimeout(() => resolve(proc.exitCode !== null || proc.signalCode !== null), 250);
        }, STOP_GRACE_MS);
        proc.on('exit', () => { clearTimeout(timer); resolve(true); });
      });
    } catch {
      return false;
    }
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
  // Channel recap
  // ------------------------------------------------------------------

  /**
   * Bounded channel history for the task file.
   *
   * Two queries, matching claude.js: an ascending window (the opening messages
   * — what the channel is *for*) and a descending one (the most recent
   * messages — what just happened).
   *
   * BOTH arrive in chronological order. `getRecentMessages` reverses a `desc`
   * window itself so every caller gets the same ordering, so reversing the tail
   * again here would hand `sampleRecap` a newest-first list, and its
   * `tail.slice(-tailKeep)` would then keep the OLDEST entries and discard the
   * newest context — the exact opposite of the intent.
   *
   * The current message is excluded BY ID. `sampleRecap`'s own guard compares
   * message TEXT, which silently drops an older message that happens to repeat
   * the current one verbatim — common for short instructions like "continue".
   * Filtering by id first makes that impossible; the text guard stays as a
   * fallback for events that carry no id.
   */
  async _buildRecap(channel, msg) {
    try {
      const [head, tail] = await Promise.all([
        this.client.getRecentMessages(this.workspaceId, channel, this.token, RECAP_HEAD, { sort: 'asc' }),
        this.client.getRecentMessages(this.workspaceId, channel, this.token, RECAP_TAIL),
      ]);
      const currentId = msg && (msg.messageId || msg.eventId);
      const drop = (list) => (list || []).filter(
        (m) => !(currentId && (m.messageId === currentId || m.eventId === currentId)),
      );
      // Both windows are already chronological — see the note above.
      const tailAsc = drop(tail);
      // When the current event carries an id it has already been removed above,
      // and passing its TEXT as well would make sampleRecap drop any older
      // message that happens to repeat it verbatim. The text guard is only a
      // fallback for events with no id.
      // sampleRecap returns an ARRAY of formatted lines.
      const lines = sampleRecap(
        drop(head), tailAsc, currentId ? '' : ((msg && msg.content) || ''),
      );
      return (lines || []).join('\n');
    } catch (e) {
      this._log(`Could not build channel recap: ${redactDiagnostic(e && e.message)}`);
      return '';
    }
  }

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------

  /**
   * True when the user stopped this channel since the handler started.
   *
   * Called after every await in the pre-spawn window. Each of those awaits —
   * bootstrap, the status post, the recap fetch, the browser lookup — can take
   * long enough for a `/stop` to land, and before this existed the stop was
   * dropped and the task ran to completion anyway.
   */
  _cancelled(channel) {
    return this._cancelledChannels.has(channel);
  }

  async _handleMessage(msg) {
    const content = (msg.content || '').trim();
    const attachments = msg.attachments || [];
    if (!content && attachments.length === 0) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${msgChannel}: ${content.length} chars`);

    // A stop belongs to the run that was in flight when it was pressed, so the
    // flag is cleared here — before the first await — and never again.
    this._cancelledChannels.delete(msgChannel);
    this._busyChannels.add(msgChannel);
    try {
      await this._handleMessageInner(msg, msgChannel, content, attachments);
    } finally {
      this._busyChannels.delete(msgChannel);
    }
  }

  async _handleMessageInner(msg, msgChannel, content, attachments) {

    if (!this._jsEntry) {
      const resolved = this._resolveDshCommand();
      if (resolved) { this._nodeBin = resolved[0]; this._jsEntry = resolved[1]; }
    }
    if (!this._jsEntry) {
      const message = `DeepSeek Harness (dsh) not found — install with: ${dshInstallHint()}`;
      this._reportStatus(REASON.RUNTIME_MISSING, message);
      await this.sendError(msgChannel, message);
      return;
    }

    await this._autoTitleChannel(msgChannel, content);
    this._stoppingChannels.delete(msgChannel);
    if (this._cancelled(msgChannel)) return;

    try {
      await this._ensureBootstrap();
    } catch (e) {
      if (this._cancelled(msgChannel)) return;
      const message = `DeepSeek Harness could not initialise its profile: ${redactDiagnostic(e && e.message)}`;
      this._reportStatus(REASON.SPAWN_FAILED, message);
      await this.sendError(msgChannel, message);
      return;
    }
    // Bootstrap is the longest pre-spawn wait — a cold first run composes the
    // whole profile — so it is the likeliest place for a stop to land.
    if (this._cancelled(msgChannel)) return;

    // No streaming: this is the only progress the workspace will see until the
    // run finishes.
    await this.sendStatus(msgChannel, 'DeepSeek Harness is working...');
    if (this._cancelled(msgChannel)) return;

    let result;
    try {
      result = await this._runDsh({ content, attachments, msgChannel, msg });
    } catch (e) {
      if (this._isSpawnError(e)) {
        const { reason, message } = classifySpawnError(e, {
          label: 'DeepSeek Harness',
          bin: this._jsEntry,
        });
        this._log(message);
        this._reportStatus(reason, message);
        await this.sendError(msgChannel, message);
      } else {
        const message = `Error processing message: ${redactDiagnostic(e && e.message)}`;
        this._log(message);
        await this.sendError(msgChannel, message);
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
    this._reportStatus(null);
    if (text) {
      await this.sendResponse(msgChannel, text);
    } else {
      await this.sendResponse(
        msgChannel,
        'DeepSeek Harness finished with no textual output (any file changes were '
        + 'applied to the workspace directory).',
      );
    }
  }

  // ------------------------------------------------------------------
  // Subprocess execution
  // ------------------------------------------------------------------

  async _runDsh({ content, attachments, msgChannel, msg }) {
    const permissionMode = resolvePermissionMode({
      workspaceMode: this._mode,
      configured: this.agentEnv.DSH_PERMISSION_MODE,
    });
    if (this.agentEnv.DSH_PERMISSION_MODE
        && permissionMode !== this.agentEnv.DSH_PERMISSION_MODE
        && this._mode !== 'plan') {
      // A typo in a permission setting must not silently downgrade to a
      // default: the user asked for a specific boundary.
      return {
        text: '',
        error:
          `Invalid DSH_PERMISSION_MODE "${this.agentEnv.DSH_PERMISSION_MODE}". `
          + 'Valid values are read-only, workspace-write, danger-full-access.',
      };
    }

    // Keep the patch current (model changes) before every run. A failure here
    // is reported as what it is: an ENOENT from this write would otherwise
    // reach the caller's spawn-error classifier and be announced as
    // "executable not found", sending the user after a binary that is present.
    try {
      this._writePrivatePatch();
    } catch (e) {
      return {
        text: '',
        error:
          'DeepSeek Harness could not write its private configuration '
          + `(${redactDiagnostic(e && e.message)}). The harness home is `
          + `${this._dshHome}.`,
      };
    }

    const recap = await this._buildRecap(msgChannel, msg);
    if (this._cancelled(msgChannel)) return { text: '', error: null };

    const attachmentText = formatAttachmentsForPrompt(
      attachments, 'skills', IS_WINDOWS,
      { tokenExpr: this._tokenExpr(), endpoint: this.endpoint },
    ) || '';

    // `_browserEnabledCache` starts null and is populated lazily by this call.
    // Reading the field directly (as claude.js does, where another code path
    // has already warmed it) would leave the browser directive permanently off
    // here, because nothing else in this adapter ever loads it.
    let browserEnabled = false;
    try { browserEnabled = await this.getBrowserEnabled(); } catch { /* default off */ }
    if (this._cancelled(msgChannel)) return { text: '', error: null };

    const taskText = buildDeepSeekTaskFile({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: msgChannel,
      endpoint: this.endpoint,
      tokenExpr: this._tokenExpr(),
      mode: this._mode,
      disabledModules: this.disabledModules,
      browserEnabled,
      recap,
      request: content,
      attachments: attachmentText,
    });

    this._taskCounter += 1;
    const taskFile = path.join(
      this._tasksDir, `dsh-task-${process.pid}-${this._taskCounter}.md`,
    );

    try {
      fs.mkdirSync(this._tasksDir, { recursive: true, mode: 0o700 });
      // 0o600 is meaningful on POSIX only; on Windows the protection comes from
      // the per-user profile directory's ACL, not from this bit.
      fs.writeFileSync(taskFile, taskText, { encoding: 'utf-8', mode: 0o600 });
    } catch (e) {
      // FAIL CLOSED. The alternative — passing the prompt on the command line —
      // would put the workspace token in the process list, which is the exact
      // exposure the task file exists to avoid.
      return {
        text: '',
        error:
          'DeepSeek Harness could not stage its task file '
          + `(${redactDiagnostic(e && e.message)}). The run was not started: the `
          + 'prompt is never passed on the command line.',
      };
    }

    try {
      // Last gate before anything is started. Everything above this line is
      // reversible; a process is not.
      if (this._cancelled(msgChannel)) return { text: '', error: null };
      return await this._spawnDsh({ taskFile, msgChannel, permissionMode });
    } finally {
      try { fs.rmSync(taskFile, { force: true }); } catch { /* best effort */ }
      this._gcSessions();
    }
  }

  _spawnDsh({ taskFile, msgChannel, permissionMode }) {
    return new Promise((resolve, reject) => {
      const args = buildHeadlessArgs({
        jsEntry: this._jsEntry,
        taskFile,
        patchFile: this._patchFile,
      });

      const proc = spawn(this._nodeBin, args, {
        // stdin is /dev/null: dsh has no stdin task channel, and a prompt that
        // ever waited on it would hang the run instead of failing.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this._buildSubprocessEnv(permissionMode),
        cwd: this.workingDir,
        detached: !IS_WINDOWS,
        windowsHide: true,
      });
      this._channelProcesses[msgChannel] = proc;

      // Log the invocation WITHOUT the task: argv's task element is a constant
      // sentence, but the file it names holds the user's content.
      this._log(
        `Running DeepSeek Harness: --profile headless --patch <private> `
        + `${path.basename(taskFile)} (${fs.statSync(taskFile).size} bytes, mode=${permissionMode})`,
      );

      // Buffers, not strings: the caps below are BYTE budgets, and a string's
      // .length counts UTF-16 code units, which for multi-byte output
      // understates the memory actually held.
      const stdoutChunks = [];
      let stdoutBytes = 0;
      let stderrTail = Buffer.alloc(0);
      let overflow = false;
      let settled = false;
      let timedOut = false;
      let timer = null;
      let exitBackstop = null;

      const timeoutMessage = (suffix) =>
        `DeepSeek Harness run timed out after ${this._runTimeoutMs / 60000} minutes `
        + 'and was terminated. The harness does not report progress while a task '
        + 'is running, so no partial result is available.' + (suffix || '');

      // Four routes can end this run — timeout, stop, spawn error and close.
      // Exactly one of them may settle the promise.
      //
      // Untracking happens HERE and only here, and every route reaches it after
      // the child is known to be gone (or after the backstop below gives up on
      // it). Untracking while the child may still be alive would hand the run's
      // `finally` a green light to garbage-collect sessions under a live
      // process, and would drop the handle `/stop` needs to try again.
      const settle = (fn, value, { childGone = true } = {}) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (exitBackstop) clearTimeout(exitBackstop);
        delete this._channelProcesses[msgChannel];
        if (!childGone) {
          // Untracking a child we could not prove is dead would strand it: a
          // later /stop would have nothing to kill, and the session GC would
          // run while it may still be writing. Keep it in the survivor set,
          // which both of those consult.
          this._survivorProcesses.add(proc);
          proc.once('close', () => this._survivorProcesses.delete(proc));
        }
        fn(value);
      };

      proc.stdout.on('data', (d) => {
        const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
        if (stdoutBytes >= MAX_STDOUT_BYTES) { overflow = true; return; }
        // Trim the chunk to the remaining budget rather than testing before
        // appending: a single oversized chunk would otherwise sail past the cap.
        const room = MAX_STDOUT_BYTES - stdoutBytes;
        if (buf.length > room) {
          stdoutChunks.push(buf.subarray(0, room));
          stdoutBytes = MAX_STDOUT_BYTES;
          overflow = true;
        } else {
          stdoutChunks.push(buf);
          stdoutBytes += buf.length;
        }
      });
      proc.stderr.on('data', (d) => {
        const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
        // A rolling TAIL, so memory is bounded no matter how much a wedged CLI
        // writes, and the end — where dsh puts the terminal error — survives.
        stderrTail = Buffer.concat([stderrTail, buf]);
        if (stderrTail.length > MAX_STDERR_BYTES) {
          stderrTail = stderrTail.subarray(stderrTail.length - MAX_STDERR_BYTES);
        }
      });
      // A killed child can emit a benign EPIPE/ECONNRESET on its stdio a tick
      // later; without these listeners that becomes an uncaughtException.
      proc.stdout.on('error', () => {});
      proc.stderr.on('error', () => {});

      proc.on('error', (e) => settle(reject, e));

      timer = setTimeout(async () => {
        timedOut = true;
        this._log(`DeepSeek Harness exceeded ${this._runTimeoutMs / 60000}min — terminating`);
        // Terminate first and let 'close' settle, so the child stays tracked
        // (and therefore stoppable, and visible to the session GC guard) until
        // it is actually gone. `timedOut` is what stops the close handler from
        // reporting this as a generic "killed by SIGTERM" failure.
        await this._stopProcess(proc).catch(() => {});
        // If even SIGKILL did not produce a 'close', settle anyway rather than
        // wedging the channel forever — and say plainly that a process may have
        // survived, instead of implying a clean termination.
        exitBackstop = setTimeout(() => {
          this._log('DeepSeek Harness did not exit after SIGKILL — releasing the channel');
          settle(resolve, {
            text: '',
            error: timeoutMessage(
              ' The process did not exit after being killed and may still be running.',
            ),
          }, { childGone: false });
        }, STOP_GRACE_MS);
      }, this._runTimeoutMs);

      // 'close' rather than 'exit': the entire answer is stdout, and 'exit' can
      // fire before the pipe has been fully drained.
      proc.on('close', (code, signal) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = stderrTail.toString('utf-8');
        if (timedOut) {
          settle(resolve, { text: '', error: timeoutMessage() });
          return;
        }
        if (this._stoppingChannels.has(msgChannel)) {
          settle(resolve, { text: '', error: null });
          return;
        }
        if (code === 0) {
          const { text, truncated } = cleanStdout(stdout);
          if (truncated || overflow) {
            this._log('DeepSeek Harness output exceeded the reply cap and was truncated');
          }
          settle(resolve, { text, error: null });
          return;
        }
        // A failed run's stdout is NOT an answer: dsh only guarantees the final
        // assistant text on success.
        const { category, message } = classifyDshFailure({ code, signal, stderr });
        this._log(`DeepSeek Harness failed (${category}, exit ${code})`);
        settle(resolve, {
          text: '',
          error: `DeepSeek Harness failed (${category}): ${redactDiagnostic(message, 2000)}`,
        });
      });
    });
  }

  // ------------------------------------------------------------------
  // Session garbage collection
  // ------------------------------------------------------------------

  /**
   * Trim the private harness home's persisted sessions.
   *
   * dsh writes one session per run — `sessions/<workspace-slug>/session-<uuid>/`
   * holding a compressed jsonl (~20 KB) — and has no resume, so the directory
   * grows once per workspace message and nothing ever reclaims it.
   *
   * Only runs when this adapter has no live child: a session belonging to a run
   * still in flight is indistinguishable from a stale one by mtime alone.
   * Nothing outside `sessions/` is touched — profiles, settings.yaml and
   * .credentials.yaml are not ours to delete.
   */
  _gcSessions() {
    if (Object.keys(this._channelProcesses).length > 0) return;
    // A survivor is a child a kill could not be shown to have ended. Treating
    // it as absent is exactly the case this guard exists to prevent.
    if (this._survivorProcesses.size > 0) {
      this._log('Session cleanup skipped — a terminated run may still be alive');
      return;
    }
    const root = path.join(this._dshHome, 'sessions');
    try {
      if (!fs.existsSync(root)) return;
      for (const scope of fs.readdirSync(root)) {
        const scopeDir = path.join(root, scope);
        // Reject symlinks outright rather than following them.
        if (!fs.lstatSync(scopeDir).isDirectory()) continue;

        const entries = [];
        for (const name of fs.readdirSync(scopeDir)) {
          const full = path.join(scopeDir, name);
          const st = fs.lstatSync(full);
          if (!st.isDirectory()) continue;
          entries.push({ name, mtimeMs: st.mtimeMs });
        }

        for (const name of selectSessionsForGc(entries)) {
          const victim = path.join(scopeDir, name);
          // Belt and braces: never delete anything whose real path escaped the
          // private sessions root.
          const real = fs.realpathSync(victim);
          if (!real.startsWith(fs.realpathSync(root) + path.sep)) continue;
          fs.rmSync(victim, { recursive: true, force: true });
        }
      }
    } catch (e) {
      // GC is housekeeping: a failure must never affect the reply.
      this._log(`Session cleanup skipped: ${redactDiagnostic(e && e.message)}`);
    }
  }
}

module.exports = DeepSeekAdapter;
