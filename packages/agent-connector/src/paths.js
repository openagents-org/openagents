/**
 * Cross-platform PATH detection.
 *
 * Finds binary directories for Node.js version managers (nvm, fnm, volta),
 * package managers (npm, Homebrew, pip), and standard system locations.
 * Used by installer.js (binary detection) and daemon.js (agent spawning).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';
const SEP = IS_WINDOWS ? ';' : ':';
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const PATH_LOOKUP_CACHE_TTL_MS = 30 * 1000;

let extraBinDirsCache = { value: null, at: 0, path: '' };
const whichBinaryCache = new Map();

/**
 * Get all extra binary directories that should be checked beyond process.env.PATH.
 * Returns deduplicated list of existing directories.
 */
function getExtraBinDirs() {
  const currentPATH = process.env.PATH || '';
  if (
    extraBinDirsCache.value &&
    extraBinDirsCache.path === currentPATH &&
    Date.now() - extraBinDirsCache.at < PATH_LOOKUP_CACHE_TTL_MS
  ) {
    return [...extraBinDirsCache.value];
  }

  const dirs = [];

  if (IS_WINDOWS) {
    _addWindowsPaths(dirs);
  } else {
    _addUnixPaths(dirs);
    if (IS_MACOS) {
      _addMacPaths(dirs);
    }
  }

  // Common: ~/.local/bin (pipx, user installs)
  _push(dirs, path.join(HOME, '.local', 'bin'));

  // Every JS package manager's global bin, plus the npm prefix the user
  // actually configured. Shared by both platforms — an agent installed with
  // pnpm/bun/yarn is no less installed than one npm dropped.
  _addPackageManagerPaths(dirs);

  // CLIs whose own installer script picks a directory of its own.
  _addAgentInstallerPaths(dirs);

  // Aider (uv tool install) — its executable honors XDG_BIN_HOME /
  // XDG_DATA_HOME/../bin / ~/.local/bin and also always lands in the uv tools
  // venv. A GUI/daemon process won't see the installer's PATH edit, so add the
  // real install dirs explicitly (filtered to existing dirs by the caller).
  for (const d of aiderBinDirs()) _push(dirs, d);

  // Also add the directory containing the current node binary
  try {
    const nodeDir = path.dirname(process.execPath);
    if (nodeDir) _push(dirs, nodeDir);
  } catch {}

  // Add portable Node.js directory (~/.openagents/nodejs/)
  const portableNode = path.join(HOME, '.openagents', 'nodejs');
  _push(dirs, portableNode);

  // Core library bin (~/.openagents/core/node_modules/.bin)
  _push(dirs, path.join(HOME, '.openagents', 'core', 'node_modules', '.bin'));

  // Per-agent runtime bins (~/.openagents/runtimes/<type>/node_modules/.bin)
  const runtimesDir = path.join(HOME, '.openagents', 'runtimes');
  try {
    for (const d of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
      if (d.isDirectory()) _push(dirs, path.join(runtimesDir, d.name, 'node_modules', '.bin'));
    }
  } catch {}

  // Legacy: shared node_modules/.bin (for backward compat with pre-isolation installs)
  _push(dirs, path.join(portableNode, 'node_modules', '.bin'));

  // Last, and the widest net: whatever the user's login shell puts on PATH. See
  // loginShellDirs() for why a GUI launch needs this at all. Ranked below every
  // dir above so a copy this launcher installed still wins over a global one.
  for (const d of loginShellDirs()) _push(dirs, d);

  // Filter to existing directories only, deduplicate
  const seen = new Set();
  const value = dirs.filter(d => {
    if (!d || seen.has(d)) return false;
    // Skip if already in PATH (case-insensitive on Windows)
    if (IS_WINDOWS ? currentPATH.toLowerCase().includes(d.toLowerCase()) : currentPATH.includes(d)) return false;
    seen.add(d);
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  extraBinDirsCache = { value, at: Date.now(), path: currentPATH };
  return [...value];
}

/**
 * Build a full PATH string that includes all extra bin dirs prepended.
 */
function getEnhancedPATH() {
  const extra = getExtraBinDirs();
  const current = process.env.PATH || '';
  if (extra.length === 0) return current;
  return extra.join(SEP) + SEP + current;
}

/**
 * Build an env object with enhanced PATH for spawning subprocesses.
 */
function getEnhancedEnv(baseEnv) {
  const env = { ...(baseEnv || process.env) };
  const extra = getExtraBinDirs();
  if (extra.length > 0) {
    // Spreading process.env on Windows yields a "Path" key (not "PATH"), so a
    // bare `env.PATH = …` would create a SECOND key holding only the extra dirs
    // — no System32 — and libuv picks that truncated one when resolving spawned
    // executables (cmd.exe / where.exe become unfindable). Update the existing
    // case-insensitive path key in place instead.
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = extra.join(SEP) + SEP + (env[pathKey] || '');
  }
  if (IS_WINDOWS) {
    // Force UTF-8 output from child processes on non-English Windows locales
    env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';
    env.PYTHONUTF8 = env.PYTHONUTF8 || '1';
    env.LANG = env.LANG || 'en_US.UTF-8';
    // Ensure ComSpec points to cmd.exe (Electron may not set it)
    if (!env.ComSpec) {
      const sysRoot = env.SystemRoot || 'C:\\Windows';
      env.ComSpec = path.join(sysRoot, 'System32', 'cmd.exe');
    }
  }
  return env;
}

/**
 * Find a binary by name. Returns full path or null.
 */
function whichBinary(name) {
  if (!name) return null;
  const currentPATH = process.env.PATH || '';
  const cacheKey = `${name}\0${currentPATH}`;
  const cached = whichBinaryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PATH_LOOKUP_CACHE_TTL_MS) {
    return cached.value;
  }

  // On a non-English Windows the console OUTPUT codepage is OEM (e.g. 936/GBK on
  // zh-CN), so `where` prints a path whose non-ASCII bytes don't match the utf-8
  // decoding execSync does — a Chinese username comes back mangled (e.g.
  // `C:\Users\??.?[\…`) and yields ENOENT downstream. We can't reliably re-encode
  // it (and forcing `chcp` is unsafe under windowsHide's console-less cmd), so we
  // existence-check every hit and only return one that's real; a mangled path
  // fails and the caller falls through to its Node-derived tiers (built from
  // process.env / os.homedir, which the OS hands us as correct UTF-16).
  const cmd = IS_WINDOWS ? `where ${name}` : `which ${name}`;
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: getEnhancedPATH() },
      timeout: 5000,
      windowsHide: true,
    });
    const hits = [];
    for (const line of result.split(/\r?\n/)) {
      const hit = line.trim();
      if (hit && fs.existsSync(hit)) hits.push(hit);
    }
    let value = hits[0] || null;
    if (IS_WINDOWS && hits.length) {
      // `where` can list npm's extensionless POSIX shim (node_modules/.bin/
      // claude, a sh script) ahead of claude.cmd. Windows cannot execute that
      // file — spawning it fails and the probe misreports an installed CLI as
      // "not installed" while the chat adapters (which prefer .cmd) work fine.
      // Prefer a hit Windows can run; failing that, a runnable sibling of the
      // shim; only then fall back to the raw first hit.
      const RUNNABLE = /\.(cmd|exe|bat|com)$/i;
      const runnable = hits.find((h) => RUNNABLE.test(h));
      if (runnable) {
        value = runnable;
      } else {
        for (const h of hits) {
          const sibling = ['.cmd', '.exe', '.bat'].map((e) => h + e).find((c) => fs.existsSync(c));
          if (sibling) { value = sibling; break; }
        }
      }
    }
    whichBinaryCache.set(cacheKey, { value, at: Date.now() });
    return value;
  } catch {
    whichBinaryCache.set(cacheKey, { value: null, at: Date.now() });
    return null;
  }
}

