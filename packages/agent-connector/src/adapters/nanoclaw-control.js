/**
 * NanoClaw control-plane client + environment detection.
 *
 * Management/detection uses NanoClaw's official host control socket
 * `<home>/data/ncl.sock` (the same surface the `ncl` binary speaks). One
 * line-delimited JSON RequestFrame `{id,command,args}` per connection; the
 * host replies with one ResponseFrame `{id,ok,data}` / `{id,ok,false,error}`
 * and closes. We use ONLY `open`-access read commands (`*-list`, `*-get`) —
 * NanoClaw gates create/update/delete behind human approval, so the bridge
 * never silently mutates groups, messaging groups, or wirings.
 *
 * See [[nanoclaw-facts-and-arch]] for the verified contract.
 */

'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const { redactSecrets } = require('./nanoclaw-protocol');

const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// Path helpers (DATA_DIR = <home>/data, per NanoClaw src/config.ts)
// ---------------------------------------------------------------------------

function dataDir(home) {
  return path.join(home, 'data');
}
function nclSocketPath(home) {
  return path.join(home, 'data', 'ncl.sock');
}
/**
 * Dedicated local-IPC dir for the `openagents` channel. Kept SEPARATE from
 * NanoClaw's `data/` so we can lock it to 0700 without touching NanoClaw's own
 * files. Holds the bridge socket (0600) and the handshake secret (0600).
 */
function bridgeSocketDir(home) {
  return path.join(home, 'data', 'openagents');
}
/** Local IPC socket owned by the native `openagents` channel we ship. */
function bridgeSocketPath(home) {
  return path.join(bridgeSocketDir(home), 'bridge.sock');
}
/** File holding the random per-host handshake secret (channel writes, bridge reads). */
function bridgeSecretPath(home) {
  return path.join(bridgeSocketDir(home), 'secret');
}

// ---------------------------------------------------------------------------
// Local-IPC security helpers (shared by the bridge; the channel mirrors these
// in openagents.ts). All best-effort + cross-platform: Unix enforces via file
// mode + ownership, every platform enforces via the random secret.
// ---------------------------------------------------------------------------

/** lstat without following symlinks; null if missing. */
function _lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * Is `p` safe to use as a local-trust path? It must NOT be a symlink (blocks
 * path-escape / redirection). Returns {ok, reason}.
 */
function isPathSafe(p) {
  const st = _lstat(p);
  if (st && st.isSymbolicLink()) return { ok: false, reason: 'path is a symlink' };
  return { ok: true };
}

/**
 * Ensure the IPC dir exists, is a real directory we own, is not a symlink, and
 * is not group/other-accessible. Creates it 0700 if missing. Best-effort on
 * Windows (mode bits are advisory there — the secret is the real guard).
 * @returns {{ok:boolean, reason?:string}}
 */
function ensureSecureDir(dir) {
  const st = _lstat(dir);
  if (st && st.isSymbolicLink()) return { ok: false, reason: 'ipc dir is a symlink' };
  if (st && !st.isDirectory()) return { ok: false, reason: 'ipc dir path is not a directory' };
  if (!st) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      return { ok: false, reason: `mkdir failed: ${e.message}` };
    }
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best-effort (Windows) */
  }
  if (!IS_WINDOWS) {
    const after = _lstat(dir);
    if (after) {
      if (typeof process.getuid === 'function' && after.uid !== process.getuid()) {
        return { ok: false, reason: 'ipc dir is owned by another user' };
      }
      if (after.mode & 0o077) return { ok: false, reason: 'ipc dir is group/other-accessible' };
    }
  }
  return { ok: true };
}

/**
 * Read the handshake secret. The file must be a regular file (not a symlink)
 * and, on Unix, not group/other-readable. Returns the secret string or null.
 */
function readBridgeSecret(home) {
  const p = bridgeSecretPath(home);
  const st = _lstat(p);
  if (!st || st.isSymbolicLink() || !st.isFile()) return null;
  if (!IS_WINDOWS && st.mode & 0o077) return null; // refuse a world/group-readable secret
  try {
    const s = fs.readFileSync(p, 'utf-8').trim();
    return s || null;
  } catch {
    return null;
  }
}

/**
 * Unlink `p` ONLY if it is an actual socket file — never a regular file,
 * directory, or symlink. Prevents stale-cleanup from destroying user data.
 * @returns {{removed:boolean, reason?:string}}
 */
