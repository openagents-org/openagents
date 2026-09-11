/**
 * The Windows/WSL boundary — making agent CLIs on the other side of it both
 * DETECTABLE and RUNNABLE.
 *
 * Two setups reported the same symptom ("my agent is installed, the launcher
 * says Not installed"), and they are mirror images of each other:
 *
 *   1. Launcher/daemon on native Windows, the agent CLI installed inside a WSL
 *      distro. Every tier of the existing detection (`where`, %APPDATA%\npm,
 *      ~/.openagents, the known-bin-dir sweep in paths.js) looks at the Windows
 *      filesystem only, so a perfectly good `claude` at
 *      /home/<user>/.nvm/versions/node/v22.14.0/bin/claude is invisible. Hermes
 *      grew a one-off fallback for exactly this (adapters/hermes.js) and no
 *      other agent had one.
 *   2. Connector running INSIDE a distro, the agent CLI installed on the
 *      Windows side. `which claude` misses because the file is `claude.cmd`,
 *      and even when found, a Windows shim cannot be exec'd from Linux.
 *
 * The representation stays a plain string, so detection keeps its signatures
 * and only the SPAWN site needs to know the difference: an in-distro binary
 * comes back prefixed, as `wsl:/home/u/.local/bin/claude`. The prefix is there
 * rather than relying on "an absolute path starting with / on win32" because
 * that inference is silently wrong for any caller that deals in POSIX paths on
 * Windows for its own reasons — it would bridge a path nobody meant as WSL, and
 * a marker that can be triggered by accident is worse than no marker.
 *
 * The mirror direction needs no marker: a path ending in .exe/.cmd/.bat while
 * we are running inside a distro is unambiguously a Windows binary.
 *
 * Cost: resolution never spawns wsl.exe per binary. One probe per process
 * (30s TTL) reads the distro's login PATH, and every later lookup is a
 * filesystem check through the \\wsl.localhost UNC mount — which Windows serves
 * without starting a distro session.
 */

'use strict';

const fs = require('fs');
const { spawn: nodeSpawn, execFileSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const PROBE_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 30 * 1000;

/** Marks a resolved path as living inside the distro: `wsl:/home/u/bin/claude`. */
const WSL_PREFIX = 'wsl:';

/** Env names that must never cross the boundary: each side has its own. */
const ENV_NEVER_FORWARD = new Set(
  [
    'PATH', 'HOME', 'USER', 'USERNAME', 'USERPROFILE', 'LOGNAME', 'SHELL',
    'PWD', 'OLDPWD', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA',
    'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'SYSTEMROOT',
    'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'WSLENV', 'WSL_DISTRO_NAME',
    'WSL_INTEROP', 'NODE_OPTIONS', 'NVM_DIR', 'NVM_BIN', 'VOLTA_HOME',
    // getEnhancedEnv() sets LANG for the Windows console's benefit. Ubuntu
    // generates C.UTF-8 and not en_US.UTF-8, so forwarding it makes every CLI
    // in the distro open with a setlocale warning it had no reason to print.
    'LANG', 'LC_ALL',
  ].map((n) => n.toUpperCase()),
);

// ---------------------------------------------------------------------------
// Which side of the boundary are we on?
// ---------------------------------------------------------------------------

let inWslCache;

/**
 * True when THIS process is running inside a WSL distro.
 *
 * WSL_DISTRO_NAME is set by modern WSL but is lost by anything that sanitises
 * the environment, so the kernel release string — which carries "microsoft" on
 * both WSL1 and WSL2 — is the authority and the env var only a fast path.
 */
function isRunningInWsl() {
  if (inWslCache !== undefined) return inWslCache;
  inWslCache = false;
  if (process.platform !== 'linux') return inWslCache;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    inWslCache = true;
    return inWslCache;
  }
  try {
    const release = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf-8');
    inWslCache = /microsoft|wsl/i.test(release);
  } catch {
    /* not Linux-with-procfs — leave false */
  }
  return inWslCache;
}

// ---------------------------------------------------------------------------
// Windows side: is there a distro to talk to at all?
// ---------------------------------------------------------------------------

let distrosCache = { value: null, at: 0 };