/**
 * Codepage-safe `where`/`which` lookup, shared by every CLI adapter.
 *
 * Hazard: on a non-English Windows the console output codepage is OEM (e.g.
 * 936/GBK on zh-CN), so execSync decodes `where` stdout with the wrong codepage
 * and mangles a non-ASCII (e.g. Chinese) username in the path — yielding ENOENT
 * downstream (the `C:\Users\??.?[\…\claude.cmd` failure). Two safe defenses,
 * no `chcp` (which is unreliable under windowsHide's console-less cmd):
 *   1. (Windows) check the npm-global default `%APPDATA%\npm\<name>.cmd` FIRST.
 *      APPDATA comes from the OS as UTF-16 via Node, so this path is always
 *      correctly encoded — and it's where the npm-installed CLIs actually live.
 *   2. Fall back to `where`/`which`, but existence-check every hit so a mangled
 *      path is skipped and the caller drops to its own Node-derived tiers.
 *
 * @param {string|string[]} names  base name(s), e.g. 'claude' or ['cursor-agent','agent'].
 *                                  On Windows each is tried as <name>.cmd, <name>.exe, <name>.
 * @param {object} [env]           env for the lookup (defaults to getEnhancedEnv()).
 * @returns {string|null}          an existing absolute path, or null.
 */