function safeUnlinkSocket(p) {
  const st = _lstat(p);
  if (!st) return { removed: false };
  if (st.isSymbolicLink()) return { removed: false, reason: 'refusing to unlink a symlink' };
  if (!st.isSocket()) return { removed: false, reason: 'refusing to unlink a non-socket file' };
  try {
    fs.unlinkSync(p);
    return { removed: true };
  } catch (e) {
    return { removed: false, reason: e.message };
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Does `dir` look like a NanoClaw checkout? */
function looksLikeNanoclaw(dir) {
  try {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg && pkg.name === 'nanoclaw') return true;
      } catch {
        /* fall through */
      }
    }
    // Structural fallback: bin/ncl + src/index.ts (+ src/channels)
    return (
      fs.existsSync(path.join(dir, 'bin', 'ncl')) &&
      fs.existsSync(path.join(dir, 'src', 'index.ts')) &&
      fs.existsSync(path.join(dir, 'src', 'channels'))
    );
  } catch {
    return false;
  }
}

/** Follow `ncl` on PATH back to the checkout root (bin/ncl → <root>). */
function homeFromNclBinary() {
  try {
    const which = IS_WINDOWS ? 'where' : 'which';
    const out = execFileSync(which, ['ncl'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)[0]
      .trim();
    if (!out) return null;
    let real = out;
    try {
      real = fs.realpathSync(out);
    } catch {
      /* use as-is */
    }
    // bin/ncl → dirname(bin) → root
    const root = path.dirname(path.dirname(real));
    return looksLikeNanoclaw(root) ? root : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the NanoClaw checkout directory.
 * Priority: $NANOCLAW_HOME → `ncl` on PATH → common locations.
 * @returns {{home:string, source:string}|null}
 */
function findNanoclawHome(env = process.env) {
  const explicit = env.NANOCLAW_HOME && env.NANOCLAW_HOME.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (looksLikeNanoclaw(resolved)) return { home: resolved, source: 'NANOCLAW_HOME' };
    // Honour the user's intent even if structure check is imperfect, but flag it.
    return { home: resolved, source: 'NANOCLAW_HOME', unverified: true };
  }

  const fromBin = homeFromNclBinary();
  if (fromBin) return { home: fromBin, source: 'ncl-on-path' };

  const home = env.HOME || env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(home, 'nanoclaw'),
    path.join(home, '.nanoclaw'),
    path.join(home, 'src', 'nanoclaw'),
    path.join(home, 'code', 'nanoclaw'),
    path.join(home, 'projects', 'nanoclaw'),
    path.join(home, 'dev', 'nanoclaw'),
  ];
  for (const c of candidates) {
    if (looksLikeNanoclaw(c)) return { home: c, source: 'discovered' };
  }
  return null;
}

function whichSafe(bin) {
  try {
    const which = IS_WINDOWS ? 'where' : 'which';
    const out = execFileSync(which, [bin], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)[0]
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function checkNode() {
  const bin = whichSafe('node');
  if (!bin) return { present: false };
  try {
    const v = execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
    return { present: true, version: v };
  } catch {
    return { present: true };
  }
}

function checkPackageManager() {
  const pnpm = whichSafe('pnpm');
  if (pnpm) return { present: true, manager: 'pnpm', path: pnpm };
  const npm = whichSafe('npm');
  if (npm) return { present: true, manager: 'npm', path: npm };
  return { present: false };
}

/**
 * Check Docker: installed AND daemon reachable. `docker info` exit 0 ⇒ running.
 * `runner` is injectable for tests.
 * @returns {Promise<{installed:boolean, running:boolean, detail:string}>}
 */
function checkDocker(runner) {
  const run =
    runner ||
    ((cmd, args, cb) =>
      execFile(cmd, args, { timeout: 8000, encoding: 'utf-8' }, (err, stdout, stderr) =>
        cb(err, stdout, stderr),
      ));
  return new Promise((resolve) => {
    const dockerBin = whichSafe('docker');
    if (!dockerBin) {
      resolve({ installed: false, running: false, detail: 'docker binary not found' });
      return;
    }
    run('docker', ['info', '--format', '{{.ServerVersion}}'], (err, stdout, stderr) => {
      if (err) {
        resolve({
          installed: true,
          running: false,
          detail: redactSecrets(((stderr || '') + (err.message || '')).slice(0, 200)),
        });
        return;
      }
      resolve({ installed: true, running: true, detail: String(stdout || '').trim() });
    });
  });
}

// ---------------------------------------------------------------------------
// Control socket client
// ---------------------------------------------------------------------------

class NclControlError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'NclControlError';
    this.nclCode = code || 'transport-error';
  }
}

class NclControl {
  /**
   * @param {string} socketPath  path to data/ncl.sock
   * @param {{timeoutMs?:number}} [opts]
   */
  constructor(socketPath, opts = {}) {
    this.socketPath = socketPath;
    this.timeoutMs = opts.timeoutMs || 8000;
    this._seq = 0;
  }

  _nextId() {
    this._seq += 1;
    return `oa-${Date.now().toString(36)}-${this._seq}`;
  }

  /**
   * Send one command, await one response. Resolves with `data`, rejects with
   * an NclControlError carrying `.nclCode` on host-reported failure.
   * @param {string} command  e.g. 'groups-list'
   * @param {object} [args]
   * @returns {Promise<unknown>}
   */
  request(command, args = {}) {
    const id = this._nextId();
    const frame = JSON.stringify({ id, command, args }) + '\n';
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      const client = net.createConnection(this.socketPath);

      const done = (fn, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          client.end();
        } catch {
          /* best-effort */
        }
        try {
          client.destroy();
        } catch {
          /* best-effort */
        }
        fn(val);
      };

      const timer = setTimeout(
        () => done(reject, new NclControlError(`ncl control request timed out: ${command}`, 'timeout')),
        this.timeoutMs,
      );

      client.on('connect', () => client.write(frame));
      client.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const idx = buffer.indexOf('\n');
        if (idx < 0) {
          // Bound the buffer: a peer streaming without a newline would otherwise
          // grow memory unbounded. Control responses are small JSON lines.
          if (buffer.length > 8 * 1024 * 1024) {
            done(reject, new NclControlError('ncl control response exceeded size limit without a newline', 'transport-error'));
          }
          return;
        }
        const line = buffer.slice(0, idx);
        let resp;
        try {
          resp = JSON.parse(line);
        } catch (e) {
          done(reject, new NclControlError(`malformed ncl response: ${e.message}`, 'transport-error'));
          return;
        }
        if (resp && resp.ok) {
          done(resolve, resp.data);
        } else {
          const err = (resp && resp.error) || {};
          done(reject, new NclControlError(redactSecrets(err.message || 'ncl error'), err.code || 'handler-error'));
        }
      });
      client.on('error', (err) => {
        const code = err && err.code === 'ENOENT' ? 'host-not-running' : err && err.code === 'ECONNREFUSED' ? 'host-not-running' : 'transport-error';
        done(reject, new NclControlError(redactSecrets(err.message || 'socket error'), code));
      });
      client.on('close', () => {
        if (!settled) done(reject, new NclControlError('host closed connection before responding', 'transport-error'));
      });
    });
  }

  /** Liveness probe — `groups-list` is an `open` command, safe to call. */
  async ping() {
    await this.request('groups-list', {});
    return true;
  }

  _asArray(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.rows)) return data.rows;
    if (data && Array.isArray(data.items)) return data.items;
    return data == null ? [] : [data];
  }

  async listGroups() {
    return this._asArray(await this.request('groups-list', {}));
  }
  async getGroup(id) {
    return this.request('groups-get', { id });
  }
  async listMessagingGroups(filters = {}) {
    return this._asArray(await this.request('messaging-groups-list', filters));
  }
  async listWirings(filters = {}) {
    return this._asArray(await this.request('wirings-list', filters));
  }
  async listSessions(filters = {}) {
    return this._asArray(await this.request('sessions-list', filters));
  }
}