/**
 * Registered, non-broken distro names, default first.
 *
 * `wsl.exe -l -q` writes UTF-16LE (it is one of wsl.exe's own management
 * commands, unlike `-e` which passes the child's bytes straight through), so it
 * is read as a buffer and decoded explicitly — a utf-8 read yields NUL-riddled
 * garbage that no name ever matches.
 *
 * An empty list is the normal answer on a machine where `wsl --install` was
 * never finished: wsl.exe EXISTS in System32 on every Windows 11 install, so
 * its presence proves nothing and only a registered distro does.
 */
function wslDistros() {
  if (!IS_WINDOWS) return [];
  if (distrosCache.value && Date.now() - distrosCache.at < CACHE_TTL_MS) {
    return [...distrosCache.value];
  }
  let names = [];
  try {
    const buf = execFileSync('wsl.exe', ['-l', '-q'], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
    names = buf
      .toString('utf16le')
      .split(/\r?\n/)
      .map((l) => l.replace(/\0/g, '').trim())
      .filter(Boolean);
  } catch {
    names = [];
  }
  distrosCache = { value: names, at: Date.now() };
  return [...names];
}

/** True when a WSL distro is registered and reachable from this Windows host. */
function isWslAvailable() {
  return IS_WINDOWS && wslDistros().length > 0;
}

/** The distro every bridged command targets — wsl.exe's own default. */
function defaultDistro() {
  return wslDistros()[0] || null;
}

// ---------------------------------------------------------------------------
// Windows side: reaching into the distro's filesystem without starting one
// ---------------------------------------------------------------------------

let uncRootCache = { value: null, at: 0 };

/**
 * The UNC prefix that maps the default distro's root into Windows, or null.
 * WSL2 serves \\wsl.localhost\<distro>; WSL1 and older builds only \\wsl$\.
 */
function _uncRoot() {
  if (uncRootCache.at && Date.now() - uncRootCache.at < CACHE_TTL_MS) {
    return uncRootCache.value;
  }
  const distro = defaultDistro();
  if (!distro) return null;
  let root = null;
  for (const prefix of ['\\\\wsl.localhost\\', '\\\\wsl$\\']) {
    const candidate = prefix + distro;
    try {
      if (fs.existsSync(candidate)) { root = candidate; break; }
    } catch {
      /* an unreachable share throws rather than returning false */
    }
  }
  uncRootCache = { value: root, at: Date.now() };
  return root;
}

/**
 * The distro's $HOME as a path Windows can read, or null.
 *
 * An agent installed in WSL keeps its sign-in where IT lives — ~/.claude,
 * ~/.gemini, ~/.codex inside the distro — so a readiness check that expands "~"
 * against the Windows profile finds nothing and calls a signed-in agent
 * "Not logged in".
 */
function wslHomeUnc() {
  const home = _shellProbe().home;
  return home ? toUncPath(home) : null;
}

/** Map an in-distro absolute path to the UNC path Windows can stat. */
function toUncPath(linuxPath) {
  const root = _uncRoot();
  if (!root || !linuxPath || !linuxPath.startsWith('/')) return null;
  return root + linuxPath.replace(/\//g, '\\');
}

// ---------------------------------------------------------------------------
// Windows side: what the distro's login shell would put on PATH
// ---------------------------------------------------------------------------

const PROBE_DELIM = '__OPENAGENTS_WSL__';
let shellProbeCache = { value: null, at: 0 };

/**
 * One wsl.exe call per process (30s TTL) that answers everything later lookups
 * need: the login PATH, $HOME, and the real automount root.
 *
 * `bash -ilc` — INTERACTIVE as well as login — because the version managers
 * that actually hold the agent CLIs write to ~/.bashrc, and Ubuntu's stock
 * ~/.bashrc returns early for a non-interactive shell BEFORE the nvm/fnm block
 * at the bottom ever runs. A plain `-lc` therefore reports a PATH with no nvm
 * in it, which is precisely the install this whole module exists to find.
 * stderr is dropped: an interactive shell with no tty warns about job control.
 */
function _shellProbe() {
  const empty = { dirs: [], home: null, automount: '/mnt/' };
  if (shellProbeCache.at && Date.now() - shellProbeCache.at < CACHE_TTL_MS) {
    return shellProbeCache.value || empty;
  }
  if (!isWslAvailable()) return empty;

  const script =
    'echo ' + PROBE_DELIM + '; echo "$PATH"; echo "$HOME"; ' +
    "wslpath -u 'C:\\' 2>/dev/null || echo /mnt/c/";

  let out = null;
  for (const argv of [['-e', 'bash', '-ilc', script], ['-e', 'sh', '-lc', script]]) {
    try {
      const raw = execFileSync('wsl.exe', argv, {
        encoding: 'utf-8',
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 4 * 1024 * 1024,
      });
      const idx = raw.indexOf(PROBE_DELIM);
      if (idx === -1) continue;
      const lines = raw.slice(idx + PROBE_DELIM.length).split(/\r?\n/).map((l) => l.trim());
      const pathLine = lines[1];
      const homeLine = lines[2];
      const cRoot = lines[3];
      if (!pathLine) continue;
      const dirs = [];
      for (const d of pathLine.split(':')) {
        const dir = d.trim();
        // /mnt/<drive> entries are the Windows PATH bounced back by interop.
        // They hold Windows binaries, never the in-distro install we are after.
        if (dir && dir.startsWith('/') && !/^\/mnt\/[a-z]\//i.test(dir) && !dirs.includes(dir)) {
          dirs.push(dir);
        }
      }
      // `wslpath -u 'C:\'` answers /mnt/c/ by default, but /etc/wsl.conf can
      // move the automount root — derive it rather than hardcoding /mnt.
      let automount = '/mnt/';
      const m = /^(\/.*\/)c\/?$/i.exec(cRoot || '');
      if (m) automount = m[1];
      out = { dirs, home: homeLine && homeLine.startsWith('/') ? homeLine : null, automount };
      break;
    } catch {
      /* try the next shell */
    }
  }
  shellProbeCache = { value: out || empty, at: Date.now() };
  return shellProbeCache.value;
}

/**
 * Every in-distro directory an agent CLI can plausibly live in: the login
 * PATH first (it is the ground truth for how the user installed things), then
 * the same curated set paths.js keeps for native Linux, so a CLI whose
 * installer only edited a shell rc file we could not read is still found.
 */
function wslBinDirs() {
  const probe = _shellProbe();
  const dirs = [...probe.dirs];
  const home = probe.home;
  const push = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  if (home) {
    push(home + '/.local/bin');
    push(home + '/.npm-global/bin');
    push(home + '/.openagents/nodejs/node_modules/.bin');
    push(home + '/.cursor/bin');
    push(home + '/.amp/bin');
    push(home + '/.opencode/bin');
    push(home + '/.cargo/bin');
    push(home + '/bin');
  }
  push('/usr/local/bin');
  push('/usr/bin');
  push('/home/linuxbrew/.linuxbrew/bin');
  return dirs;
}

const wslBinaryCache = new Map();

/**
 * Resolve an agent binary inside the default distro, or null.
 *
 * Returns the path as the DISTRO sees it, behind the `wsl:` marker
 * (`wsl:/home/u/.local/bin/claude`) — the inner path is what `wsl.exe -e` must
 * be handed. Existence is proved through the UNC mount, so a machine with WSL
 * installed but no distro pays nothing beyond the single cached distro listing.
 *
 * @param {string|string[]} names binary name(s), e.g. 'claude' or ['cursor-agent','agent']
 * @returns {string|null} marked in-distro path
 */
function resolveWslBinary(names) {
  if (!IS_WINDOWS) return null;
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (!list.length) return null;
  const key = list.join('\0');
  const cached = wslBinaryCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let value = null;
  if (isWslAvailable() && _uncRoot()) {
    const dirs = wslBinDirs();
    search:
    for (const dir of dirs) {
      for (const name of list) {
        const linuxPath = dir.replace(/\/+$/, '') + '/' + name;
        const unc = toUncPath(linuxPath);
        if (!unc) continue;
        try {
          if (fs.existsSync(unc) && fs.statSync(unc).isFile()) {
            value = WSL_PREFIX + linuxPath;
            break search;
          }
        } catch {
          /* unreadable path — keep looking */
        }
      }
    }
  }
  wslBinaryCache.set(key, { value, at: Date.now() });
  return value;
}

/**
 * Forget which binaries were found, so an agent installed into the distro while
 * the launcher is already running is picked up. Called from
 * paths.clearBinaryLookupCache(); the distro listing and the login-shell probe
 * survive it deliberately — they each cost a wsl.exe start, and they describe
 * the machine rather than any one install.
 */
function clearWslBinaryCache() {
  wslBinaryCache.clear();
}

/** Full reset, including the per-process probes. For tests and rare rescans. */
function clearWslCache() {
  distrosCache = { value: null, at: 0 };
  uncRootCache = { value: null, at: 0 };
  shellProbeCache = { value: null, at: 0 };
  wslBinaryCache.clear();
}

// ---------------------------------------------------------------------------
// Classifying a resolved binary
// ---------------------------------------------------------------------------

/** A binary that lives inside WSL and must be run through wsl.exe. */
function isWslBinary(bin) {
  return typeof bin === 'string' && bin.startsWith(WSL_PREFIX);
}

/** The in-distro path behind the marker, for anything that has to see it raw. */
function wslBinaryPath(bin) {
  return isWslBinary(bin) ? bin.slice(WSL_PREFIX.length) : bin;
}

/**
 * A Windows binary seen from inside a distro, classified by whether it can
 * actually be run from here:
 *   'exe'  — a real PE image; Linux exec + WSL interop runs it with argv intact.
 *   'shim' — a .cmd/.bat batch file. Only cmd.exe can run one, and cmd.exe
 *            rebuilds its command line from a single string, so every &, |, ^,
 *            > and " in a prompt would be reinterpreted as shell syntax. We
 *            refuse rather than corrupt (or worse, execute) user text.
 *
 * `inWsl` is injectable for the same reason win-exec.ts injects its platform:
 * this branch only ever runs inside a distro, and a test that can only run
 * there is a test that never runs.
 */
function windowsBinaryKind(bin, inWsl = isRunningInWsl()) {
  if (!inWsl || typeof bin !== 'string') return null;
  if (/\.exe$/i.test(bin)) return 'exe';
  if (/\.(cmd|bat)$/i.test(bin)) return 'shim';
  return null;
}

/** Path as the Windows side sees it (best effort; UNC for in-distro paths). */
function toWindowsPath(p) {
  if (!p || !p.startsWith('/')) return p;
  const root = isRunningInWsl() ? '/mnt/' : _shellProbe().automount;
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('^' + escaped + '([a-z])(/|$)', 'i').exec(p);
  if (m) {
    return m[1].toUpperCase() + ':\\' + p.slice(m[0].length).replace(/\//g, '\\');
  }
  if (isRunningInWsl()) {
    const distro = process.env.WSL_DISTRO_NAME;
    return distro ? '\\\\wsl.localhost\\' + distro + p.replace(/\//g, '\\') : p;
  }
  return toUncPath(p) || p;
}

/** Path as the distro sees it (best effort; drive letters only). */
function toWslPath(p) {
  if (!p || !/^[A-Za-z]:[\\/]/.test(p)) return p;
  const root = isRunningInWsl() ? '/mnt/' : _shellProbe().automount;
  return root + p[0].toLowerCase() + '/' + p.slice(3).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// The spawn bridge
// ---------------------------------------------------------------------------

/**
 * Which environment entries should cross into the distro.
 *
 * Only what the CALLER added on top of this process's own environment: those
 * are the agent's credentials, endpoints and workspace settings, and they are
 * the entire reason a bridged agent would otherwise start up unauthenticated.
 * Anything inherited unchanged from Windows is dropped — the distro has its own
 * PATH/HOME/TEMP, and handing it Windows values breaks the shell before the
 * agent is even reached.
 */
function _forwardedEnvNames(env) {
  if (!env) return [];
  const names = [];
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue;
    if (ENV_NEVER_FORWARD.has(k.toUpperCase())) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, k) && process.env[k] === v) continue;
    names.push(k);
  }
  return names;
}

/**
 * WSLENV is the only channel Windows has for handing variables to a distro —
 * without it `wsl.exe -e` starts with a clean Linux environment and every
 * OPENAGENTS_* / *_API_KEY the adapter set is silently dropped.
 *
 * A value that is a Windows path gets the `/p` flag (and a `;`-separated list
 * of them `/l`) so WSL translates it on the way in, instead of handing the
 * agent a `D:\work` that means nothing on the other side.
 */
function _withWslEnv(env) {
  const out = { ...(env || process.env) };
  const entries = [];
  for (const name of _forwardedEnvNames(out)) {
    const value = String(out[name]);
    const looksLikePath = (s) => /^[A-Za-z]:[\\/]/.test(s);
    let flag = '';
    // The list test comes first: a `C:\a;D:\b` also matches the single-path
    // pattern on its first segment, and tagging it /p would hand the distro one
    // mangled string instead of a translated PATH-style list.
    if (value.includes(';') && value.split(';').filter(Boolean).every(looksLikePath)) {
      flag = '/l';
    } else if (looksLikePath(value)) {
      flag = '/p';
    }
    entries.push(name + flag);
  }
  if (out.WSLENV) entries.unshift(out.WSLENV);
  if (entries.length) out.WSLENV = entries.join(':');
  return out;
}

function _existsDir(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

/**
 * Translate argv entries that are Windows paths into the distro's view of them.
 *
 * Adapters pass real paths on the command line — `--add-dir D:\work`,
 * `--config C:\Users\…\settings.json` — and a Windows path handed to a Linux
 * process is simply a file that does not exist. The entry has to BE a path and
 * that path has to EXIST for it to be rewritten, so ordinary prompt text (which
 * is prose, and does not name a real file) is never touched.
 */
function _translateArgs(args) {
  return args.map((a) => {
    const s = String(a);
    if (!/^[A-Za-z]:[\\/]/.test(s)) return a;
    if (!_existsDir(s)) return a;
    return toWslPath(s);
  });
}

/**
 * Rewrite a (file, args, opts) triple so it runs on the right side of the
 * boundary. A no-op — the same triple back — for every ordinary local binary,
 * which is why callers can use it unconditionally.
 *
 * @throws {Error} when the binary is a Windows .cmd/.bat shim seen from inside
 *   WSL: there is no way to run one without letting cmd.exe re-parse the
 *   prompt, so the caller gets an actionable message instead of mangled input.
 *
 * @param {{inWsl?: boolean}} [seam] test injection — see windowsBinaryKind.
 */
function bridgeSpawn(file, args = [], opts = {}, seam = {}) {
  if (isWslBinary(file)) {
    return {
      file: 'wsl.exe',
      args: ['-e', wslBinaryPath(file), ..._translateArgs(args)],
      opts: {
        ...opts,
        env: _withWslEnv(opts.env),
        // wsl.exe inherits this process's Windows cwd and translates it for the
        // distro, so opts.cwd is handed through untouched — but only if it
        // really exists, since spawn() itself fails ENOENT otherwise and that
        // reads as "the agent isn't installed".
        cwd: opts.cwd && _existsDir(opts.cwd) ? opts.cwd : undefined,
        // A shell would be asked to run a Linux path as a Windows command, and
        // there is no process group to detach into on the far side of wsl.exe.
        shell: false,
        detached: false,
        windowsHide: true,
      },
    };
  }

  if (windowsBinaryKind(file, seam.inWsl) === 'shim') {
    throw new Error(
      'Cannot run the Windows CLI ' + file + ' from inside WSL: .cmd/.bat shims have to ' +
      'go through cmd.exe, which would re-interpret the prompt text. Install the agent ' +
      'inside this distro (e.g. npm install -g …), or run the launcher on Windows.',
    );
  }
  // A '.exe' needs no rewrite: WSL interop execs a PE image directly and
  // preserves argv exactly, unlike the shim case above.

  return { file, args, opts };
}

/**
 * child_process.spawn with the boundary handled. Same signature, same return —
 * drop-in for every adapter that spawns an agent CLI.
 */
function spawn(file, args = [], opts = {}) {
  const bridged = bridgeSpawn(file, args, opts);
  return nodeSpawn(bridged.file, bridged.args, bridged.opts);
}

/**
 * A shell command string that runs `<bin> <args…>` across the boundary, for the
 * execSync-based version/verify probes. Returns null when no bridging applies
 * and the caller should build its own command exactly as before.
 */
function bridgedCommandString(bin, args = []) {
  if (!isWslBinary(bin)) return null;
  const quoted = [wslBinaryPath(bin), ...args]
    .map((a) => '"' + String(a).replace(/"/g, '\\"') + '"')
    .join(' ');
  return 'wsl.exe -e ' + quoted;
}

module.exports = {
  isRunningInWsl,
  isWslAvailable,
  wslDistros,
  defaultDistro,
  wslBinDirs,
  wslHomeUnc,
  resolveWslBinary,
  clearWslBinaryCache,
  clearWslCache,
  isWslBinary,
  wslBinaryPath,
  windowsBinaryKind,
  toWindowsPath,
  toWslPath,
  toUncPath,
  bridgeSpawn,
  bridgedCommandString,
  spawn,
};