function whereBinary(names, env) {
  const bases = Array.isArray(names) ? names : [names];

  // 1. npm-global default, derived from Node's env (correct encoding even when
  //    the username is non-ASCII). This is where `npm i -g <cli>` drops the shim.
  if (IS_WINDOWS && process.env.APPDATA) {
    for (const b of bases) {
      const c = path.join(process.env.APPDATA, 'npm', `${b}.cmd`);
      try { if (fs.existsSync(c)) return c; } catch {}
    }
  }

  // 2. PATH lookup, existence-guarded.
  let cmd;
  if (IS_WINDOWS) {
    const parts = [];
    for (const b of bases) {
      parts.push(`where ${b}.cmd 2>nul`, `where ${b}.exe 2>nul`, `where ${b} 2>nul`);
    }
    cmd = parts.join(' || ');
  } else {
    cmd = bases.map((b) => `which ${b}`).join(' || ');
  }
  try {
    const out = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true,
      env: env || getEnhancedEnv(),
    });
    for (const line of out.split(/\r?\n/)) {
      const hit = line.trim();
      if (hit && fs.existsSync(hit)) return hit;
    }
  } catch {}
  return null;
}

/**
 * Global bin directories for every JS package manager we might find an agent
 * CLI in — plus the npm prefix the user has actually configured.
 *
 * `npm install -g` only lands in the default prefix when nobody moved it, and
 * moving it is the standard advice for avoiding `sudo` (`npm config set prefix
 * ~/.npm-global`). pnpm/bun/yarn each own a different directory again. Missing
 * any of them makes a perfectly working CLI read as "not installed" — the
 * launcher then offers to install a second copy of something already there.
 * Windows already consulted `npm config get prefix`; Unix never did, which is
 * the half of that check this function restores.
 */
function _addPackageManagerPaths(dirs) {
  // npm's configured prefix. On Windows the shims sit in the prefix itself; on
  // Unix they sit in <prefix>/bin. Cached for the process — it costs a spawn
  // and the value does not change while the app is open.
  const prefix = _npmPrefix();
  if (prefix) {
    _push(dirs, IS_WINDOWS ? prefix : path.join(prefix, 'bin'));
    // A Windows prefix can still carry a bin/ (Git-bash-flavoured setups).
    if (IS_WINDOWS) _push(dirs, path.join(prefix, 'bin'));
  }

  // pnpm — PNPM_HOME when exported, else the per-platform default.
  if (process.env.PNPM_HOME) _push(dirs, process.env.PNPM_HOME);
  if (IS_WINDOWS) {
    if (process.env.LOCALAPPDATA) _push(dirs, path.join(process.env.LOCALAPPDATA, 'pnpm'));
  } else {
    if (IS_MACOS) _push(dirs, path.join(HOME, 'Library', 'pnpm'));
    _push(dirs, path.join(HOME, '.local', 'share', 'pnpm'));
  }

  // bun — the install root is relocatable via BUN_INSTALL.
  const bunRoot = process.env.BUN_INSTALL || path.join(HOME, '.bun');
  _push(dirs, path.join(bunRoot, 'bin'));

  // yarn (both the v1 global bin and the classic global node_modules/.bin)
  _push(dirs, path.join(HOME, '.yarn', 'bin'));
  _push(dirs, path.join(HOME, '.config', 'yarn', 'global', 'node_modules', '.bin'));

  // deno
  const denoRoot = process.env.DENO_INSTALL || path.join(HOME, '.deno');
  _push(dirs, path.join(denoRoot, 'bin'));

  // Version-manager shim dirs — asdf and mise put every tool's shim here, so a
  // CLI installed under a non-default runtime still resolves.
  _push(dirs, path.join(process.env.ASDF_DATA_DIR || path.join(HOME, '.asdf'), 'shims'));
  _push(dirs, path.join(HOME, '.local', 'share', 'mise', 'shims'));

  // Windows package managers that install CLIs outside any of the above.
  if (IS_WINDOWS) {
    _push(dirs, path.join(process.env.SCOOP || path.join(HOME, 'scoop'), 'shims'));
    if (process.env.ChocolateyInstall) _push(dirs, path.join(process.env.ChocolateyInstall, 'bin'));
  }
}