/**
 * One-shot aggregate environment probe used at adapter start and for the
 * launcher/workspace status surface.
 * @returns {Promise<object>}
 */
async function detectEnvironment(env = process.env, opts = {}) {
  const homeInfo = findNanoclawHome(env);
  const node = checkNode();
  const pm = checkPackageManager();
  const docker = await checkDocker(opts.dockerRunner);

  const result = {
    installed: !!homeInfo,
    home: homeInfo ? homeInfo.home : null,
    homeSource: homeInfo ? homeInfo.source : null,
    node,
    packageManager: pm,
    docker,
    hostRunning: false,
    nclSocket: null,
    bridgeSocket: null,
  };

  if (homeInfo) {
    result.nclSocket = nclSocketPath(homeInfo.home);
    result.bridgeSocket = bridgeSocketPath(homeInfo.home);
    // Host running iff the control socket exists AND answers.
    if (fs.existsSync(result.nclSocket)) {
      try {
        const ctl = new NclControl(result.nclSocket, { timeoutMs: opts.pingTimeoutMs || 4000 });
        await ctl.ping();
        result.hostRunning = true;
      } catch {
        result.hostRunning = false;
      }
    }
  }
  return result;
}

module.exports = {
  dataDir,
  nclSocketPath,
  bridgeSocketDir,
  bridgeSocketPath,
  bridgeSecretPath,
  isPathSafe,
  ensureSecureDir,
  readBridgeSecret,
  safeUnlinkSocket,
  looksLikeNanoclaw,
  findNanoclawHome,
  checkNode,
  checkPackageManager,
  checkDocker,
  detectEnvironment,
  NclControl,
  NclControlError,
};
