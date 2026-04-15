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
const { execSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';
const SEP = IS_WINDOWS ? ';' : ':';
const HOME = process.env.HOME || process.env.USERPROFILE || '';

/**
 * Get all extra binary directories that should be checked beyond process.env.PATH.
 * Returns deduplicated list of existing directories.
 */
function getExtraBinDirs() {
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

  // Filter to existing directories only, deduplicate
  const seen = new Set();
  const currentPATH = process.env.PATH || '';
  return dirs.filter(d => {
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
    env.PATH = extra.join(SEP) + SEP + (env.PATH || '');
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
  const cmd = IS_WINDOWS ? `where ${name}` : `which ${name}`;
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: getEnhancedPATH() },
      timeout: 5000,
    }).trim();
    return result.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
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

  // npm global bin (custom prefix — e.g. user configured npm prefix to D:\node\node_global)
  try {
    const npmPrefix = execSync('npm config get prefix', {
      encoding: 'utf-8', timeout: 5000, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (npmPrefix) _push(dirs, npmPrefix);
  } catch {}

  // Portable Node.js installed by OpenAgents Launcher
  _push(dirs, path.join(HOME, '.openagents', 'nodejs'));

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

module.exports = {
  getExtraBinDirs,
  getEnhancedPATH,
  getEnhancedEnv,
  whichBinary,
  getRuntimePrefix,
  getCorePrefix,
  IS_WINDOWS,
  IS_MACOS,
  SEP,
};