/**
 * Install dirs chosen by an agent CLI's own installer script.
 *
 * These never appear on a GUI process's PATH: the script edits a shell rc file
 * (Unix) or the registry (Windows), neither of which reaches an already-running
 * app. Cursor/Amp/Hermes are handled in the per-platform blocks for historical
 * reasons; anything added here is picked up on both.
 */
function _addAgentInstallerPaths(dirs) {
  // opencode — `curl -fsSL https://opencode.ai/install | bash` defaults to
  // ~/.opencode/bin and honours OPENCODE_INSTALL_DIR. Reported as
  // "launcher can't see my opencode" (#648).
  _push(dirs, process.env.OPENCODE_INSTALL_DIR || path.join(HOME, '.opencode', 'bin'));

  // Legacy npm prefixes the opencode/copilot adapters have always searched.
  // They were known to the adapter that SPAWNS the CLI but not to the
  // installer that decides whether it EXISTS — so an agent could run fine and
  // still be offered for install. See the coverage test in
  // test/agent-detection-matrix.test.js.
  _push(dirs, path.join(HOME, '.npm-global', 'bin'));
  _push(dirs, path.join(HOME, '.openagents', 'npm-global', 'bin'));

  // The plain ~/bin some installers fall back to when ~/.local/bin is absent.
  _push(dirs, path.join(HOME, 'bin'));

  if (IS_WINDOWS && process.env.LOCALAPPDATA) {
    const lad = process.env.LOCALAPPDATA;
    // antigravity (agy) — install.sh targets ~/.local/bin, the Windows
    // installer %LOCALAPPDATA%\agy\bin. Only the adapter knew the latter.
    _push(dirs, path.join(lad, 'agy', 'bin'));
    // cursor-agent also ships under Programs\ on some Windows installs — the
    // cursor adapter checks both, the installer only knew one.
    _push(dirs, path.join(lad, 'Programs', 'cursor-agent'));
  }
}

let npmPrefixCache;

/** The npm prefix `npm config get prefix` reports, or null. Probed once. */
function _npmPrefix() {
  if (npmPrefixCache !== undefined) return npmPrefixCache;
  npmPrefixCache = null;
  try {
    const out = execSync('npm config get prefix', {
      encoding: 'utf-8',
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, PATH: _basePATH() },
    }).trim();
    // `npm config get` prints "undefined" (or nothing) when it has no value.
    if (out && out !== 'undefined' && fs.existsSync(out)) npmPrefixCache = out;
  } catch {}
  return npmPrefixCache;
}

/**
 * PATH for the internal probes above — the process PATH plus the well-known
 * dirs, WITHOUT recursing back into getExtraBinDirs() (which is what calls us).
 */
function _basePATH() {
  const seed = [];
  if (IS_WINDOWS) {
    if (process.env.APPDATA) seed.push(path.join(process.env.APPDATA, 'npm'));
    seed.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'));
  } else {
    seed.push('/usr/local/bin', '/opt/homebrew/bin', path.join(HOME, '.local', 'bin'));
  }
  try { seed.push(path.dirname(process.execPath)); } catch {}
  return seed.join(SEP) + SEP + (process.env.PATH || '');
}

const SHELL_PROBE_TIMEOUT_MS = 6000;
const SHELL_ENV_DELIM = '__OPENAGENTS_ENV__';
let loginShellDirsCache;

