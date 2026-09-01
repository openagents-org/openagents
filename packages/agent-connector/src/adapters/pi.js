/**
 * Pi CLI adapter for OpenAgents workspace.
 *
 * Bridges the Pi coding agent (https://pi.dev, npm `@earendil-works/pi-coding-agent`,
 * executable `pi`) to an OpenAgents workspace:
 *   - polling loop + per-channel task dispatch (inherited from BaseAdapter)
 *   - ONE long-lived `pi --mode rpc` subprocess per active channel, driven over
 *     stdin/stdout JSONL — the same persistent-process model claude.js uses
 *     (_persistentProcs / _channelProcesses / idle timer / watchdog /
 *     _stopProcess), so process lifecycle behaviour is identical across the two
 *   - the RPC stream is framed + classified by pi-stream.js (pure, unit-tested)
 *     and mapped onto the standard OpenAgents events (thinking / status /
 *     response / error)
 *   - real session continuity via Pi's `--session-id <uuid>`, which CREATES the
 *     session when missing and RESUMES it when present, so a channel keeps its
 *     context across messages, process restarts and launcher restarts without
 *     any session-correlation guesswork
 *
 * Deliberately NOT used: `@earendil-works/pi-coding-agent`'s in-process
 * `AgentSession` / Agent Core API. OpenAgents integrates every coding agent as
 * a CLI subprocess (see the sibling adapters); embedding Pi's SDK would put a
 * third-party agent runtime, its provider stack and its extension loader inside
 * the daemon process. Nothing here imports any Pi module.
 *
 * Verified against pi 0.83.0 (engines.node >= 22.19.0). Because that engine
 * floor is above what a user's ambient Node may satisfy, a resolved JS entry
 * point is launched with the launcher's own portable Node (v22.22.3) and
 * preflight refuses to start on anything older.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { formatAttachmentsForPrompt, SESSION_DEFAULT_RE, generateSessionTitle } = require('./utils');
const { buildPiSystemPrompt } = require('./workspace-prompt');
const { REASON, classifySpawnError } = require('./health-status');
const { defaultAgentWorkdir, whichBinary, whereBinary } = require('../paths');
const {
  PiStreamParser,
  PiAssistantAccumulator,
  buildPiArgs,
  inferLauncherProvider,
  classifyNodeVersion,
  classifyPiError,
  classifyPiVersion,
  isValidSessionId,
  normalizeThinking,
  parseTrustProject,
  parseWindowsCmdShim,
  redactArgs,
  redactSecrets,
  MIN_NODE_VERSION,
  MIN_PI_VERSION,
} = require('./pi-stream');

const IS_WINDOWS = process.platform === 'win32';
const LAUNCHER_PROVIDER_EXTENSION = path.join(__dirname, 'pi-launcher-provider.mjs');

// ---------------------------------------------------------------------------
// Package identity — read from the registry, never hard-coded here
// ---------------------------------------------------------------------------

/**
 * The bundled registry's `pi` entry, memoized. The npm package name and the
 * minimum supported version are CONFIGURATION: they live in
 * sdk/src/openagents/registry/pi.yaml → packages/agent-connector/registry.json
 * and are read from there, so bumping the catalog cannot leave this adapter
 * probing a stale path or enforcing a stale version floor.
 */
let _piRegistryEntry;
function piRegistryEntry() {
  if (_piRegistryEntry !== undefined) return _piRegistryEntry;
  _piRegistryEntry = null;
  try {
    const catalog = require('../../registry.json');
    if (Array.isArray(catalog)) {
      _piRegistryEntry = catalog.find((e) => e && e.name === 'pi') || null;
    }
  } catch { /* bundle unreadable — fall back to the module defaults */ }
  return _piRegistryEntry;
}

/** The npm package Pi installs as, per the registry. Null when undeclared. */
function piNpmPackage() {
  const entry = piRegistryEntry();
  return (entry && entry.install && entry.install.npm_package) || null;
}

/** The registry's version floor, falling back to the module default. */
function piMinVersion() {
  const entry = piRegistryEntry();
  return (entry && entry.install && entry.install.min_version) || MIN_PI_VERSION;
}

/** Release an idle channel's Pi process after this long (matches claude.js). */
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/** Watchdog cadence + how many consecutive silences kill a wedged process. */
const WATCHDOG_INTERVAL_MS = 15_000;
const WATCHDOG_MAX_TIMEOUTS = 20; // 20 × 15s = 5 min of silence

/** How long a control RPC (abort / get_state) may wait for its response. */
const RPC_TIMEOUT_MS = 30_000;

/** Grace given to an in-flight turn to settle after an `abort` before the kill. */
const ABORT_GRACE_MS = 3_000;

/** Version probes are cached per resolved binary so we never spawn per message. */
const VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const _piVersionCache = new Map(); // binPath -> { version, supported, at }
const _nodeVersionCache = new Map(); // nodeBin -> { version, supported, at }

/** Thrown into pending RPCs when a channel is torn down. */
class PiCancelledError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PiCancelledError';
  }
}

class PiAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {Set} [opts.disabledModules]
   * @param {string} [opts.workingDir]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    /** Pi reaches workspace APIs via bash + curl; there is no MCP wiring. */
    this.toolMode = 'skills';

    // channel → { sessionId, workingDir } (Pi session UUIDs we own)
    this._channelSessions = {};
    // channel → persistent-process record
    this._persistentProcs = {};
    // channel → child process (BaseAdapter/stop paths read this)
    this._channelProcesses = {};
    this._stoppingChannels = new Set();

    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_pi.json`,
    );
    // Pi sessions live under OpenAgents' own data tree, NOT in the user's
    // project and NOT in the shared ~/.pi/agent/sessions — one directory per
    // (workspace, agent) so two agents can never read each other's transcripts.
    this._sessionDir = path.join(
      os.homedir(), '.openagents', 'pi-sessions',
      `${PiAdapter._safe(this.workspaceId)}_${PiAdapter._safe(this.agentName)}`,
    );
    this._piBin = null;
    this._loadSessions();
  }

  static _safe(value) {
    return String(value || 'default').replace(/[^A-Za-z0-9._-]/g, '_') || 'default';
  }

  /** Exact secret values that must never reach a log, status or chat message. */
  _secrets() {
    const env = this.agentEnv || process.env;
    const out = [];
    if (this.token) out.push(this.token);
    for (const [k, v] of Object.entries(env)) {
      if (!v || typeof v !== 'string' || v.length < 8) continue;
      if (/(_API_KEY|_AUTH_TOKEN|_OAUTH_TOKEN|_TOKEN|_SECRET|_ACCESS_KEY)$/.test(k)) out.push(v);
    }
    return out;
  }

  /** Redact with this agent's concrete secrets folded in. */
  _redact(text) {
    return redactSecrets(text, this._secrets());
  }

  // ------------------------------------------------------------------
  // Session persistence (Pi session UUIDs, bound to the working dir)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (!fs.existsSync(this._sessionsFile)) return;
      const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        this._log('Pi sessions file has an unexpected shape — starting fresh');
        return;
      }
      let kept = 0;
      for (const [channel, entry] of Object.entries(data)) {
        if (entry && typeof entry === 'object' && isValidSessionId(entry.sessionId)) {
          this._channelSessions[channel] = { sessionId: entry.sessionId, workingDir: entry.workingDir || null };
          kept++;
        }
      }
      this._log(`Loaded ${kept} Pi session(s)`);
    } catch {
      // A truncated/corrupt file must never wedge the agent: drop it and let
      // each channel mint a fresh session id on its next message.
      this._log('Could not read Pi sessions file (corrupt or unreadable) — starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  /**
   * The Pi session id for a channel, minting (and persisting) one when absent,
   * corrupt, or bound to a different working directory. Pi's `--session-id`
   * creates the session when it does not exist, so a lost/deleted session file
   * degrades to "fresh context", never to an error.
   */
  _sessionIdFor(channel, workingDir) {
    const entry = this._channelSessions[channel];
    if (entry && isValidSessionId(entry.sessionId)
      && (!entry.workingDir || !workingDir || entry.workingDir === workingDir)) {
      return entry.sessionId;
    }
    const sessionId = crypto.randomUUID();
    this._channelSessions[channel] = { sessionId, workingDir: workingDir || null };
    this._saveSessions();
    this._log(`Minted Pi session ${sessionId} for channel=${channel}`);
    return sessionId;
  }

  _clearSession(channel) {
    if (this._channelSessions[channel]) {
      delete this._channelSessions[channel];
      this._saveSessions();
    }
  }

  // ------------------------------------------------------------------
  // Binary resolution (mirrors the Claude/Cline adapters tier-for-tier)
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
   * Resolve a shim/symlink to [nodeBin, jsEntry] so we spawn the JS entry point
   * under a Node we control. On Windows this also avoids wrapping a `.cmd` in
   * `cmd.exe /c`, whose 8191-char command-line cap would truncate the long
   * --append-system-prompt. Returns null when the target is a native binary.
   */
  _resolveToNodeCmd(binPath) {
    const nodeBin = this._findNodeBin();
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) {
      try {
        const cmdDir = path.dirname(path.resolve(binPath));
        // Both npm shim dialects (`%dp0%` and `%~dp0`) are parsed — see
        // parseWindowsCmdShim. A shim we fail to parse falls back to
        // `cmd.exe /c`, where the ~14 KB --append-system-prompt exceeds
        // cmd.exe's 8191-character command line and the agent hangs.
        const shim = parseWindowsCmdShim(fs.readFileSync(binPath, 'utf-8'), cmdDir);
        if (shim && shim.kind === 'script') return [nodeBin, shim.target];
        if (shim && shim.kind === 'exe') return [shim.target];
      } catch {}
    } else {
      try {
        let target = binPath;
        if (fs.lstatSync(binPath).isSymbolicLink()) {
          target = path.resolve(path.dirname(binPath), fs.readlinkSync(binPath));
        }
        if (target.endsWith('.js') || target.endsWith('.mjs')) return [nodeBin, target];
        if (this._isNodeShebangScript(target)) return [nodeBin, target];
      } catch {}
    }
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
   * Locate the `pi` executable. The isolated runtime prefix installed by
   * `openagents install pi` wins over anything on the user's PATH, so a global
   * Pi can never shadow the version OpenAgents manages.
   */
  _findPiBinary() {
    const home = os.homedir();
    const ext = IS_WINDOWS ? '.cmd' : '';

    // Tier 0: isolated runtime prefix (~/.openagents/runtimes/pi/)
    const runtimeCandidate = path.join(home, '.openagents', 'runtimes', 'pi', 'node_modules', '.bin', `pi${ext}`);
    if (fs.existsSync(runtimeCandidate)) return runtimeCandidate;

    // Tier 0b: legacy shared portable prefix
    const portable = path.join(home, '.openagents', 'nodejs', 'node_modules', '.bin', `pi${ext}`);
    if (fs.existsSync(portable)) return portable;

    // Tier 0c: the package's own entry point. npm normally creates the .bin
    // shim above, but a partially-completed install can leave the package
    // present without it — and the entry point is a Node script we can run.
    // The package NAME comes from the registry and the entry path from the
    // installed package's own `bin` field, so neither is written here.
    const pkgBin = this._findPackageEntryPoint(home);
    if (pkgBin) return pkgBin;

    // Tier 1: PATH search via the codepage-safe lookup (forces UTF-8 output and
    // verifies existence, so a non-ASCII username isn't mangled into ENOENT).
    const viaWhere = whereBinary('pi');
    if (viaWhere) return viaWhere;

    // Tier 2: next to the Node interpreter running this daemon (npm global)
    const nearNode = path.join(path.dirname(process.execPath), `pi${ext}`);
    if (fs.existsSync(nearNode)) return nearNode;

    // Tier 3: common install locations
    const candidates = IS_WINDOWS ? [
      path.join(process.env.APPDATA || '', 'npm', 'pi.cmd'),
    ] : [
      path.join(home, '.local', 'bin', 'pi'),
      path.join(home, '.npm-global', 'bin', 'pi'),
      '/opt/homebrew/bin/pi',
      '/usr/local/bin/pi',
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;

    // Tier 4: deep scan of every known bin dir (nvm/fnm/volta/homebrew/…)
    return whichBinary('pi') || null;
  }

  /**
   * Locate the installed Pi package's own executable entry point, without
   * naming either the package or its bin path in this file: the package name
   * comes from the registry (`install.npm_package`) and the entry path from
   * that package's `bin` field on disk. Returns null when it can't be resolved.
   */
  _findPackageEntryPoint(home) {
    const pkgName = piNpmPackage();
    const binName = (piRegistryEntry() || {}).install?.binary || 'pi';
    if (!pkgName) return null;
    for (const root of [
      path.join(home, '.openagents', 'runtimes', 'pi', 'node_modules'),
      path.join(home, '.openagents', 'nodejs', 'node_modules'),
    ]) {
      const pkgDir = path.join(root, ...pkgName.split('/'));
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
        const bin = meta && meta.bin;
        const rel = typeof bin === 'string' ? bin : (bin && (bin[binName] || bin[pkgName]));
        if (!rel) continue;
        const entry = path.join(pkgDir, rel);
        if (fs.existsSync(entry)) return entry;
      } catch { /* not installed here, or unreadable manifest */ }
    }
    return null;
  }

  /** Resolve [cmd, ...args] for spawning, preferring the portable-Node path. */
  _spawnableCmd(binPath, args) {
    const resolved = this._resolveToNodeCmd(binPath);
    if (resolved) return [...resolved, ...args];
    if (IS_WINDOWS && binPath.toLowerCase().endsWith('.cmd')) return ['cmd.exe', '/c', binPath, ...args];
    return [binPath, ...args];
  }

  // ------------------------------------------------------------------
  // Version gates
  // ------------------------------------------------------------------

  /**
   * Run `pi --version`. Uses execFileSync (argument array, no shell) so a
   * resolved path containing spaces or shell metacharacters can never be
   * re-interpreted as a command. Isolated so tests can stub it.
   */
  _readPiVersionRaw(piBin) {
    const [cmd, ...args] = this._spawnableCmd(piBin, ['--version']);
    return execFileSync(cmd, args, {
      encoding: 'utf-8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  /** Run `node --version` for the interpreter we would launch Pi with. */
  _readNodeVersionRaw(nodeBin) {
    if (nodeBin === process.execPath) return process.version;
    return execFileSync(nodeBin, ['--version'], {
      encoding: 'utf-8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  /**
   * @returns {{version: string|null, compatible: boolean|null}}
   *   compatible true → >= MIN_PI_VERSION; false → CONFIRMED older;
   *   null → undetermined (we proceed leniently, like the Cline adapter).
   */
  _checkPiVersion(piBin) {
    const now = Date.now();
    const cached = _piVersionCache.get(piBin);
    if (cached && (now - cached.at) < VERSION_CACHE_TTL_MS) {
      return { version: cached.version, compatible: cached.supported };
    }
    let version = null;
    let supported = null;
    try {
      ({ version, supported } = classifyPiVersion(this._readPiVersionRaw(piBin), piMinVersion()));
    } catch {
      version = null;
      supported = null;
    }
    _piVersionCache.set(piBin, { version, supported, at: now });
    return { version, compatible: supported };
  }

  /** Same shape for the Node that will host Pi (hard floor: 22.19.0). */
  _checkNodeVersion(nodeBin) {
    const now = Date.now();
    const cached = _nodeVersionCache.get(nodeBin);
    if (cached && (now - cached.at) < VERSION_CACHE_TTL_MS) {
      return { version: cached.version, compatible: cached.supported };
    }
    let version = null;
    let supported = null;
    try {
      ({ version, supported } = classifyNodeVersion(this._readNodeVersionRaw(nodeBin)));
    } catch {
      version = null;
      supported = null;
    }
    _nodeVersionCache.set(nodeBin, { version, supported, at: now });
    return { version, compatible: supported };
  }

  /** Clear both version caches (test hook; also correct after an install). */
  static _clearVersionCache() {
    _piVersionCache.clear();
    _nodeVersionCache.clear();
  }

  /**
   * Preflight gate, run by the daemon BEFORE the workspace join. Pi cannot do
   * anything without a resolvable CLI and a Node new enough to run it, so both
   * are checked here and reported with a precise REASON instead of failing
   * every message after a pointless join.
   */
  preflight() {
    const piBin = this._piBin || this._findPiBinary();
    if (!piBin) {
      return {
        ok: false,
        reason: REASON.RUNTIME_MISSING,
        message: 'Pi CLI not found — install it with: openagents install pi',
      };
    }
    this._piBin = piBin;

    // Only a JS entry point runs under a Node we choose; a native binary
    // carries its own runtime and the engine floor does not apply.
    const resolved = this._resolveToNodeCmd(piBin);
    if (resolved && resolved.length === 2) {
      const node = this._checkNodeVersion(resolved[0]);
      if (node.compatible === false) {
        return {
          ok: false,
          reason: REASON.VERSION_INCOMPATIBLE,
          message:
            `Pi requires Node.js >= ${MIN_NODE_VERSION} but the available runtime is ` +
            `${node.version} (${resolved[0]}). Install the launcher's bundled Node ` +
            '(reinstall Pi from the Install page) or upgrade the system Node.',
        };
      }
    }

    const ver = this._checkPiVersion(piBin);
    if (ver.compatible === false) {
      return {
        ok: false,
        reason: REASON.VERSION_INCOMPATIBLE,
        message:
          `Pi CLI ${ver.version} is below the minimum supported version ${piMinVersion()}. ` +
          'Update it from the Install page.',
      };
    }

    this._log(`Pi CLI resolved: ${piBin}${ver.version ? ` (v${ver.version})` : ''}`);
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Control actions (stop / restart) + shutdown
  // ------------------------------------------------------------------

  async _onControlAction(action, payload) {
    if (action === 'stop') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        const pp = this._persistentProcs[channel];
        if (pp) pp.userStopped = true;
        this._stoppingChannels.add(channel);
        delete this._channelQueues[channel];
        if (this._channelProcesses[channel]) {
          this._log(`Stopping Pi for channel=${channel}`);
          await this._abortChannel(channel);
        }
        // Acknowledged even with nothing running — the UI's Stop button stays
        // disabled at "Stopping…" until something non-status lands.
        await this._postStopNotice(channel);
      } else {
        for (const pp of Object.values(this._persistentProcs)) pp.userStopped = true;
        await this._stopAllProcesses('Execution stopped by user.');
      }
      return;
    }
    if (action === 'restart') {
      const channel = (payload && typeof payload === 'object') ? payload.channel : null;
      if (channel) {
        await this._killPersistentProc(channel, 'restart requested');
        this._clearSession(channel);
        try {
          await this.client.sendMessage(this.workspaceId, channel, this.token,
            'Session restarted — the next message starts a fresh Pi session.',
            {
              senderType: 'agent',
              senderName: this.agentName,
              messageType: 'status',
              metadata: { agent_mode: this._mode },
              sessionId: this._sessionId,
            });
        } catch (e) {
          this._log(`Restart: failed to post status: ${this._redact(e && e.message)}`);
        }
      } else {
        this._channelSessions = {};
        this._saveSessions();
        await this._stopAllProcesses('Execution stopped.');
      }
      return;
    }
    await super._onControlAction(action, payload);
  }

  /**
   * Daemon shutdown — tear down every Pi child so no orphan survives the
   * launcher and no channel is left showing a stale "running" status.
   * Fire-and-forget: daemon._killAgent allows a short grace period.
   */
  stop() {
    this._stopAllProcesses(
      'Task interrupted — daemon restarting. Send another message to continue.',
    ).catch(() => {});
    super.stop();
  }

  async _stopAllProcesses(message = 'Execution stopped.') {
    const channels = Object.keys(this._persistentProcs);
    if (!channels.length) {
      await this._postStopNotice(this.channelName, message);
      return;
    }
    this._log(`Stopping ${channels.length} Pi process(es)...`);
    for (const channel of channels) {
      this._stoppingChannels.add(channel);
      await this._killPersistentProc(channel, 'adapter stopping');
      delete this._channelQueues[channel];
      try { await this.sendResponse(channel, message); } catch {}
    }
  }

  /**
   * Stop ONE channel: ask Pi to `abort` over RPC first (so it can unwind its
   * tool work), give the turn a short grace period to settle, then terminate
   * the process tree. Other channels and other agents are untouched.
   */
  async _abortChannel(channel) {
    const pp = this._persistentProcs[channel];
    if (!pp) return;
    try {
      await this._sendRpc(pp, { type: 'abort' }, { timeoutMs: ABORT_GRACE_MS });
    } catch (e) {
      this._log(`Abort RPC did not complete for ${channel}: ${this._redact(e && e.message)}`);
    }
    // Give the in-flight turn a moment to settle on its own after the abort.
    // Capture the record first: the exit/teardown path can null pp.turn between
    // the check and the await.
    const turn = pp.turn;
    if (turn) {
      const settled = await Promise.race([
        turn.promise.then(() => true, () => true),
        this._sleep(ABORT_GRACE_MS).then(() => false),
      ]);
      if (settled && !pp.turnInFlight) {
        // Clean abort: keep the process so the next message reuses its context.
        this._log(`Pi aborted cleanly for ${channel} — process kept alive`);
        return;
      }
    }
    await this._killPersistentProc(channel, 'stop requested');
  }

  /**
   * Cross-platform process-tree termination. Same shape as claude.js: SIGINT/
   * SIGTERM on the process GROUP first (Pi spawns bash tool children that must
   * die with it), escalating to SIGKILL / `taskkill /F /T`.
   */
  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { proc.kill('SIGINT'); } catch {}
        const exited = await this._waitExit(proc, 1500);
        if (!exited) {
          try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000, windowsHide: true }); } catch {}
        }
      } else {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
        const exited = await this._waitExit(proc, 1500);
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
  // Persistent process lifecycle
  // ------------------------------------------------------------------

  /**
   * Kill a channel's Pi process and clear every resource it owns: timers,
   * pending RPCs (rejected with a clear cancellation), stream listeners and
   * both channel registrations. Returns once the process has actually exited,
   * so a replacement spawn can never race the old exit handler.
   */
  _killPersistentProc(channel, why = 'released') {
    const pp = this._persistentProcs[channel];
    if (!pp) return Promise.resolve();
    this._teardownProcState(pp, `Pi process ${why}`);
    delete this._persistentProcs[channel];
    if (this._channelProcesses[channel] === pp.proc) delete this._channelProcesses[channel];
    return this._stopProcess(pp.proc).catch(() => {});
  }

  /** Clear timers/listeners and fail everything still waiting on this process. */
  _teardownProcState(pp, reason) {
    if (pp.idleTimer) { clearTimeout(pp.idleTimer); pp.idleTimer = null; }
    this._stopWatchdog(pp);
    pp.alive = false;
    const err = new PiCancelledError(reason);
    for (const [, entry] of pp.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      try { entry.reject(err); } catch {}
    }
    pp.pending.clear();
    if (pp.turn) {
      const turn = pp.turn;
      pp.turn = null;
      pp.turnInFlight = false;
      try { turn.resolve({ ended: true, reason }); } catch {}
    }
    for (const stream of [pp.proc && pp.proc.stdout, pp.proc && pp.proc.stderr]) {
      if (!stream) continue;
      stream.removeAllListeners('data');
      stream.removeAllListeners('end');
      // Keep an error guard: a SIGKILL'd child's pipe can still emit 'error'
      // after teardown, and an unhandled stream error would crash the daemon.
      stream.on('error', () => {});
    }
  }

  /** Drop registrations only if they still point at THIS process. */
  _unregisterProc(channel, pp, proc) {
    if (this._persistentProcs[channel] === pp) delete this._persistentProcs[channel];
    if (this._channelProcesses[channel] === proc) delete this._channelProcesses[channel];
  }

  _resetIdleTimer(channel) {
    const pp = this._persistentProcs[channel];
    if (!pp) return;
    if (pp.idleTimer) clearTimeout(pp.idleTimer);
    pp.idleTimer = setTimeout(() => {
      this._log(`Pi process idle for ${IDLE_TIMEOUT_MS / 60000}min, releasing ${channel}`);
      this._killPersistentProc(channel, 'idle timeout');
    }, IDLE_TIMEOUT_MS);
    // An idle timer must not hold the event loop open on shutdown.
    if (typeof pp.idleTimer.unref === 'function') pp.idleTimer.unref();
  }

  /**
   * Kill the process when stdout falls silent while a turn is in flight.
   * Paused during tool execution: a long build or test run legitimately
   * produces no RPC events for minutes.
   */
  _startWatchdog(pp) {
    this._stopWatchdog(pp);
    pp.lastStdoutTime = Date.now();
    let consecutive = 0;
    pp.watchdogTimer = setInterval(async () => {
      if (!pp.turnInFlight) { consecutive = 0; return; }
      if (pp.awaitingToolResult) { consecutive = 0; return; }
      if (Date.now() - pp.lastStdoutTime < WATCHDOG_INTERVAL_MS) { consecutive = 0; return; }
      consecutive++;
      pp.lastStdoutTime = Date.now();
      if (consecutive === 2) {
        try { await this.sendStatus(pp.msgChannel, 'Still working...'); } catch {}
      }
      if (consecutive >= WATCHDOG_MAX_TIMEOUTS) {
        this._log(`Watchdog: Pi silent ${consecutive * (WATCHDOG_INTERVAL_MS / 1000)}s on ${pp.msgChannel} — killing`);
        pp.watchdogKilled = true;
        try { await this.sendError(pp.msgChannel, 'The Pi process became unresponsive and was restarted.'); } catch {}
        await this._killPersistentProc(pp.msgChannel, 'watchdog timeout');
      }
    }, WATCHDOG_INTERVAL_MS);
    if (typeof pp.watchdogTimer.unref === 'function') pp.watchdogTimer.unref();
  }

  _stopWatchdog(pp) {
    if (pp.watchdogTimer) { clearInterval(pp.watchdogTimer); pp.watchdogTimer = null; }
  }

  /**
   * Spawn one `pi --mode rpc` process for a channel and wire its streams.
   * @returns {object} the persistent-process record
   */
  _spawnPersistentProc(channel, { piBin, args, workingDir, env, sessionId }) {
    const [cmd, ...spawnArgs] = this._spawnableCmd(piBin, args);
    this._log(`Spawning pi in ${workingDir}: ${redactArgs([cmd, ...spawnArgs]).join(' ')}`);

    const proc = spawn(cmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: workingDir,
      detached: !IS_WINDOWS,
      windowsHide: true,
    });

    const pp = {
      proc,
      parser: new PiStreamParser(),
      pending: new Map(),        // rpc id → { resolve, reject, timer, command }
      queue: Promise.resolve(),  // serializes async event handling
      turn: null,                // { promise, resolve } for the in-flight prompt
      turnInFlight: false,
      acc: new PiAssistantAccumulator(),
      msgChannel: channel,
      sessionId,
      spawnMode: this._mode,
      workingDir,
      idleTimer: null,
      watchdogTimer: null,
      watchdogKilled: false,
      awaitingToolResult: false,
      lastStdoutTime: Date.now(),
      alive: true,
      stdinBroken: false,
      userStopped: false,
      rpcSeq: 0,
      // per-turn accounting
      turnTexts: [],      // the answer candidate (last non-toolUse message)
      heldTexts: [],      // text blocks of the message currently streaming
      turnError: null,
      everPosted: false,
      stderrBuf: '',
    };

    proc.stdout.on('data', (chunk) => {
      pp.lastStdoutTime = Date.now();
      let events;
      try {
        events = pp.parser.push(chunk);
      } catch (e) {
        // Framing must never take the adapter down.
        this._log(`Pi stream framing error: ${this._redact(e && e.message)}`);
        return;
      }
      for (const ev of events) {
        pp.queue = pp.queue.then(() => this._handleEvent(pp, ev)).catch(() => {});
      }
    });

    // stderr is diagnostics ONLY — Pi's RPC protocol lives entirely on stdout,
    // so a stderr line is never parsed as JSONL.
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      pp.stderrBuf = (pp.stderrBuf + text).slice(-8192);
      const line = text.trim();
      if (line) this._log(`pi stderr [${channel}]: ${this._redact(line).slice(0, 500)}`);
    });

    proc.stdout.on('error', () => {});
    proc.stderr.on('error', () => {});
    // stdin errors arrive ASYNCHRONOUSLY: a Writable reports EPIPE / premature
    // pipe close through an 'error' event, which the try/catch around
    // stdin.write() cannot see. Without this listener a Pi process that exits
    // mid-write raises an unhandled stream error and takes the daemon down.
    if (proc.stdin) {
      proc.stdin.on('error', (err) => {
        pp.stdinBroken = true;
        this._log(`pi stdin [${channel}] closed: ${this._redact(err && err.message)}`);
      });
    }

    proc.stdout.on('end', () => {
      let events = [];
      try { events = pp.parser.flush(); } catch {}
      for (const ev of events) {
        pp.queue = pp.queue.then(() => this._handleEvent(pp, ev)).catch(() => {});
      }
    });

    proc.on('exit', (code, signal) => {
      this._log(`Pi process exited: channel=${channel} code=${code} signal=${signal || 'none'}`);
      const why = signal
        ? `Pi process terminated by ${signal}`
        : `Pi process exited with code ${code}`;
      // A crash / non-zero exit mid-turn is a real failure the user must see.
      // A user stop, a watchdog kill and a clean code-0 exit all have their own
      // messaging, so none of them set a turn error here.
      const abnormal = code !== 0 || (signal && !pp.userStopped);
      if (pp.turnInFlight && abnormal && !pp.userStopped && !pp.watchdogKilled
        && !this._stoppingChannels.has(channel) && !pp.turnError) {
        const stderr = this._redact((pp.stderrBuf || '').trim()).slice(-400);
        pp.turnError = stderr ? `${why}. Last diagnostics: ${stderr}` : why;
      }
      pp.exitCode = code;
      this._teardownProcState(pp, why);
      this._unregisterProc(channel, pp, proc);
    });

    proc.on('error', (err) => {
      const { message } = classifySpawnError(err, { label: 'Pi', bin: cmd });
      this._log(message);
      pp.spawnError = message;
      this._reportStatus(REASON.SPAWN_FAILED, message);
      this._teardownProcState(pp, message);
      this._unregisterProc(channel, pp, proc);
    });

    this._persistentProcs[channel] = pp;
    this._channelProcesses[channel] = proc;
    this._resetIdleTimer(channel);
    return pp;
  }

  // ------------------------------------------------------------------
  // RPC plumbing
  // ------------------------------------------------------------------

  /** Write one JSONL command. Strict LF framing, exactly as Pi requires. */
  _writeRpc(pp, payload) {
    pp.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  /**
   * Send an RPC command and await its `response`. Every command carries a
   * unique id so responses can be correlated; a timeout rejects rather than
   * leaking a pending entry forever.
   */
  _sendRpc(pp, command, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
    if (!pp.alive || pp.stdinBroken || !pp.proc.stdin || pp.proc.stdin.destroyed) {
      return Promise.reject(new PiCancelledError('Pi process is not accepting commands'));
    }
    const id = `oa-${++pp.rpcSeq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pp.pending.delete(id);
        reject(new Error(`Pi RPC "${command.type}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      pp.pending.set(id, { resolve, reject, timer, command: command.type });
      try {
        this._writeRpc(pp, { ...command, id });
      } catch (e) {
        clearTimeout(timer);
        pp.pending.delete(id);
        reject(new Error(`Pi stdin write failed: ${this._redact(e && e.message)}`));
      }
    });
  }

  // ------------------------------------------------------------------
  // Event → workspace mapping
  // ------------------------------------------------------------------

  /**
   * Re-redact a classified event's DIAGNOSTIC strings with this agent's
   * concrete credential values before anything is logged or posted.
   *
   * pi-stream.js is pure and dependency-free, so it can only apply PATTERN
   * redaction — it has no way to know that this agent's GEMINI_API_KEY is
   * `AIza…`, a shape no generic rule matches. Doing the pass HERE, once, at the
   * single boundary every event crosses, means a newly-added event kind cannot
   * forget it: only fields listed below are ever surfaced.
   *
   * Assistant message text (`delta` / `message`) is deliberately NOT rewritten:
   * it is the model's answer to the user, and mangling it would corrupt code
   * and command output. That matches every other adapter in this package.
   */
  _redactEvent(ev) {
    const DIAGNOSTIC_FIELDS = ['preview', 'message', 'error', 'finalError', 'raw', 'title'];
    let copy = null;
    for (const field of DIAGNOSTIC_FIELDS) {
      const value = ev[field];
      if (typeof value !== 'string' || !value) continue;
      const masked = this._redact(value);
      if (masked === value) continue;
      if (!copy) copy = { ...ev };
      copy[field] = masked;
    }
    return copy || ev;
  }

  async _handleEvent(pp, rawEvent) {
    const ev = this._redactEvent(rawEvent);
    const channel = pp.msgChannel;
    switch (ev.kind) {
      case 'response': {
        const entry = ev.id ? pp.pending.get(ev.id) : null;
        if (!entry) {
          // Unknown/absent id: log and ignore. Pi answers `parse` errors with
          // no id, and a late response after a timeout lands here too.
          if (!ev.success) {
            this._log(`Pi RPC failed (${ev.command || 'unknown'}, unmatched id): ${this._redact(ev.error)}`);
          }
          return;
        }
        pp.pending.delete(ev.id);
        if (entry.timer) clearTimeout(entry.timer);
        entry.resolve(ev);
        return;
      }

      case 'agent_start':
        pp.awaitingToolResult = false;
        await this._status(pp, 'Pi is working...');
        return;

      case 'message_start':
        if (ev.role === 'assistant') pp.acc.startMessage();
        return;

      case 'message_update': {
        // Each COMPLETED content block, released exactly once by the
        // accumulator, so the matching message_end can never re-post it.
        //
        // `thinking` goes out immediately — hidden reasoning is never the
        // answer, so it cannot collide with the final reply. `text` is HELD
        // until message_end, where stopReason says whether this message is
        // interim narration (post it as thinking) or the turn's answer (post
        // it once, as a chat message, at settlement). Posting text here as
        // well would make the final answer appear twice: once as thinking and
        // once as the reply.
        for (const block of pp.acc.pushDelta(ev.delta)) {
          if (block.type === 'thinking') await this._emitThinking(pp, block.text);
          else pp.heldTexts.push(block.text);
        }
        // A streaming error delta is the provider aborting mid-message.
        if (ev.delta && ev.delta.type === 'error' && ev.delta.reason === 'error') {
          pp.turnError = pp.turnError || 'The model stream ended with an error.';
        }
        return;
      }

      case 'message_end': {
        const msg = ev.message;
        if (!msg || msg.role !== 'assistant') return;
        const result = pp.acc.endMessage(msg);
        // Blocks whose streaming *_end never arrived (a non-streaming provider,
        // or a lost delta) surface here for the first time.
        for (const block of result.blocks) {
          if (block.type === 'thinking') await this._emitThinking(pp, block.text);
          else pp.heldTexts.push(block.text);
        }
        if (result.errorMessage) {
          pp.turnError = result.errorMessage;
        } else if (result.stopReason === 'error') {
          pp.turnError = pp.turnError || 'Pi ended the turn with an error.';
        }
        // stopReason 'toolUse' means the model is calling a tool and will speak
        // again — this message's text is narration around the call, so it goes
        // out now as `thinking`. Any other stop reason means the message stands
        // on its own: hold it as the answer candidate. The LAST such candidate
        // of the turn is what _postTurnOutcome posts, exactly once.
        const held = pp.heldTexts;
        pp.heldTexts = [];
        if (!held.length) return;
        if (result.stopReason === 'toolUse') {
          for (const text of held) await this._emitThinking(pp, text);
        } else {
          // A previous candidate is superseded — flush it as thinking rather
          // than dropping it, so nothing the model said is ever lost.
          for (const text of pp.turnTexts) await this._emitThinking(pp, text);
          pp.turnTexts = held;
          pp.everPosted = true;
        }
        return;
      }

      case 'tool_start':
        pp.awaitingToolResult = true;
        pp.everPosted = true;
        await this._status(pp, ev.preview ? `${ev.toolName} › ${ev.preview}` : `${ev.toolName} running`);
        return;

      case 'tool_update':
        // Progress only — keeps the watchdog quiet without spamming the channel.
        pp.lastStdoutTime = Date.now();
        return;

      case 'tool_end':
        // Always report completion, not just failure: without a terminal status
        // the thread stays visually parked on the tool's "running" line.
        pp.awaitingToolResult = false;
        await this._status(pp, ev.isError
          ? `${ev.toolName} failed${ev.preview ? `: ${ev.preview}` : ''}`
          : `${ev.toolName} ✓${ev.preview ? ` ${ev.preview}` : ''}`);
        return;

      case 'bash_output':
        // Direct RPC bash output. We never issue `bash` commands ourselves, so
        // this only appears if an extension does; treat it as tool activity.
        pp.awaitingToolResult = true;
        return;

      case 'queue_update':
        return;

      case 'compaction_start':
        await this._status(pp, `Compacting conversation context (${ev.reason})...`);
        return;

      case 'compaction_end':
        if (ev.error) {
          await this._status(pp, `Context compaction failed: ${ev.error}`);
        } else if (!ev.aborted) {
          await this._status(pp, 'Context compaction complete.');
        }
        return;

      case 'retry_start':
        await this._status(
          pp,
          `Transient provider error — retrying (attempt ${ev.attempt ?? '?'}` +
          `${ev.maxAttempts ? `/${ev.maxAttempts}` : ''})...`,
        );
        return;

      case 'retry_end':
        if (!ev.success) {
          pp.turnError = pp.turnError || (ev.finalError || 'Pi exhausted its automatic retries.');
        }
        return;

      case 'extension_error':
        // The pure classifier can only apply PATTERN redaction — it does not
        // know this agent's concrete credential values. Re-redact here, at the
        // boundary, or a key that matches no known shape (e.g. a Google
        // AIza... key) reaches the log and the workspace verbatim.
        this._log(`Pi extension error on ${channel}: ${ev.message}`);
        await this._status(pp, `A Pi extension reported an error: ${ev.message}`);
        return;

      case 'ui_request':
        await this._handleUiRequest(pp, ev);
        return;

      case 'agent_end':
        // A low-level run finished. `willRetry` means Pi continues on its own —
        // the turn is only over at agent_settled.
        pp.awaitingToolResult = false;
        return;

      case 'agent_settled':
        pp.awaitingToolResult = false;
        if (pp.turn) {
          const turn = pp.turn;
          pp.turn = null;
          pp.turnInFlight = false;
          this._stopWatchdog(pp);
          turn.resolve({ settled: true });
        }
        return;

      case 'oversize':
        this._log(`Pi emitted a record over the ${ev.bytes}-byte line cap — dropped`);
        return;

      case 'unknown':
        this._log(`Unrecognized Pi RPC record: ${ev.raw}`);
        return;

      default:
        return;
    }
  }

  /**
   * Answer an extension UI request. Headless runs must NEVER block on terminal
   * interaction, so every dialog method is immediately cancelled — the
   * extension sees "user dismissed" and Pi keeps going. Fire-and-forget
   * methods (notify/setStatus/…) expect no reply.
   */
  async _handleUiRequest(pp, ev) {
    if (!ev.needsResponse) {
      if (ev.method === 'notify' && ev.title) await this._status(pp, ev.title);
      return;
    }
    this._log(`Pi extension asked for "${ev.method}" input — auto-cancelling (headless)`);
    try {
      this._writeRpc(pp, { type: 'extension_ui_response', id: ev.id, cancelled: true });
    } catch (e) {
      this._log(`Could not answer extension UI request: ${this._redact(e && e.message)}`);
    }
    await this._status(
      pp,
      `A Pi extension requested interactive input (${ev.method}) and was dismissed — ` +
      'the workspace runs Pi headless.',
    );
  }

  /**
   * Post interim content as a `thinking` event: hidden model reasoning (which
   * must never become an assistant reply) and narration around tool calls.
   * The turn's ANSWER never comes through here — it is posted exactly once by
   * _postTurnOutcome, so no text can appear both as thinking and as the reply.
   */
  async _emitThinking(pp, text) {
    if (!text || !text.trim()) return;
    pp.everPosted = true;
    try { await this.sendThinking(pp.msgChannel, text); } catch {}
  }

  /**
   * Post a status line. Deliberately does NOT set `everPosted`: that flag
   * gates the "Pi finished without producing a response" diagnostic, and a
   * generic progress line must not suppress it.
   */
  async _status(pp, text) {
    try { await this.sendStatus(pp.msgChannel, text); } catch {}
  }

  // ------------------------------------------------------------------
  // Message handling
  // ------------------------------------------------------------------

  /** Environment for the Pi child: agent env plus Pi's own hygiene settings. */
  _buildEnv() {
    const env = { ...(this.agentEnv || process.env) };
    // A relay-only config (base URL, no explicit provider — what the
    // workspace's Add-agent flow produces) gets its provider/API format
    // inferred. Written into the child env so the launcher provider
    // extension, which reads PI_PROVIDER/PI_API_FORMAT itself, agrees with
    // the adapter's own view.
    const inferred = inferLauncherProvider(env);
    if (inferred) {
      env.PI_PROVIDER = inferred.provider;
      const fmt = String(env.PI_API_FORMAT || '').trim().toLowerCase();
      if (!fmt || fmt === 'auto') env.PI_API_FORMAT = inferred.apiFormat;
    }
    // The Launcher exposes one provider-agnostic secret field. Pi's native
    // providers still expect their conventional env var, so mirror the value
    // in memory for the child only. Existing provider-specific env remains
    // authoritative for backwards compatibility.
    const provider = String(env.PI_PROVIDER || '').trim().toLowerCase();
    const key = String(env.PI_API_KEY || '').trim();
    if (key) {
      const target = {
        anthropic: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
        deepseek: 'DEEPSEEK_API_KEY',
        google: 'GEMINI_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
      }[provider];
      if (target && !String(env[target] || '').trim()) env[target] = key;
    }
    // Keep the child off the network at startup for update/telemetry checks:
    // a launcher-managed install must not silently self-update mid-session.
    env.PI_SKIP_VERSION_CHECK = env.PI_SKIP_VERSION_CHECK || '1';
    // Pi writes config/auth under this dir; leave the user's own ~/.pi/agent in
    // place so an existing `pi` login is reused, but never write trust.json.
    return env;
  }

  /** Provider/model/thinking/trust configuration, read from the agent env. */
  _config() {
    const env = this.agentEnv || process.env;
    const val = (k) => String(env[k] == null ? '' : env[k]).trim();
    // Same inference as _buildEnv, so the preflight check in _ensureProc
    // accepts a relay-only config instead of refusing to start.
    const inferred = inferLauncherProvider(env);
    const explicitFormat = val('PI_API_FORMAT');
    return {
      provider: val('PI_PROVIDER') || (inferred && inferred.provider) || null,
      model: val('PI_MODEL') || null,
      baseUrl: val('PI_BASE_URL') || null,
      apiFormat:
        explicitFormat && explicitFormat.toLowerCase() !== 'auto'
          ? explicitFormat
          : (inferred && inferred.apiFormat) || explicitFormat || 'auto',
      thinking: normalizeThinking(val('PI_THINKING')),
      trustProject: parseTrustProject(val('PI_TRUST_PROJECT')),
    };
  }

  _dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  /**
   * Split attachments into images Pi can take inline over RPC and everything
   * else, which is described in the prompt (Pi fetches those with bash+curl).
   * A download failure demotes the image to the curl path rather than failing
   * the message.
   */
  async _prepareAttachments(channel, attachments) {
    const images = [];
    const rest = [];
    for (const att of attachments || []) {
      const contentType = String((att && att.contentType) || '');
      const fileId = att && att.fileId;
      if (!contentType.startsWith('image/') || !fileId) { rest.push(att); continue; }
      try {
        const buffer = await this.client.readFile(this.workspaceId, this.token, fileId);
        if (!buffer || !buffer.length) throw new Error('empty file');
        images.push({ type: 'image', data: Buffer.from(buffer).toString('base64'), mimeType: contentType });
      } catch (e) {
        this._log(`Could not inline image ${att.filename || fileId}: ${this._redact(e && e.message)}`);
        try {
          await this.sendStatus(
            channel,
            `Could not attach "${att.filename || 'image'}" directly — Pi will download it from the workspace instead.`,
          );
        } catch {}
        rest.push(att);
      }
    }
    return { images, rest };
  }

  /**
   * Reuse the channel's live Pi process when it is still valid, otherwise spawn
   * a fresh one. The mode (execute/plan) is baked into the system prompt at
   * spawn time, so a mode switch always forces a respawn — the resumed session
   * keeps the conversation, exactly like claude.js's --resume respawn.
   */
  async _ensureProc(channel, workingDir, systemPrompt) {
    const existing = this._persistentProcs[channel];
    if (existing && existing.alive) {
      if (existing.spawnMode === this._mode && existing.workingDir === workingDir) {
        this._resetIdleTimer(channel);
        return existing;
      }
      this._log(`Pi process for ${channel} is stale (mode/workdir changed) — respawning`);
      await this._killPersistentProc(channel, 'configuration changed');
    }

    const piBin = this._piBin || this._findPiBinary();
    if (!piBin) {
      const message = 'Pi CLI not found — install it with: openagents install pi';
      this._reportStatus(REASON.RUNTIME_MISSING, message);
      throw new Error(message);
    }
    this._piBin = piBin;

    const cfg = this._config();
    const launcherKey = String((this.agentEnv || process.env).PI_API_KEY || '').trim();
    if (cfg.baseUrl && (!cfg.provider || !cfg.model)) {
      throw new Error('PI_PROVIDER and PI_MODEL are required when PI_BASE_URL is set.');
    }
    const sessionId = this._sessionIdFor(channel, workingDir);
    try { fs.mkdirSync(this._sessionDir, { recursive: true }); } catch {}

    const args = buildPiArgs({
      sessionDir: this._sessionDir,
      sessionId,
      appendSystemPrompt: systemPrompt,
      provider: cfg.provider,
      model: cfg.model,
      thinking: cfg.thinking,
      sessionName: `${this.agentName}/${channel}`,
      // A Launcher-managed key is supplied through the same process-local
      // provider extension as relays. Besides keeping credentials out of argv
      // and ~/.pi, this bypasses Pi's native auth resolver on installations
      // where it incorrectly reports a present provider env key as missing.
      extensions: cfg.baseUrl || launcherKey ? [LAUNCHER_PROVIDER_EXTENSION] : [],
      trustProject: cfg.trustProject,
    });

    const pp = this._spawnPersistentProc(channel, {
      piBin,
      args,
      workingDir,
      env: this._buildEnv(),
      sessionId,
    });
    if (pp.spawnError) throw new Error(pp.spawnError);
    return pp;
  }

  async _handleMessage(msg) {
    let content = (msg.content || '').trim();
    const attachments = msg.attachments || [];
    const channel = msg.sessionId || this.channelName || 'general';

    this._stoppingChannels.delete(channel);

    if (!content && !attachments.length) return;

    // Validate the working directory BEFORE any expensive work (attachment
    // downloads, prompt assembly) — never silently fall back to another dir.
    const workingDir = this.workingDir || defaultAgentWorkdir(this.agentName);
    if (this.workingDir && !this._dirExists(this.workingDir)) {
      await this.sendError(channel, `Working directory does not exist: ${this.workingDir}`);
      return;
    }

    const { images, rest } = await this._prepareAttachments(channel, attachments);
    const attText = formatAttachmentsForPrompt(rest, 'skills');
    if (attText) content = content ? content + attText : attText.trim();
    if (!content && !images.length) return;
    if (!content) content = 'Please look at the attached image(s).';

    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing message from ${sender} in ${channel}: ${this._redact(content.slice(0, 80))}...`);

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

    let browserEnabled = false;
    try { browserEnabled = await this.getBrowserEnabled(); } catch {}
    const systemPrompt = '\n' + buildPiSystemPrompt({
      agentName: this.agentName,
      workspaceId: this.workspaceId,
      channelName: channel,
      endpoint: this.endpoint,
      token: this.token,
      mode: this._mode,
      disabledModules: this.disabledModules,
      browserEnabled,
    });

    // The stop may have arrived during the status and prompt-building round
    // trips above, when there was no process for it to kill. Starting the CLI
    // now would run exactly what the user cancelled.
    if (this._turnWasStopped(channel, msg)) {
      this._log(`Not starting a run in ${channel} — the user stopped it first`);
      await this._postStopNotice(channel);
      return;
    }

    let pp;
    try {
      pp = await this._ensureProc(channel, workingDir, systemPrompt);
    } catch (e) {
      await this.sendError(channel, this._redact(e && e.message) || 'Could not start the Pi CLI.');
      return;
    }

    // Fresh per-turn accounting.
    pp.msgChannel = channel;
    pp.turnTexts = [];
    pp.heldTexts = [];
    pp.turnError = null;
    pp.everPosted = false;
    pp.awaitingToolResult = false;
    pp.acc.reset();

    const turn = {};
    turn.promise = new Promise((resolve) => { turn.resolve = resolve; });
    pp.turn = turn;
    pp.turnInFlight = true;
    this._startWatchdog(pp);

    const command = { type: 'prompt', message: content };
    if (images.length) command.images = images;

    let accepted;
    try {
      accepted = await this._sendRpc(pp, command);
    } catch (e) {
      pp.turnInFlight = false;
      pp.turn = null;
      this._stopWatchdog(pp);
      await this._reportTurnFailure(pp, channel, e);
      return;
    }

    if (!accepted.success) {
      pp.turnInFlight = false;
      pp.turn = null;
      this._stopWatchdog(pp);
      const { userMessage } = classifyPiError(accepted.error || 'Pi rejected the prompt.');
      await this.sendError(channel, this._redact(userMessage));
      return;
    }

    // Pi acknowledges acceptance immediately; the turn ends at `agent_settled`
    // (or when the process dies / the user stops it).
    await turn.promise;
    this._stopWatchdog(pp);
    pp.turnInFlight = false;

    if (pp.userStopped || this._stoppingChannels.has(channel)) {
      if (!pp.everPosted) await this._postStopNotice(channel);
      pp.userStopped = false;
      return;
    }
    if (pp.watchdogKilled) {
      pp.watchdogKilled = false;
      return; // the watchdog already told the user
    }

    await this._postTurnOutcome(pp, channel);
    if (this._persistentProcs[channel] === pp) this._resetIdleTimer(channel);
  }

  /** Classify + surface a failure that happened before the turn even started. */
  async _reportTurnFailure(pp, channel, error) {
    const raw = (error && error.message) || String(error);
    if (error instanceof PiCancelledError && (pp.userStopped || this._stoppingChannels.has(channel))) {
      await this._postStopNotice(channel);
      return;
    }
    const { kind, userMessage } = classifyPiError(raw);
    if (kind === 'auth') this._reportStatus(REASON.LOGIN_REQUIRED, 'Pi is not authenticated');
    await this.sendError(channel, this._redact(userMessage));
  }

  /**
   * Post the outcome of a settled turn: the final answer, or a classified
   * error, or — when Pi produced neither — an explicit notice so the thread
   * never hangs on "thinking…".
   */
  async _postTurnOutcome(pp, channel) {
    const finalText = (pp.turnTexts || []).join('\n').trim();
    if (pp.turnError) {
      const { kind, userMessage } = classifyPiError(pp.turnError);
      if (kind === 'auth') {
        this._reportStatus(REASON.LOGIN_REQUIRED, 'Pi provider credentials were rejected');
      } else {
        this._reportStatus(null);
      }
      try { await this.sendError(channel, this._redact(userMessage)); } catch {}
      return;
    }
    this._reportStatus(null);
    if (finalText) {
      try { await this.sendResponse(channel, finalText); } catch {}
      return;
    }
    if (!pp.everPosted) {
      const stderr = this._redact((pp.stderrBuf || '').trim()).slice(-400);
      try {
        await this.sendError(
          channel,
          'Pi finished without producing a response.' + (stderr ? `\n\nLast diagnostics:\n${stderr}` : ''),
        );
      } catch {}
    }
  }
}

module.exports = PiAdapter;
module.exports.PiCancelledError = PiCancelledError;