/**
 * The PATH entries a login shell would hand the user, harvested once.
 *
 * This is the general form of every "installed but not detected" report. A
 * launcher started from Finder / the Dock / a desktop entry does NOT inherit
 * the shell's environment — macOS hands a GUI app `/usr/bin:/bin:/usr/sbin:
 * /sbin` and nothing else. So every CLI the user installed through their own
 * shell (nvm on a non-default version, a relocated npm prefix, bun, pnpm, a
 * hand-rolled ~/bin) is invisible, and no hardcoded list of well-known dirs can
 * ever be complete enough to cover it. Asking the shell is the only answer that
 * generalises: whatever `which opencode` finds in a terminal, we find too.
 *
 * Runs `$SHELL -ilc env` and reads the PATH line out of a delimited block, so a
 * chatty rc file (motd, version-manager banners, prompt setup) can't corrupt the
 * result. Best-effort throughout: no shell, an unusual shell that rejects the
 * flags, or a hang all fall back to the hardcoded dirs. Set
 * OPENAGENTS_SKIP_SHELL_PATH=1 to opt out.
 */
function loginShellDirs() {
  if (loginShellDirsCache !== undefined) return loginShellDirsCache;
  loginShellDirsCache = [];
  if (IS_WINDOWS) return loginShellDirsCache;
  if (process.env.OPENAGENTS_SKIP_SHELL_PATH === '1') return loginShellDirsCache;
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    if (!fs.existsSync(shell)) return loginShellDirsCache;
    const out = execFileSync(
      shell,
      ['-ilc', `echo ${SHELL_ENV_DELIM}; command env; echo ${SHELL_ENV_DELIM}`],
      {
        encoding: 'utf-8',
        timeout: SHELL_PROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        // stdin closed, stderr dropped: an interactive shell with no tty writes
        // job-control warnings there and we do not want them in the output.
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const parts = String(out).split(SHELL_ENV_DELIM);
    if (parts.length < 3) return loginShellDirsCache;
    const line = parts[1].split(/\r?\n/).find((l) => l.startsWith('PATH='));
    if (!line) return loginShellDirsCache;
    const seen = new Set();
    for (const d of line.slice('PATH='.length).split(SEP)) {
      const dir = d.trim();
      if (dir && !seen.has(dir)) { seen.add(dir); loginShellDirsCache.push(dir); }
    }
  } catch {}
  return loginShellDirsCache;
}

// ---- Windows paths ----

function _addWindowsPaths(dirs) {
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';

  // System32 (cmd.exe, powershell, etc) — Electron may not have it
  _push(dirs, path.join(sysRoot, 'System32'));

  // npm global bin (default location)
  if (appData) _push(dirs, path.join(appData, 'npm'));

  // npm's custom prefix (e.g. D:\node\node_global) is added for BOTH platforms
  // by _addPackageManagerPaths — see the note there.

  // Portable Node.js installed by OpenAgents Launcher
  _push(dirs, path.join(HOME, '.openagents', 'nodejs'));

  // Cursor CLI native installer.
  //   - ~/.cursor/bin            : the curl|bash layout (also used by some setups)
  //   - %LOCALAPPDATA%\cursor-agent : where the Windows installer
  //     (irm 'https://cursor.com/install?win32=true' | iex) actually drops
  //     cursor-agent.cmd / agent.cmd. The installer edits the *registry* PATH,
  //     so an already-running launcher/daemon process never sees it via `where`
  //     unless we add the dir here explicitly.
  _push(dirs, path.join(HOME, '.cursor', 'bin'));
  if (localAppData) _push(dirs, path.join(localAppData, 'cursor-agent'));
  _push(dirs, path.join(HOME, '.local', 'bin'));

  // Amp CLI (irm https://ampcode.com/install.ps1 | iex) — same registry-PATH
  // staleness as Cursor; add the canonical install dir(s) so an already-running
  // daemon resolves amp without a reboot.
  _push(dirs, path.join(HOME, '.amp', 'bin'));
  if (localAppData) _push(dirs, path.join(localAppData, 'amp'));

  // Hermes CLI native (no-WSL) installer drops hermes.exe in the portable
  // venv's Scripts dir and the uv shim in %LOCALAPPDATA%\hermes\bin. Same
  // registry-PATH staleness as Cursor — add explicitly so an already-running
  // daemon resolves hermes via `where` without a reboot.
  if (localAppData) {
    _push(dirs, path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts'));
    _push(dirs, path.join(localAppData, 'hermes', 'bin'));
  }

  // Node.js install
  _push(dirs, path.join(programFiles, 'nodejs'));

  // nvm for Windows
  const nvmHome = process.env.NVM_HOME;
  if (nvmHome) {
    _push(dirs, nvmHome);
    // nvm symlink dir
    const nvmSymlink = process.env.NVM_SYMLINK || path.join(programFiles, 'nodejs');
    _push(dirs, nvmSymlink);
  }

  // fnm
  if (localAppData) _push(dirs, path.join(localAppData, 'fnm_multishells'));
  const fnmDir = process.env.FNM_DIR || path.join(appData, 'fnm');
  if (fnmDir) {
    // fnm aliases — current version
    try {
      const defaultDir = path.join(fnmDir, 'aliases', 'default');
      if (fs.existsSync(defaultDir)) _push(dirs, defaultDir);
    } catch {}
  }

  // volta
  const voltaHome = process.env.VOLTA_HOME || path.join(localAppData, 'Volta');
  _push(dirs, path.join(voltaHome, 'bin'));

  // Git (needed for some installers)
  _push(dirs, path.join(programFiles, 'Git', 'cmd'));
  _push(dirs, path.join(programFiles, 'Git', 'bin'));

  // Python/pip
  if (localAppData) {
    _push(dirs, path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts'));
    _push(dirs, path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts'));
    _push(dirs, path.join(localAppData, 'Programs', 'Python', 'Python310', 'Scripts'));
  }
}

// ---- Unix paths ----

function _addUnixPaths(dirs) {
  // Standard
  _push(dirs, '/usr/local/bin');
  _push(dirs, '/usr/bin');

  // npm agents install to isolated prefixes: ~/.openagents/runtimes/<type>/

  // nvm
  const nvmDir = process.env.NVM_DIR || path.join(HOME, '.nvm');
  try {
    // The version the shell that spawned us is on, when it exported it.
    if (process.env.NVM_BIN) _push(dirs, process.env.NVM_BIN);
    // Find current nvm version
    const defaultPath = path.join(nvmDir, 'alias', 'default');
    if (fs.existsSync(defaultPath)) {
      const version = fs.readFileSync(defaultPath, 'utf-8').trim();
      // Resolve alias like 'lts/*' or version number
      const resolved = _resolveNvmVersion(nvmDir, version);
      if (resolved) _push(dirs, path.join(nvmDir, 'versions', 'node', resolved, 'bin'));
    }
    // Also try current symlink
    _push(dirs, path.join(nvmDir, 'current', 'bin'));
    // Then EVERY installed version, newest first. `npm install -g` writes into
    // whichever version was active in that terminal, which is routinely not the
    // default alias — a user who ran `nvm use 20 && npm i -g opencode` has a
    // real, working CLI that the default-alias-only lookup above cannot see.
    // Newest-first so the most likely copy still wins.
    for (const v of _installedNvmVersions(nvmDir)) {
      _push(dirs, path.join(nvmDir, 'versions', 'node', v, 'bin'));
    }
  } catch {}

  // fnm
  const fnmDir = process.env.FNM_DIR || path.join(HOME, '.fnm');
  try {
    const defaultDir = path.join(fnmDir, 'aliases', 'default');
    if (fs.existsSync(defaultDir)) {
      const target = fs.realpathSync(defaultDir);
      _push(dirs, path.join(target, 'bin'));
    }
  } catch {}

  // volta
  const voltaHome = process.env.VOLTA_HOME || path.join(HOME, '.volta');
  _push(dirs, path.join(voltaHome, 'bin'));

  // pip/pipx user installs
  _push(dirs, path.join(HOME, '.local', 'bin'));

  // cargo
  _push(dirs, path.join(HOME, '.cargo', 'bin'));

  // Cursor CLI native installer (curl https://cursor.com/install | bash)
  _push(dirs, path.join(HOME, '.cursor', 'bin'));

  // Amp CLI native installer (curl https://ampcode.com/install.sh | bash)
  // drops the binary in ~/.amp/bin and only symlinks into ~/.local/bin when
  // that dir is already on PATH — so a GUI- or daemon-spawned process never
  // sees it unless the canonical dir is listed here explicitly.
  _push(dirs, path.join(HOME, '.amp', 'bin'));
}

// ---- macOS-specific ----

function _addMacPaths(dirs) {
  // Homebrew (Apple Silicon + Intel)
  _push(dirs, '/opt/homebrew/bin');
  _push(dirs, '/opt/homebrew/sbin');
  _push(dirs, '/usr/local/bin');
  _push(dirs, '/usr/local/sbin');

  // MacPorts
  _push(dirs, '/opt/local/bin');

  // pkgx
  _push(dirs, path.join(HOME, '.pkgx', 'bin'));
}

// ---- Helpers ----

function _push(arr, dir) {
  if (dir) arr.push(dir);
}

/** Every node version nvm has installed, newest first. */
function _installedNvmVersions(nvmDir) {
  try {
    return fs
      .readdirSync(path.join(nvmDir, 'versions', 'node'))
      .filter((v) => /^v\d+\./.test(v))
      .sort((a, b) => {
        const pa = a.slice(1).split('.').map(Number);
        const pb = b.slice(1).split('.').map(Number);
        for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        return 0;
      });
  } catch {
    return [];
  }
}

function _resolveNvmVersion(nvmDir, alias) {
  // Handle direct version like 'v22.14.0'
  if (alias.startsWith('v')) {
    return alias;
  }
  // Handle aliases like 'lts/*', 'lts/jod', 'default', numeric '22'
  try {
    // Try reading alias file
    const aliasFile = path.join(nvmDir, 'alias', alias.replace('/', path.sep));
    if (fs.existsSync(aliasFile)) {
      const target = fs.readFileSync(aliasFile, 'utf-8').trim();
      return _resolveNvmVersion(nvmDir, target);
    }
  } catch {}

  // Try finding latest matching version in versions dir
  try {
    const versionsDir = path.join(nvmDir, 'versions', 'node');
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir)
        .filter(v => v.startsWith('v'))
        .sort()
        .reverse();
      const match = versions.find(v => v.startsWith('v' + alias));
      if (match) return match;
      // Just return the latest
      if (versions.length > 0) return versions[0];
    }
  } catch {}

  return null;
}

/**
 * Get the isolated npm prefix directory for an agent runtime.
 * Each agent type gets its own prefix to prevent cross-agent interference.
 */
function getRuntimePrefix(agentType) {
  return path.join(HOME, '.openagents', 'runtimes', agentType);
}

/**
 * Get the core library directory (separate from agent runtimes).
 */
function getCorePrefix() {
  return path.join(HOME, '.openagents', 'core');
}

/**
 * A guaranteed-writable working directory for an agent that has no explicit
 * `path` configured.
 *
 * NEVER fall back to process.cwd() for this: on a packaged Windows launcher the
 * daemon (and the agent CLIs it spawns) inherit a cwd of C:\WINDOWS\system32
 * (or the app's Program Files dir), so writing .claude/skills, .claude/plans,
 * etc. relative to cwd fails with `EPERM: operation not permitted, mkdir`.
 *
 * Rooted under ~/.openagents — the same writable tree the daemon already uses
 * for its pid/status/log files — with one isolated subdir per agent. Uses
 * os.homedir() (OS-account based, reliable even when HOME/USERPROFILE are
 * stripped from a child process's environment) rather than the env-derived
 * HOME above.
 */
function defaultAgentWorkdir(agentName) {
  const safe = String(agentName || 'default').replace(/[^A-Za-z0-9._-]/g, '_') || 'default';
  const dir = path.join(os.homedir(), '.openagents', 'workspaces', safe);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

/**
 * Reset the two 30s caches that back binary detection. Call this after
 * install / uninstall so a freshly-created bin dir (e.g. ~/.cursor/bin)
 * isn't masked by a pre-install snapshot of getExtraBinDirs(), and so a
 * `whichBinary(name) === null` cached before install doesn't survive.
 */
function clearBinaryLookupCache() {
  extraBinDirsCache = { value: null, at: 0, path: '' };
  whichBinaryCache.clear();
  // The login-shell / npm-prefix probes are deliberately NOT cleared: they each
  // cost a process spawn, they answer a question about the machine rather than
  // about any install, and this is called after every install/uninstall.
}

/**
 * Pay the one-time probe cost (login shell + npm prefix) up front.
 *
 * getExtraBinDirs() is synchronous and every caller is on a path where a ~1s
 * stall is felt — the marketplace listing, a readiness check, spawning an
 * agent. Calling this once while a splash screen is already up moves that cost
 * somewhere nobody is waiting on. Safe to call more than once; safe to skip.
 */
function primeBinaryLookup() {
  try { loginShellDirs(); } catch {}
  try { _npmPrefix(); } catch {}
  try { getExtraBinDirs(); } catch {}
}

/**
 * Directories where the Aider CLI executable can land, in the SAME priority the
 * official installer (aider.chat/install.{sh,ps1} → `uv tool install`) uses, so
 * detection matches reality on every platform:
 *   1. $XDG_BIN_HOME
 *   2. $XDG_DATA_HOME/../bin
 *   3. ~/.local/bin              (the default uv-tool / pipx / pip --user bin)
 *   4. the uv tools venv for aider-chat (Scripts on Windows, bin on Unix) — the
 *      executable always lands here on a successful `uv tool install`, even if
 *      the bin-dir copy/PATH edit didn't happen.
 * Uses os.homedir()/live env so it reflects the current process (test-friendly).
 * Returns directories only; callers join the platform binary names.
 */
function aiderBinDirs() {
  const home = os.homedir();
  const dirs = [];
  if (process.env.XDG_BIN_HOME) dirs.push(process.env.XDG_BIN_HOME);
  if (process.env.XDG_DATA_HOME) dirs.push(path.join(process.env.XDG_DATA_HOME, '..', 'bin'));
  dirs.push(path.join(home, '.local', 'bin'));
  if (IS_WINDOWS) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const uvTools = process.env.UV_TOOL_DIR || path.join(appData, 'uv', 'tools');
    dirs.push(path.join(uvTools, 'aider-chat', 'Scripts'));
    dirs.push(path.join(home, 'bin'));
  } else {
    const uvTools = process.env.UV_TOOL_DIR
      || path.join(home, '.local', 'share', 'uv', 'tools');
    dirs.push(path.join(uvTools, 'aider-chat', 'bin'));
    dirs.push(path.join(home, 'bin'), '/usr/local/bin', '/opt/homebrew/bin');
  }
  return dirs;
}

/** Executable suffixes to try for a bare binary name, per platform. */
const BIN_EXTS = IS_WINDOWS ? ['.cmd', '.exe', '.bat', ''] : [''];

/**
 * Last-resort binary lookup: walk the directories we already know agent CLIs
 * land in and check the filesystem directly, instead of asking the shell.
 *
 * `where`/`which` is not enough on Windows. The Cursor, Amp and Hermes
 * installers edit the *registry* PATH, which an already-running process never
 * inherits — so a perfectly good install is invisible to a PATH lookup until
 * the machine (or at least the app) is restarted. Every adapter grew its own
 * tiered search to cope; the launcher had none, so it alone reported "can't
 * find it" and then opened a terminal running a bare command that could only
 * fail with "'cursor-agent' is not recognized".
 *
 * Deliberately reuses getExtraBinDirs() rather than a second hardcoded list:
 * that list already IS the curated set, and a copy of it is exactly how the
 * launcher and the adapters drifted apart in the first place.
 *
 * Runs only after a PATH lookup has already missed, so it can add resolutions
 * but never change one that already works.
 *
 * @param {string|string[]} names  binary name(s), e.g. ['cursor-agent','agent']
 * @param {string} [agentType]     adds that agent's isolated runtime bin dir
 * @returns {string|null} absolute path, or null
 */
function resolveBinaryInKnownDirs(names, agentType) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (!list.length) return null;

  const dirs = [];
  const push = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };

  // The agent's own isolated runtime first — it is the copy this launcher
  // installed, and should win over anything the user happens to have globally.
  if (agentType) push(path.join(getRuntimePrefix(agentType), 'node_modules', '.bin'));
  push(path.join(HOME, '.openagents', 'nodejs', 'node_modules', '.bin'));
  try { push(path.dirname(process.execPath)); } catch {}
  for (const d of getExtraBinDirs()) push(d);

  for (const dir of dirs) {
    for (const name of list) {
      for (const ext of BIN_EXTS) {
        const candidate = path.join(dir, `${name}${ext}`);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        } catch {
          /* unreadable path — keep looking */
        }
      }
    }
  }
  return null;
}


module.exports = {
  getExtraBinDirs,
  getEnhancedPATH,
  getEnhancedEnv,
  whichBinary,
  whereBinary,
  resolveBinaryInKnownDirs,
  clearBinaryLookupCache,
  primeBinaryLookup,
  loginShellDirs,
  getRuntimePrefix,
  getCorePrefix,
  defaultAgentWorkdir,
  aiderBinDirs,
  IS_WINDOWS,
  IS_MACOS,
  SEP,
};
