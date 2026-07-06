'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, exec } = require('child_process');
const { whichBinary, getEnhancedEnv, getRuntimePrefix, clearBinaryLookupCache, aiderBinDirs } = require('./paths');
const { EnvManager } = require('./env');
const { readinessReason, REASON } = require('./adapters/health-status');

const STATUS_CACHE_TTL_MS = 10000;
const statusCache = new Map();

// Version detection is comparatively expensive (spawns `<bin> --version`), so
// results are cached briefly and invalidated on install/uninstall.
const VERSION_CACHE_TTL_MS = 60000;
const versionCache = new Map();

/**
 * Compare two dotted version strings numerically, ignoring any pre-release /
 * build suffix (e.g. "1.2.3-beta.1" → 1.2.3). Returns -1, 0, or 1.
 * Returns null when either side has no extractable numeric version.
 */
function compareVersions(a, b) {
  const norm = (v) => {
    const m = String(v == null ? '' : v).match(/\d+(?:\.\d+)*/);
    return m ? m[0].split('.').map((n) => parseInt(n, 10)) : null;
  };
  const pa = norm(a);
  const pb = norm(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** Drop the version cache (called on install/uninstall). */
function clearVersionCache() {
  versionCache.clear();
}

/**
 * Manages installation and uninstallation of agent runtimes.
 *
 * Install markers are stored in two places for compatibility with the Python SDK:
 *   1. ~/.openagents/installed_agents.json  (JSON array of names)
 *   2. ~/.openagents/installed/<name>       (empty marker files)
 */
class Installer {
  constructor(registry, configDir) {
    this.registry = registry;
    this.configDir = configDir;
    this.markersFile = path.join(configDir, 'installed_agents.json');
    this.markersDir = path.join(configDir, 'installed');
    this.env = new EnvManager(configDir);
  }

  /**
   * Get the current platform key: 'macos', 'linux', or 'windows'.
   */
  static platform() {
    const p = process.platform;
    if (p === 'darwin') return 'macos';
    if (p === 'win32') return 'windows';
    return 'linux';
  }

  /**
   * Check if an agent type is installed.
   * Checks binary on PATH first, then marker files.
   */
  /**
   * Check if an agent type is installed.
   * @returns {boolean} true if installed (any location)
   */
  isInstalled(agentType) {
    return this.getInstallInfo(agentType).installed;
  }

  /**
   * Get detailed install info for an agent type.
   * @returns {{ installed: boolean, managed: boolean, location: string|null }}
   *   - installed: true if the agent is found anywhere
   *   - managed: true if installed inside ~/.openagents/ (can be uninstalled by launcher)
   *   - location: 'runtime' | 'legacy' | 'global' | null
   */
  getInstallInfo(agentType) {
    const entry = this.registry.getEntry(agentType);
    const npmPkg = entry && entry.install ? entry.install.npm_package : null;
    const binary = entry && entry.install ? entry.install.binary : agentType;
    if (entry?.install?.api_only) {
      const installed = this._hasMarker(agentType);
      return {
        installed,
        managed: installed,
        location: installed ? 'api_only' : null,
      };
    }
    const installCmd = entry && entry.install ? this._getInstallCommand(entry.install) : null;
    let npmPkgFromCmd = null;
    if (!npmPkg && installCmd && installCmd.includes('npm install')) {
      const match = installCmd.match(/npm install\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@\S*)?$/);
      if (match) npmPkgFromCmd = match[1];
    }
    const pkgName = npmPkg || npmPkgFromCmd || binary;

    // Check isolated runtime prefix first (~/.openagents/runtimes/<type>/)
    const runtimeModules = path.join(getRuntimePrefix(agentType), 'node_modules');
    if (fs.existsSync(path.join(runtimeModules, pkgName, 'package.json'))) {
      return { installed: true, managed: true, location: 'runtime' };
    }

    // Legacy: check shared prefix (~/.openagents/nodejs/node_modules/)
    const legacyModules = path.join(os.homedir(), '.openagents', 'nodejs', 'node_modules');
    if (fs.existsSync(path.join(legacyModules, pkgName, 'package.json'))) {
      return { installed: true, managed: true, location: 'legacy' };
    }

    // Fallback: check if binary exists on PATH (system install)
    const binaryPath = this._whichBinary(agentType);
    if (!binaryPath) {
      // Aider/Amp-only: a marker alone is NOT sufficient evidence of an install.
      // Their CLIs live outside any npm package (aider: curl/uv/pipx → ~/.local/bin;
      // amp: curl/ps1 installer → ~/.amp/bin), so a historical "installed" marker
      // can outlive a missing/never-landed binary. Require a real resolvable
      // binary; when only a stale marker remains, report not-installed with a
      // 'cli-missing' diagnostic (carried by the existing `location` field — no
      // new field/enum). The marker itself is left untouched.
      if (agentType === 'aider' || agentType === 'amp') {
        return {
          installed: false,
          managed: false,
          location: this._hasMarker(agentType) ? 'cli-missing' : null,
        };
      }
      // If a successful install wrote a marker, surface installed=true even
      // when binary detection can't (yet) see the freshly-installed CLI —
      // e.g. PATH caches not yet picking up a brand-new ~/.cursor/bin. The
      // marker is the ground truth of what we just installed; UI was
      // silently showing "not installed" right after a successful install
      // because earlier code aggressively deleted the marker here.
      if (this._hasMarker(agentType)) {
        return { installed: true, managed: true, location: 'marker' };
      }
      return { installed: false, managed: false, location: null };
    }

    // Verify it's not a stale shim pointing to a missing package
    const openagentsDir = path.join(os.homedir(), '.openagents');
    if (binaryPath.startsWith(openagentsDir)) {
      const hasRuntime = fs.existsSync(path.join(runtimeModules, pkgName, 'package.json'));
      const hasLegacy = fs.existsSync(path.join(legacyModules, pkgName, 'package.json'));
      if (!hasRuntime && !hasLegacy) {
        // Stale shim — clean it up
        for (const ext of ['', '.cmd', '.ps1']) {
          try { const p = path.join(path.dirname(binaryPath), binary + ext); if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
        }
        return { installed: false, managed: false, location: null };
      }
      return { installed: true, managed: true, location: 'legacy' };
    }

    // Binary found outside ~/.openagents/ — global/system install
    return { installed: true, managed: false, location: 'global' };
  }

  /**
   * Deep verification — runs the agent's verify command (slow, use sparingly).
   */
  verifyInstalled(agentType) {
    const entry = this.registry.getEntry(agentType);
    const IS_WINDOWS = process.platform === 'win32';
    const verifyCmd = entry && entry.install
      ? (IS_WINDOWS ? entry.install.verify_win : entry.install.verify)
      : null;
    if (verifyCmd) {
      try {
        // Use the enhanced PATH so a freshly-installed CLI living in a dir the
        // installer added (e.g. %LOCALAPPDATA%\cursor-agent) is found — otherwise
        // `cursor-agent --version` exits "not recognized" and verify wrongly fails.
        require('child_process').execSync(verifyCmd, {
          stdio: 'ignore', timeout: 5000, env: getEnhancedEnv(), windowsHide: true,
        });
        return true;
      } catch { return false; }
    }
    return this.isInstalled(agentType);
  }

  /**
   * Aider-only post-install verification.
   *
   * Confirms a REAL aider binary exists on disk — AND that it is actually the
   * Aider CLI rather than a same-named unrelated executable — before the
   * install is recorded. The curl/uv/pipx installer can exit 0 without landing
   * a runnable binary (blocked download, wrong $HOME, custom bin dir), which
   * would otherwise leave a "marker says installed but CLI missing" state.
   * Deliberately does NOT consult the install marker, so it can't be satisfied
   * by its own about-to-be-written record.
   *
   * Hard condition: an absolute path resolves AND the file exists. `aider
   * --version` is best-effort: a flaky/blocked probe does NOT fail the install,
   * but a version string that is clearly NOT Aider (wrong same-named package)
   * does — that is the whole point of the check.
   *
   * Scoped to Aider; never called for any other agent type.
   *
   * @returns {{ path: string, version: string|null } | null}
   */
  _verifyAiderBinary() {
    try { clearBinaryLookupCache(); } catch {}

    const isWin = process.platform === 'win32';
    const names = isWin ? ['aider.exe', 'aider.cmd', 'aider'] : ['aider'];
    const candidates = [];
    // 1) Whatever the enhanced-PATH resolver finds (now includes the XDG and
    //    uv-tools dirs added to paths.js).
    const resolved = this._whichBinary('aider');
    if (resolved) candidates.push(resolved);
    // 2) Every real install dir the official installer can target — XDG bin,
    //    XDG_DATA_HOME/../bin, ~/.local/bin, and the uv tools venv. This is the
    //    fix for "install succeeded but landed outside ~/.local/bin" (e.g. the
    //    user has XDG_* set, or only the uv-tools venv copy exists).
    for (const dir of aiderBinDirs()) {
      for (const name of names) candidates.push(path.join(dir, name));
    }

    let found = null;
    for (const c of candidates) {
      try { if (c && fs.existsSync(c)) { found = c; break; } } catch {}
    }
    if (!found) return null;

    let version = null;
    try {
      const raw = require('child_process').execSync(`"${found}" --version`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
        env: getEnhancedEnv(),
        windowsHide: true,
        encoding: 'utf-8',
      }).trim();
      if (raw) {
        // A confident mismatch means this `aider` is the wrong package.
        if (!/aider/i.test(raw)) return null;
        version = raw;
      }
    } catch {
      // Best-effort only — file existence above is the hard condition.
    }
    return { path: found, version };
  }

  /**
   * Aider-only: actionable message when the install command exits 0 but no
   * runnable (and verified) aider binary can be found anywhere we look. The most
   * common real cause is the underlying `uv` step failing to download a Python
   * runtime on a restricted network — so we point at both the PATH/new-terminal
   * case and a pip fallback.
   */
  _aiderBinaryNotFoundMessage() {
    const isWin = process.platform === 'win32';
    const name = isWin ? 'aider.exe' : 'aider';
    const looked = aiderBinDirs().map((d) => `  ${path.join(d, name)}`).join('\n');
    return (
      'Aider install command completed, but the Aider CLI could not be located ' +
      'afterward. The underlying installer (uv) most likely could not finish — ' +
      'often it cannot download a Python runtime on a restricted network/proxy.\n\n' +
      `Looked in:\n${looked}\n\n` +
      'Try one of:\n' +
      '  1) Open a NEW terminal and run:  aider --version\n' +
      '     (the install dir may simply not be on this process’s PATH yet)\n' +
      '  2) Install with pip instead, then re-run detection:\n' +
      '       python -m pip install --upgrade aider-chat'
    );
  }

  /**
   * Amp-only post-install verification.
   *
   * Confirms a REAL amp binary exists on disk before the install is recorded.
   * The Amp install script can exit 0 without landing a runnable binary (wrong
   * $HOME, blocked download, custom AMP_HOME), which would otherwise leave a
   * "marker says installed but CLI missing" state. Deliberately does NOT consult
   * the installed marker (unlike verifyInstalled()->isInstalled()), so it can't
   * be satisfied by its own about-to-be-written record.
   *
   * Hard condition for success: an absolute path resolves AND the file exists.
   * `amp --version` is a best-effort enhancement used only for logging — a flaky
   * or non-interactive `--version` failure does NOT fail the install.
   *
   * Scoped to Amp; never called for any other agent type.
   *
   * @returns {{ path: string, version: string|null } | null}
   */
  _verifyAmpBinary() {
    // Drop the 30s PATH/whichBinary cache so we see the freshly-installed dir
    // (e.g. ~/.amp/bin) instead of the pre-install snapshot.
    try { clearBinaryLookupCache(); } catch {}

    const isWin = process.platform === 'win32';
    const names = isWin ? ['amp.exe', 'amp.cmd', 'amp'] : ['amp'];
    const candidates = [];
    // 1) Whatever the shared cross-platform resolver finds on the enhanced PATH
    //    (already includes ~/.amp/bin).
    const resolved = this._whichBinary('amp');
    if (resolved) candidates.push(resolved);
    // 2) Honor a custom AMP_HOME, then the installer's default ~/.amp/bin —
    //    covers a binary that exists but whose dir isn't on PATH yet.
    const binDirs = [];
    if (process.env.AMP_HOME) binDirs.push(path.join(process.env.AMP_HOME, 'bin'));
    binDirs.push(path.join(os.homedir(), '.amp', 'bin'));
    for (const dir of binDirs) {
      for (const name of names) candidates.push(path.join(dir, name));
    }

    let found = null;
    for (const c of candidates) {
      try { if (c && fs.existsSync(c)) { found = c; break; } } catch {}
    }
    if (!found) return null;

    let version = null;
    try {
      version = require('child_process').execSync(`"${found}" --version`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000,
        env: getEnhancedEnv(),
        windowsHide: true,
        encoding: 'utf-8',
      }).trim() || null;
    } catch {
      // Best-effort only — file existence above is the hard condition.
    }
    return { path: found, version };
  }

  /**
   * Amp-only: message shown when the install command exits 0 but no runnable
   * amp binary can be found. Points at the canonical (or AMP_HOME) location.
   */
  _ampBinaryNotFoundMessage() {
    const isWin = process.platform === 'win32';
    const baseDir = process.env.AMP_HOME
      ? path.join(process.env.AMP_HOME, 'bin')
      : path.join(os.homedir(), '.amp', 'bin');
    const expected = path.join(baseDir, isWin ? 'amp.exe' : 'amp');
    return (
      'Amp install command completed, but the Amp CLI binary could not be found.\n\n' +
      `Expected path:\n${expected}`
    );
  }

  // Hermes's install.ps1 can print "[X] Installation failed" (e.g. its bundled
  // `uv` step fails) yet still exit 0, so exit-code-only success is unreliable.
  // Confirm a real hermes binary exists before recording the install. Mirrors
  // the paths the HermesAdapter._findHermesBinary() searches.
  _verifyHermesBinary() {
    try { clearBinaryLookupCache(); } catch {}
    const isWin = process.platform === 'win32';
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const candidates = [];
    const resolved = this._whichBinary('hermes');
    if (resolved) candidates.push(resolved);
    if (isWin) {
      candidates.push(
        path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
        path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.cmd'),
        path.join(localAppData, 'hermes', 'bin', 'hermes.exe'),
        path.join(localAppData, 'hermes', 'bin', 'hermes.cmd'),
        path.join(home, '.hermes', 'bin', 'hermes.exe'),
        path.join(home, '.hermes', 'bin', 'hermes.cmd'),
        path.join(home, '.local', 'bin', 'hermes.exe'),
        path.join(home, '.local', 'bin', 'hermes.cmd'),
      );
    } else {
      candidates.push(
        path.join(home, '.hermes', 'bin', 'hermes'),
        path.join(home, '.local', 'bin', 'hermes'),
        '/opt/homebrew/bin/hermes',
        '/usr/local/bin/hermes',
      );
    }
    let found = null;
    for (const c of candidates) {
      try { if (c && fs.existsSync(c)) { found = c; break; } } catch {}
    }
    return found ? { path: found } : null;
  }

  _hermesBinaryNotFoundMessage() {
    const isWin = process.platform === 'win32';
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const expected = isWin
      ? path.join(localAppData, 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
      : path.join(os.homedir(), '.hermes', 'bin', 'hermes');
    return (
      'Hermes install command completed, but the Hermes CLI binary could not be found\n' +
      "(its installer can report a uv/setup failure yet still exit 0).\n\n" +
      `Expected path:\n${expected}`
    );
  }

  /**
   * Find the binary path for an agent type.
   */
  which(agentType) {
    return this._whichBinary(agentType);
  }

  /**
   * Health check — binary existence + version.
   * @returns {{ installed: boolean, binary: string|null, version: string|null }}
   */
  healthCheck(agentType) {
    const entry = this.registry.getEntry(agentType);
    if (entry?.install?.api_only) {
      const info = this.getInstallInfo(agentType);
      if (!info.installed) {
        return {
          installed: false,
          binary: null,
          version: null,
          compatible: null,
          min_version: null,
          ready: false,
          auth_mode: null,
          auth_status: null,
          execution_mode: 'unavailable',
          reason: REASON.NOT_INSTALLED,
          message: 'Not installed',
        };
      }

      const apiReadiness = this._evaluateReadiness(agentType, entry, null);
      return {
        installed: true,
        binary: null,
        version: null,
        compatible: true,
        min_version: null,
        reason: readinessReason(true, apiReadiness.ready),
        ...apiReadiness,
      };
    }

    const binary = this._whichBinary(agentType);
    if (!binary) {
      return {
        installed: false,
        binary: null,
        version: null,
        compatible: null,
        min_version: null,
        ready: false,
        auth_mode: null,
        auth_status: null,
        execution_mode: 'unavailable',
        reason: REASON.NOT_INSTALLED,
        message: 'Not installed',
      };
    }

    const checkCmd = entry && entry.install ? entry.install.check_command : null;
    // Prefer the resolved absolute binary path (quoted) over the bare name:
    // it's unambiguous and lets `--version` succeed for binaries resolved via
    // the package-bin fallback (which are not on PATH).
    const versionCmd = checkCmd || this._versionProbeCommand(binary);

    const version = this._detectVersion(binary, versionCmd);
    const readiness = this._evaluateReadiness(agentType, entry, binary);

    // Generic minimum-version gate (no per-agent special-casing). An entry opts
    // in by declaring `install.min_version`. Below the floor we keep
    // installed=true but force compatible=false + ready=false so the launcher
    // blocks the run and prompts an upgrade (never shows "not installed"). When
    // the version can't be parsed we report compatible=null ("unknown") rather
    // than falsely passing the gate, and do NOT hard-block readiness.
    const gate = this._evaluateCompatibility(entry, version);
    if (gate.compatible === false) {
      readiness.ready = false;
      readiness.message = gate.message;
    }

    return {
      installed: true,
      binary,
      version,
      compatible: gate.compatible,
      min_version: gate.minVersion,
      // Installed is proven (binary resolved). A not-ready installed agent is a
      // login/config state, never "not installed" — version mismatch aside.
      reason:
        gate.compatible === false
          ? REASON.VERSION_INCOMPATIBLE
          : readinessReason(true, readiness.ready),
      ...readiness,
    };
  }

  /**
   * Build the `<binary> --version` probe command for a resolved binary path.
   *
   * When the resolved binary is a JS entry (`.mjs`/`.cjs`/`.js` — e.g. OpenClaw,
   * whose package `bin` is `openclaw.mjs` and is what `_resolvePackageBin`
   * returns when the `.cmd` shim isn't on PATH), it MUST be run through node.
   * execSync goes through a shell; on Windows `cmd.exe "C:\…\openclaw.mjs"
   * --version` finds no PATHEXT association for `.mjs`, so it ShellExecutes the
   * file and the OS pops the "choose an app to open this .mjs file" dialog. The
   * launcher polls health/version on a timer, so that dialog reappears over and
   * over — even at idle, and stacked (one per poll). Prefixing node makes the
   * probe run headless. Harmless on Unix (node runs a .mjs regardless of any
   * shebang), so it's applied on every platform for consistency.
   */
  _versionProbeCommand(binary) {
    if (/\.(mjs|cjs|js)$/i.test(binary)) {
      return `"${this._nodeBinary()}" "${binary}" --version`;
    }
    return `"${binary}" --version`;
  }

  /**
   * Resolve a node executable to run JS-entry CLIs with. Prefers the launcher's
   * portable node, then a PATH lookup, then the bare name. Deliberately does NOT
   * use process.execPath: when the core runs inside the Electron main process
   * that path is the Electron binary, and `electron foo.mjs` would launch the
   * app instead of running the script.
   */
  _nodeBinary() {
    const isWin = process.platform === 'win32';
    const nodeName = isWin ? 'node.exe' : 'node';
    const portableDir = path.join(os.homedir(), '.openagents', 'nodejs');
    for (const candidate of [
      path.join(portableDir, nodeName),
      path.join(portableDir, 'bin', nodeName),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    try {
      const found = execSync(isWin ? 'where node.exe' : 'which node', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getEnhancedEnv(),
      }).split(/\r?\n/)[0].trim();
      if (found) return found;
    } catch {}
    return 'node';
  }

  /**
   * Detect a binary's version string, cached briefly. Returns null on failure.
   */
  _detectVersion(binary, versionCmd) {
    const key = `${binary}\0${versionCmd}`;
    const cached = versionCache.get(key);
    if (cached && (Date.now() - cached.ts) < VERSION_CACHE_TTL_MS) return cached.version;

    let version = null;
    try {
      const raw = execSync(versionCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getEnhancedEnv(),
        timeout: 10000,
      }).trim();
      const match = raw.match(/(\d+[\d.]+\d+)/);
      version = match ? match[1] : (raw.split('\n')[0] || null);
    } catch {}

    versionCache.set(key, { version, ts: Date.now() });
    return version;
  }

  /**
   * Evaluate `install.min_version` against a detected version. Generic for any
   * agent. Returns { compatible: true|false|null, minVersion, message }.
   *   • no min_version declared → compatible:true (gate disabled)
   *   • version unparseable      → compatible:null  ("unknown", don't false-pass)
   *   • version < min_version    → compatible:false (block + upgrade hint)
   *   • version >= min_version   → compatible:true
   */
  _evaluateCompatibility(entry, version) {
    // Opt-in floor declared under either install.min_version or
    // check_ready.min_version (e.g. cline pins check_ready.min_version).
    const minVersion = (entry && (
      (entry.install && entry.install.min_version) ||
      (entry.check_ready && entry.check_ready.min_version)
    )) || null;
    if (!minVersion) return { compatible: true, minVersion: null, message: null };
    const cmp = compareVersions(version, minVersion);
    if (cmp === null) {
      return { compatible: null, minVersion, message: `Version unknown (requires >= ${minVersion})` };
    }
    if (cmp < 0) {
      return {
        compatible: false,
        minVersion,
        message: `${(entry.label || entry.name || 'This agent')} ${version} is too old — upgrade to ${minVersion} or newer.`,
      };
    }
    return { compatible: true, minVersion, message: null };
  }

  _evaluateReadiness(agentType, entry, binary) {
    const checkReady = entry?.check_ready;
    if (!checkReady) {
      return {
        ready: true,
        auth_mode: null,
        auth_status: 'ready',
        execution_mode: 'unavailable',
        message: 'Ready',
      };
    }

    const savedEnv = this.env.getEffective(agentType, this.registry);
    const directEnv = this._hasAllValues(process.env, checkReady.env_all);
    const directSaved = this._hasAllValues(savedEnv, checkReady.saved_env_all || checkReady.env_all);
    const directReady = directEnv || directSaved;
    const envAnyReady = this._hasAnyValue(process.env, checkReady.env_vars);
    const savedAnyReady = !!(checkReady.saved_env_key && savedEnv[checkReady.saved_env_key]);
    const credsReady = this._checkCredsReady(checkReady);
    // Content-free credential probes (opt-in via check_ready). Detect agents
    // whose sign-in is a local OAuth/credential FILE (e.g. Gemini's
    // ~/.gemini/oauth_creds.json) or a service-account file path, WITHOUT
    // parsing or logging the token. Additive: agents that don't declare
    // creds_no_parse / creds_path_env get identical behavior to before.
    const credsFile = this._evaluateCredsFile(checkReady);
    const credsPathReady = this._checkCredsPathEnv(checkReady, savedEnv);

    let cliReady = false;
    if (checkReady.status_command && binary) {
      cliReady = this._checkStatusCommand(checkReady.status_command);
    }

    if (directReady) {
      return {
        ready: true,
        auth_mode: 'api_key',
        auth_status: 'ready',
        execution_mode: 'direct',
        message: 'Ready',
      };
    }

    if (cliReady) {
      return {
        ready: true,
        auth_mode: 'cli_login',
        auth_status: 'ready',
        execution_mode: 'subprocess',
        message: 'Ready',
      };
    }

    if (envAnyReady || savedAnyReady) {
      // Legacy single-key path (e.g. agents that only advertise env_vars / saved_env_key).
      // An API key being present means the agent can be launched with it in the environment,
      // so treat this as a direct-launch configuration.
      return {
        ready: true,
        auth_mode: 'api_key',
        auth_status: 'ready',
        execution_mode: 'direct',
        message: 'Ready',
      };
    }

    if (credsReady || credsFile.ready || credsPathReady) {
      return {
        ready: true,
        auth_mode: 'cli_login',
        auth_status: 'ready',
        execution_mode: 'subprocess',
        message: 'Ready',
      };
    }

    // A credential file was found but could not be read (e.g. permissions).
    // That is NOT "no credentials" — report it as 'unknown' with a distinct
    // message so the UI never mislabels a real (if unreadable) login as
    // "Not logged in". Only reachable for agents that opt into creds_no_parse.
    if (credsFile.unreadable) {
      return {
        ready: false,
        auth_mode: null,
        auth_status: 'unknown',
        execution_mode: 'unavailable',
        message: checkReady.unreadable_message || 'Credentials were found but could not be read.',
      };
    }

    // No positive signal. For agents whose auth cannot be reliably probed
    // without running them (generic `check_ready.unverifiable`), this is
    // 'unknown' — they may already be signed in via a CLI login / keychain /
    // gh — NOT a definitive 'no_credentials'. The launcher can show "unknown"
    // and still allow a launch attempt; the real run is the final authority.
    return {
      ready: false,
      auth_mode: null,
      auth_status: checkReady.unverifiable ? 'unknown' : 'no_credentials',
      execution_mode: 'unavailable',
      message: checkReady.not_ready_message || 'Not configured',
    };
  }

  _hasAllValues(source, keys) {
    if (!keys || keys.length === 0) return false;
    return keys.every((key) => !!(source && source[key]));
  }

  _hasAnyValue(source, keys) {
    if (!keys || keys.length === 0) return false;
    return keys.some((key) => !!(source && source[key]));
  }

  _checkCredsReady(checkReady) {
    if (checkReady.creds_file) {
      try {
        const credsPath = checkReady.creds_file.replace('~', os.homedir());
        if (fs.existsSync(credsPath)) {
          const stat = fs.statSync(credsPath);
          if (stat.isDirectory()) return fs.readdirSync(credsPath).length > 0;
          const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
          if (checkReady.creds_key) return !!creds[checkReady.creds_key];
          return true;
        }
      } catch {}
    }

    if (checkReady.keychain_service && process.platform === 'darwin') {
      if (this._checkMacKeychain(checkReady.keychain_service, checkReady.creds_key)) {
        return true;
      }
    }

    return false;
  }

  /** Expand a leading "~" to the running user's home directory. */
  _expandHome(p) {
    if (typeof p !== 'string' || !p) return p;
    if (p === '~') return os.homedir();
    if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
    return p;
  }

  /**
   * Existence/readability of a credential file WITHOUT reading its contents —
   * never loads a token/key into memory. Returns 'present' | 'unreadable' |
   * 'absent'. A non-empty readable file (or a non-empty directory) is 'present';
   * a path that exists but cannot be statted/read is 'unreadable'. Resolves "~"
   * against the running user's home (the daemon/launcher user), not the
   * renderer/browser user.
   */
  _credsFileState(checkReady) {
    if (!checkReady || !checkReady.creds_file) return 'absent';
    const p = this._expandHome(checkReady.creds_file);
    let exists = false;
    try { exists = fs.existsSync(p); } catch { return 'unreadable'; }
    if (!exists) return 'absent';
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) return fs.readdirSync(p).length > 0 ? 'present' : 'absent';
      fs.accessSync(p, fs.constants.R_OK);
      return st.size > 0 ? 'present' : 'absent';
    } catch {
      return 'unreadable';
    }
  }

  /**
   * Opt-in, content-free creds-file readiness. Active ONLY when
   * `check_ready.creds_no_parse` is set, so existing creds_file agents (which
   * parse + match `creds_key` via _checkCredsReady) keep their exact behavior.
   * Returns { ready, unreadable }.
   */
  _evaluateCredsFile(checkReady) {
    if (!checkReady || !checkReady.creds_file || !checkReady.creds_no_parse) {
      return { ready: false, unreadable: false };
    }
    const state = this._credsFileState(checkReady);
    return { ready: state === 'present', unreadable: state === 'unreadable' };
  }

  /**
   * Treat the named env vars as paths to a credential FILE (e.g.
   * GOOGLE_APPLICATION_CREDENTIALS) and count one as ready only when its target
   * exists and is a readable file — a non-empty value alone is NOT enough.
   * Checks both the process env and the agent's saved env.
   */
  _checkCredsPathEnv(checkReady, savedEnv) {
    const names = checkReady && checkReady.creds_path_env;
    if (!Array.isArray(names) || !names.length) return false;
    for (const name of names) {
      const raw = ((process.env[name] || (savedEnv && savedEnv[name]) || '') + '').trim();
      if (!raw) continue;
      try {
        const p = this._expandHome(raw);
        if (!fs.existsSync(p)) continue;
        fs.accessSync(p, fs.constants.R_OK);
        if (fs.statSync(p).isFile()) return true;
      } catch { /* unreadable / bad path → not a usable credential */ }
    }
    return false;
  }

  /**
   * Check a macOS Keychain generic-password entry. If creds_key is provided the
   * stored value is parsed as JSON and required to contain that key; otherwise any
   * non-empty value counts as ready. Returns false on non-macOS or on any error.
   */
  _checkMacKeychain(service, credsKey) {
    try {
      const stdout = execSync(
        `security find-generic-password -s ${JSON.stringify(service)} -w`,
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, encoding: 'utf-8' },
      ).trim();
      if (!stdout) return false;
      if (!credsKey) return true;
      const creds = JSON.parse(stdout);
      return !!creds[credsKey];
    } catch {
      return false;
    }
  }

  _checkStatusCommand(command) {
    const cached = statusCache.get(command);
    if (cached && (Date.now() - cached.ts) < STATUS_CACHE_TTL_MS) {
      return cached.ok;
    }

    let ok = false;
    try {
      execSync(command, {
        stdio: 'ignore',
        timeout: 5000,
        env: getEnhancedEnv(),
      });
      ok = true;
    } catch {}

    statusCache.set(command, { ok, ts: Date.now() });
    return ok;
  }

  /**
   * Install an agent runtime.
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async install(agentType) {
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    if (entry.install.api_only) {
      this._markInstalled(agentType);
      return { success: true, output: `${entry.label || agentType} uses direct API mode; no binary install needed.` };
    }

    let cmd = this._getInstallCommand(entry.install);
    if (!cmd) {
      throw new Error(`No install command for ${agentType} on ${Installer.platform()}`);
    }

    // Use bundled node/npm if system npm not available
    if (cmd.startsWith('npm install')) {
      const prefixDir = getRuntimePrefix(agentType);
      fs.mkdirSync(prefixDir, { recursive: true });
      const args = cmd.replace('npm install', 'install --save').replace(' -g ', ` --prefix "${prefixDir}" `);
      cmd = this._resolveNpmCommand(args);
    }

    const output = await this._execShell(cmd);

    // Aider-only: the curl/uv/pipx installer can exit 0 without landing a
    // runnable (or genuine) binary, so verify the real CLI exists BEFORE
    // recording the install. Other agent types keep the original
    // "exit 0 → mark installed" behavior.
    if (agentType === 'aider') {
      const aider = this._verifyAiderBinary();
      if (!aider) {
        throw new Error(this._aiderBinaryNotFoundMessage());
      }
      this._markInstalled(agentType);
      return {
        success: true,
        output: `${output}\nAider CLI resolved: ${aider.path}${aider.version ? ` (${aider.version})` : ''}`,
      };
    }

    // Amp-only: the install script can exit 0 without landing a runnable
    // binary, so verify the real CLI exists BEFORE recording the install.
    if (agentType === 'amp') {
      const amp = this._verifyAmpBinary();
      if (!amp) {
        throw new Error(this._ampBinaryNotFoundMessage());
      }
      this._markInstalled(agentType);
      return {
        success: true,
        output: `${output}\nAmp CLI resolved: ${amp.path}${amp.version ? ` (${amp.version})` : ''}`,
      };
    }

    this._markInstalled(agentType);
    return { success: true, output };
  }

  /**
   * Install with streaming output via callback.
   * @param {string} agentType
   * @param {function(string)} onData - called with each chunk of output
   * @returns {Promise<{success: boolean, command: string}>}
   */
  async installStreaming(agentType, onData) {
    const { spawn } = require('child_process');
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    if (entry.install.api_only) {
      if (onData) onData(`${entry.label || agentType} uses direct API mode; no binary install needed.\n`);
      this._markInstalled(agentType);
      if (onData) onData(`\nDone! ${agentType} is now installed.\n`);
      return { success: true, command: 'api-only' };
    }

    let rawCmd = this._getInstallCommand(entry.install);
    if (!rawCmd) {
      throw new Error(`No install command for ${agentType} on ${Installer.platform()}`);
    }

    // Auto-install Node.js if this is an npm-based agent and Node.js is missing
    if (rawCmd.startsWith('npm install') && !this.hasNodejs()) {
      await this.installNodejs(onData);
    }

    const env = this._buildShellEnv();
    const isWin = process.platform === 'win32';

    // Build the spawn invocation. Three shapes:
    //   1. npm install via bundled `node npm-cli.js` — argv array, no shell.
    //      Path-safe under non-ASCII home dirs on Windows (preferred).
    //   2. npm install via legacy shell string (npm.cmd / npm) — fallback only
    //      when no node + npm-cli.js layout is found; OEM-codepage corruption
    //      means this breaks on non-ASCII paths, but still works for ASCII.
    //   3. pip / curl / powershell — keep the legacy shell-string behaviour.
    let spawnFile;
    let spawnArgs = [];
    let useShell;
    let installCwd;
    let displayCmd;

    if (rawCmd.startsWith('npm install')) {
      const prefixDir = getRuntimePrefix(agentType);
      fs.mkdirSync(prefixDir, { recursive: true });
      installCwd = prefixDir;

      // `npm install [-g] <pkg…>` → install --save --prefix <dir> <pkg…>
      const pkgArgs = rawCmd
        .replace(/^npm install\s*/, '')
        .replace(/(^|\s)-g(\s|$)/, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      // Use --save so npm tracks the package in package.json (prevents pruning
      // on next install).
      const npmArgs = ['install', '--loglevel=verbose', '--save', '--prefix', prefixDir, ...pkgArgs];
      displayCmd = `npm ${npmArgs.join(' ')}`;

      const direct = this._resolveNodeNpmCli();
      if (direct) {
        spawnFile = direct.node;
        spawnArgs = [direct.npmCli, ...npmArgs];
        useShell = false;
        // Ensure npm's own `node` child lookups (postinstall scripts) resolve
        // to this same runtime by putting its dir first on PATH.
        const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
        const nodeDir = path.dirname(direct.node);
        if (!(env[pathKey] || '').includes(nodeDir)) {
          env[pathKey] = nodeDir + (isWin ? ';' : ':') + (env[pathKey] || '');
        }
      } else {
        // Legacy fallback: quoted prefix inside a shell string.
        const args = `install --loglevel=verbose --save --prefix "${prefixDir}" ${pkgArgs.join(' ')}`;
        spawnFile = this._wrapForWindowsShell(this._resolveNpmCommand(args));
        useShell = isWin ? (env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : true;
        displayCmd = spawnFile;
      }
    } else {
      // pip / curl / powershell — unchanged shell-string behaviour.
      spawnFile = this._wrapForWindowsShell(rawCmd);
      useShell = isWin ? (env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : true;
      // Set cwd outside System32 on Windows.
      installCwd = os.homedir();
      displayCmd = spawnFile;
    }

    if (onData) onData(`$ ${displayCmd}\n\n`);

    return new Promise((resolve, reject) => {
      // windowsHide stops a console window from flashing up on every install.
      const proc = spawn(spawnFile, spawnArgs, { shell: useShell, env, cwd: installCwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

      if (proc.stdout) proc.stdout.setEncoding('utf-8');
      if (proc.stderr) proc.stderr.setEncoding('utf-8');

      let outputTail = '';
      const captureOutput = (d) => {
        const text = String(d);
        outputTail = (outputTail + text).slice(-4000);
        if (onData) onData(text);
      };

      if (proc.stdout) proc.stdout.on('data', captureOutput);
      if (proc.stderr) proc.stderr.on('data', captureOutput);

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) {
          // Aider-only: confirm a real, genuine binary exists before recording
          // the install (verify-before-mark; never writes a marker on
          // failure). Other agent types are unaffected.
          if (agentType === 'aider') {
            const aider = this._verifyAiderBinary();
            if (!aider) {
              const msg = this._aiderBinaryNotFoundMessage();
              if (onData) onData(`\n${msg}\n`);
              reject(new Error(msg));
              return;
            }
            if (onData) onData(`\nAider CLI resolved: ${aider.path}${aider.version ? ` (${aider.version})` : ''}\n`);
          }
          // Amp-only: confirm a real binary exists before recording the
          // install (verify-before-mark; never writes a marker on failure).
          if (agentType === 'amp') {
            const amp = this._verifyAmpBinary();
            if (!amp) {
              const msg = this._ampBinaryNotFoundMessage();
              if (onData) onData(`\n${msg}\n`);
              reject(new Error(msg));
              return;
            }
            if (onData) onData(`\nAmp CLI resolved: ${amp.path}${amp.version ? ` (${amp.version})` : ''}\n`);
          }
          // Hermes-only: its install.ps1 can exit 0 after a failed uv/setup step,
          // so verify a real binary exists before recording the install.
          if (agentType === 'hermes') {
            const hermes = this._verifyHermesBinary();
            if (!hermes) {
              const msg = this._hermesBinaryNotFoundMessage();
              if (onData) onData(`\n${msg}\n`);
              reject(new Error(msg));
              return;
            }
            if (onData) onData(`\nHermes CLI resolved: ${hermes.path}\n`);
          }
          this._markInstalled(agentType);
          if (onData) onData(`\nDone! ${agentType} is now installed.\n`);
          resolve({ success: true, command: displayCmd });
        } else {
          // A partial install can leave a placeholder stub at
          // bin/<binary>.exe and npm-generated cmd-shims under
          // node_modules/.bin/<name>{,.cmd,.ps1} that point to it. On
          // Windows, anything that later tries to run the binary (a health
          // check, a shell open) triggers a "this app can't run on your PC"
          // dialog because the stub isn't a real PE executable. Sweep them
          // up so the next install (or uninstall+reinstall) starts clean.
          try {
            this._cleanStaleShims(agentType);
            this._cleanStubBinary(agentType);
          } catch {}
          const tail = outputTail.trim();
          const msg = tail
            ? `Install failed with exit code ${code}\nCommand: ${displayCmd}\n\n${tail}`
            : `Install failed with exit code ${code}\nCommand: ${displayCmd}`;
          if (onData) onData(`\n${msg}\n`);
          reject(new Error(msg));
        }
      });
    });
  }

  /**
   * Remove the placeholder bin/<binary>.exe (and the npm package directory
   * if it's effectively empty) left over from a failed postinstall.
   */
  _cleanStubBinary(agentType) {
    const entry = this.registry.getEntry(agentType);
    const install = entry && entry.install;
    if (!install) return;
    const binary = install.binary || agentType;
    const npmPkg = install.npm_package
      || (() => {
          const cmd = this._getInstallCommand(install);
          if (!cmd || !cmd.includes('npm install')) return null;
          const m = cmd.match(/npm install\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@\S*)?$/);
          return m ? m[1] : null;
        })();
    if (!npmPkg) return;

    const prefix = getRuntimePrefix(agentType);
    const pkgDir = path.join(prefix, 'node_modules', npmPkg);
    const stubDir = path.join(pkgDir, 'bin');
    for (const ext of ['', '.exe', '.cmd', '.ps1']) {
      try {
        const f = path.join(stubDir, binary + ext);
        if (fs.existsSync(f) && fs.statSync(f).size < 4096) fs.unlinkSync(f);
      } catch {}
    }
  }

  /**
   * Uninstall an agent runtime.
   * @returns {Promise<{success: boolean, output: string}>}
   */
  async uninstall(agentType) {
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    if (entry.install.api_only) {
      this._markUninstalled(agentType);
      return { success: true, output: `${entry.label || agentType} API-only install marker removed.` };
    }

    const installCmd = this._getInstallCommand(entry.install);
    const uninstallCmd = this._deriveUninstallCommand(installCmd, agentType);
    if (!uninstallCmd) {
      throw new Error(`Cannot derive uninstall command for ${agentType}`);
    }

    const output = await this._execShell(uninstallCmd);
    this._markUninstalled(agentType);
    // Clean stale shims (npm sometimes leaves .cmd/.ps1 files behind)
    this._cleanStaleShims(agentType);
    return { success: true, output };
  }

  _cleanStaleShims(agentType) {
    const entry = this.registry.getEntry(agentType);
    const binary = entry && entry.install ? entry.install.binary : agentType;
    if (!binary) return;

    // Clean from isolated runtime prefix
    const runtimeBin = path.join(getRuntimePrefix(agentType), 'node_modules', '.bin');

    // Clean from legacy shared prefix
    const legacyDir = path.join(os.homedir(), '.openagents', 'nodejs');
    const legacyBin = path.join(legacyDir, 'node_modules', '.bin');

    for (const dir of [runtimeBin, legacyDir, legacyBin]) {
      for (const ext of ['', '.cmd', '.ps1']) {
        const shimPath = path.join(dir, binary + ext);
        try { if (fs.existsSync(shimPath)) fs.unlinkSync(shimPath); } catch {}
      }
    }
  }

  /**
   * Uninstall with streaming output via callback.
   */
  async uninstallStreaming(agentType, onData) {
    const { spawn } = require('child_process');
    const entry = this.registry.getEntry(agentType);
    if (!entry || !entry.install) {
      throw new Error(`No install definition for agent type: ${agentType}`);
    }

    if (entry.install.api_only) {
      if (onData) onData(`${entry.label || agentType} uses direct API mode; removing install marker.\n`);
      this._markUninstalled(agentType);
      if (onData) onData(`\nDone! ${agentType} has been uninstalled.\n`);
      return { success: true, command: 'api-only' };
    }

    const installCmd = this._getInstallCommand(entry.install);
    let rawCmd = this._deriveUninstallCommand(installCmd, agentType);
    if (!rawCmd) {
      throw new Error(`Cannot derive uninstall command for ${agentType}`);
    }

    // Resolve npm to use bundled node if system npm is not available
    let cmd = rawCmd;
    if (rawCmd.startsWith('npm uninstall')) {
      const args = rawCmd.replace('npm uninstall', 'uninstall --loglevel=verbose --no-save');
      cmd = this._resolveNpmCommand(args);
    }

    cmd = this._wrapForWindowsShell(cmd);

    if (onData) onData(`$ ${cmd}\n\n`);

    const env = this._buildShellEnv();
    const shell = process.platform === 'win32'
      ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
      : true;

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, [], { shell, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

      if (proc.stdout) proc.stdout.setEncoding('utf-8');
      if (proc.stderr) proc.stderr.setEncoding('utf-8');

      if (proc.stdout) proc.stdout.on('data', (d) => { if (onData) onData(d); });
      if (proc.stderr) proc.stderr.on('data', (d) => { if (onData) onData(d); });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) {
          this._markUninstalled(agentType);
          this._cleanStaleShims(agentType);
          if (onData) onData(`\nDone! ${agentType} has been uninstalled.\n`);
          resolve({ success: true, command: cmd });
        } else {
          const msg = `Uninstall failed with exit code ${code}`;
          if (onData) onData(`\n${msg}\n`);
          reject(new Error(msg));
        }
      });
    });
  }

  /**
   * Get install command for current platform.
   */
  _getInstallCommand(installCfg) {
    const plat = Installer.platform();
    return installCfg[plat] || installCfg.command || installCfg.npm || null;
  }

  /**
   * Derive uninstall command from install command.
   * @param {string} installCmd
   * @param {string} [agentType] - used to resolve the isolated runtime prefix
   */
  _deriveUninstallCommand(installCmd, agentType) {
    if (!installCmd) return null;

    // npm install -g <pkg> → npm uninstall --prefix <runtimeDir> <pkg>
    if (installCmd.includes('npm install')) {
      const prefixDir = agentType ? getRuntimePrefix(agentType) : path.join(os.homedir(), '.openagents', 'nodejs');
      return installCmd
        .replace('npm install -g', `npm uninstall --prefix "${prefixDir}"`)
        .replace('npm install', 'npm uninstall')
        .replace(/@latest/g, '')
        .replace(/@[\d.]+/g, '');
    }

    // pip install <pkg> → pip uninstall -y <pkg>
    if (installCmd.includes('pip install') || installCmd.includes('pip3 install')) {
      return installCmd
        .replace('pip install', 'pip uninstall -y')
        .replace('pip3 install', 'pip3 uninstall -y');
    }

    // pipx install <pkg> → pipx uninstall <pkg>
    if (installCmd.includes('pipx install')) {
      return installCmd.replace('pipx install', 'pipx uninstall');
    }

    return null;
  }

  /**
   * Find a binary on PATH (delegates to paths.js for cross-platform detection).
   */
  _whichBinary(agentType) {
    const entry = this.registry.getEntry(agentType);
    const binary = entry && entry.install ? entry.install.binary : agentType;
    const aliases = entry && entry.install && Array.isArray(entry.install.binary_aliases)
      ? entry.install.binary_aliases
      : [];
    for (const candidate of [binary, ...aliases]) {
      const found = whichBinary(candidate);
      if (found) return found;
    }
    // Fallback: resolve the installed package's OWN bin from its package.json
    // when npm did not create a node_modules/.bin/<binary> shim for the
    // top-level package. This happens for packages whose `bin` path is
    // declared as "./bin/x" (e.g. Cline): a local `npm install --prefix DIR`
    // links dependency bins but not the explicitly-installed root package's,
    // so a PATH lookup finds nothing even though the CLI is present and
    // runnable. Generic and backward-compatible — only runs after PATH misses.
    const pkgBin = this._resolvePackageBin(agentType, entry, binary);
    if (pkgBin) return pkgBin;
    return null;
  }

  /**
   * Resolve the absolute path to a package's own executable from its
   * package.json `bin` field, searched in the runtime and legacy prefixes.
   * Returns null when not installed there or the bin file is missing.
   */
  _resolvePackageBin(agentType, entry, binary) {
    // Derive the npm package name the same way getInstallInfo does.
    const npmPkg = entry && entry.install ? entry.install.npm_package : null;
    const installCmd = entry && entry.install ? this._getInstallCommand(entry.install) : null;
    let npmPkgFromCmd = null;
    if (!npmPkg && installCmd && installCmd.includes('npm install')) {
      const m = installCmd.match(/npm install\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@\S*)?$/);
      if (m) npmPkgFromCmd = m[1];
    }
    const pkgName = npmPkg || npmPkgFromCmd || binary;
    const prefixes = [
      path.join(getRuntimePrefix(agentType), 'node_modules'),
      path.join(os.homedir(), '.openagents', 'nodejs', 'node_modules'),
    ];
    for (const modules of prefixes) {
      const pkgDir = path.join(modules, pkgName);
      const pkgJsonPath = path.join(pkgDir, 'package.json');
      try {
        if (!fs.existsSync(pkgJsonPath)) continue;
        const bin = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')).bin;
        let rel = null;
        if (typeof bin === 'string') rel = bin;
        else if (bin && typeof bin === 'object') rel = bin[binary] || bin[pkgName] || Object.values(bin)[0];
        if (!rel) continue;
        const abs = path.join(pkgDir, rel);
        if (fs.existsSync(abs)) return abs;
      } catch {}
    }
    return null;
  }

  // -- Markers --

  _hasMarker(agentType) {
    // Check per-agent marker file first (faster)
    try {
      if (fs.existsSync(path.join(this.markersDir, agentType))) return true;
    } catch {}

    // Check JSON markers file
    try {
      if (fs.existsSync(this.markersFile)) {
        const data = JSON.parse(fs.readFileSync(this.markersFile, 'utf-8'));
        if (Array.isArray(data) && data.includes(agentType)) return true;
      }
    } catch {}

    return false;
  }

  _markInstalled(agentType) {
    // JSON file
    try {
      fs.mkdirSync(this.configDir, { recursive: true });
      let markers = [];
      try {
        markers = JSON.parse(fs.readFileSync(this.markersFile, 'utf-8'));
        if (!Array.isArray(markers)) markers = [];
      } catch {}
      if (!markers.includes(agentType)) {
        markers.push(agentType);
        markers.sort();
      }
      fs.writeFileSync(this.markersFile, JSON.stringify(markers), 'utf-8');
    } catch {}

    // Per-agent marker file
    try {
      fs.mkdirSync(this.markersDir, { recursive: true });
      fs.writeFileSync(path.join(this.markersDir, agentType), '', 'utf-8');
    } catch {}

    // Drop the 30s PATH/whichBinary caches so the very next getInstallInfo
    // sees the freshly-created bin dir (e.g. ~/.cursor/bin) instead of the
    // pre-install snapshot. Without this, install completes but UI keeps
    // showing "not installed" until the cache expires. Also drop the version
    // cache so an upgrade's new version is reflected immediately.
    try { clearBinaryLookupCache(); } catch {}
    try { clearVersionCache(); } catch {}
  }

  _markUninstalled(agentType) {
    // JSON file
    try {
      if (fs.existsSync(this.markersFile)) {
        let markers = JSON.parse(fs.readFileSync(this.markersFile, 'utf-8'));
        if (Array.isArray(markers)) {
          markers = markers.filter((m) => m !== agentType);
          fs.writeFileSync(this.markersFile, JSON.stringify(markers), 'utf-8');
        }
      }
    } catch {}

    // Per-agent marker file
    try {
      const markerFile = path.join(this.markersDir, agentType);
      if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);
    } catch {}

    // Symmetric with _markInstalled: invalidate so detection re-runs cleanly.
    try { clearBinaryLookupCache(); } catch {}
    try { clearVersionCache(); } catch {}
  }

  // -- Shell env + exec --

  _buildShellEnv() {
    const env = { ...process.env };
    const sep = process.platform === 'win32' ? ';' : ':';
    const extraDirs = [];
    try { extraDirs.push(path.dirname(process.execPath)); } catch {}

    // Whether a usable `node` is already reachable WITHOUT the bundled
    // standalone node.exe. We must avoid shadowing a working system node with
    // the launcher's bundled exe: that file is an unsigned standalone
    // node.exe and on some Windows machines Defender/SmartScreen blocks
    // CreateProcess on it, which surfaces as `cmd: 拒绝访问` ("Access
    // Denied") when npm runs `node install.cjs` for packages like
    // @anthropic-ai/claude-code, plus a "this app can't run on your PC"
    // dialog.
    const bundledDir = path.join(this.configDir, 'nodejs');
    const hasSystemNode = this._hasSystemNode(bundledDir);

    if (process.platform === 'win32') {
      const appData = env.APPDATA || '';
      if (appData) extraDirs.push(path.join(appData, 'npm'));
      extraDirs.push(env.ProgramFiles ? path.join(env.ProgramFiles, 'nodejs') : 'C:\\Program Files\\nodejs');
      extraDirs.push(env.SystemRoot ? path.join(env.SystemRoot, 'System32') : 'C:\\Windows\\System32');
      extraDirs.push(env.ProgramFiles ? path.join(env.ProgramFiles, 'Git', 'cmd') : 'C:\\Program Files\\Git\\cmd');

      // Bundled node — fallback only. Skip if system node works, otherwise
      // verify the bundled exe can actually launch before exposing it.
      if (!hasSystemNode) {
        try {
          if (fs.existsSync(bundledDir)) {
            const directExe = path.join(bundledDir, 'node.exe');
            if (fs.existsSync(directExe) && this._canExecute(directExe)) {
              extraDirs.unshift(bundledDir);
            }
            for (const entry of fs.readdirSync(bundledDir).filter(e => e.startsWith('node-'))) {
              const nested = path.join(bundledDir, entry);
              if (fs.existsSync(path.join(nested, 'node.exe')) && this._canExecute(path.join(nested, 'node.exe'))) {
                extraDirs.unshift(nested);
              }
            }
          }
        } catch {}
      }
    } else {
      extraDirs.push('/usr/local/bin', '/opt/homebrew/bin');
      if (!hasSystemNode) {
        try {
          const candidates = [
            path.join(bundledDir, 'bin', 'node'),
            path.join(bundledDir, 'node'),
          ];
          for (const bin of candidates) {
            if (fs.existsSync(bin) && this._canExecute(bin)) {
              extraDirs.unshift(path.dirname(bin));
              break;
            }
          }
        } catch {}
      }
    }
    // On Windows the spread above yields a "Path" key, not "PATH". Writing
    // `env.PATH` would create a duplicate key holding only extraDirs and drop
    // everything else; libuv then resolves spawned binaries against the wrong,
    // truncated value. Update the existing case-insensitive key in place.
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    for (const d of extraDirs) {
      if (d && !(env[pathKey] || '').includes(d)) {
        env[pathKey] = d + sep + (env[pathKey] || '');
      }
    }
    return env;
  }

  /**
   * True if `node` exists outside the bundled launcher directory. Uses raw
   * process.env.PATH (no enhancement) so we don't accidentally detect the
   * bundled node and conclude that "system node exists".
   */
  _hasSystemNode(bundledDir) {
    try {
      const { execFileSync } = require('child_process');
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      const args = process.platform === 'win32' ? ['node'] : ['node'];
      const out = execFileSync(cmd, args, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env },
      });
      const prefix = (bundledDir || '').toLowerCase();
      for (const line of out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
        if (!prefix || !line.toLowerCase().startsWith(prefix)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Smoke-test a node binary by running `--version`. Returns false on any
   * failure (missing exe, blocked by AV, arch mismatch, signature policy).
   */
  _canExecute(binaryPath) {
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync(binaryPath, ['--version'], {
        timeout: 5000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return r.status === 0 && !r.error;
    } catch {
      return false;
    }
  }

  /**
   * Check if Node.js/npm is available on the system.
   */
  hasNodejs() {
    if (whichBinary('node') && whichBinary('npm')) return true;
    // Check bundled Node.js in ~/.openagents/nodejs/
    if (process.platform === 'win32') {
      try {
        const bundledDir = path.join(this.configDir, 'nodejs');
        if (fs.existsSync(bundledDir)) {
          const entries = fs.readdirSync(bundledDir).filter(e => e.startsWith('node-'));
          if (entries.length > 0) {
            const nodeExe = path.join(bundledDir, entries[0], 'node.exe');
            return fs.existsSync(nodeExe);
          }
        }
      } catch {}
    }
    return false;
  }

  /**
   * Download and install Node.js LTS. Streams progress via onData callback.
   * After install, updates PATH so npm is available for subsequent commands.
   * @param {function(string)} onData
   * @returns {Promise<void>}
   */
  async installNodejs(onData) {
    const { spawn: spawnProc } = require('child_process');
    const https = require('https');
    const os = require('os');
    const nodeVersion = 'v22.22.3';
    const plat = Installer.platform();

    if (onData) onData(`Node.js not found. Installing Node.js ${nodeVersion}...\n\n`);

    if (plat === 'windows') {
      // Download portable zip — no admin required
      const arch = os.arch() === 'x64' ? 'x64' : 'x86';
      const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-win-${arch}.zip`;
      const zipPath = path.join(os.tmpdir(), `node-${nodeVersion}.zip`);

      if (onData) onData(`Downloading ${url}...\n`);
      await this._downloadFile(url, zipPath, onData);

      // Extract to ~/.openagents/nodejs/
      const nodejsDir = path.join(this.configDir, 'nodejs');
      fs.mkdirSync(nodejsDir, { recursive: true });

      if (onData) onData(`\nExtracting Node.js to ${nodejsDir}...\n`);
      await new Promise((resolve, reject) => {
        const proc = spawnProc('powershell', [
          '-NoProfile', '-Command',
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${nodejsDir}' -Force`
        ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        if (proc.stdout) proc.stdout.on('data', (d) => { if (onData) onData(d.toString()); });
        if (proc.stderr) proc.stderr.on('data', (d) => { if (onData) onData(d.toString()); });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Extraction failed with code ${code}`));
        });
      });

      // The zip extracts to node-vX.X.X-win-x64/ subfolder — flatten it
      const extractedDir = path.join(nodejsDir, `node-${nodeVersion}-win-${arch}`);
      if (fs.existsSync(extractedDir)) {
        if (onData) onData('Flattening Node.js directory...\n');
        const entries = fs.readdirSync(extractedDir);
        for (const entry of entries) {
          const src = path.join(extractedDir, entry);
          const dest = path.join(nodejsDir, entry);
          if (!fs.existsSync(dest)) {
            fs.renameSync(src, dest);
          } else if (fs.statSync(src).isDirectory() && fs.statSync(dest).isDirectory()) {
            // Merge directories (e.g. node_modules)
            const subEntries = fs.readdirSync(src);
            for (const sub of subEntries) {
              const subSrc = path.join(src, sub);
              const subDest = path.join(dest, sub);
              if (!fs.existsSync(subDest)) fs.renameSync(subSrc, subDest);
            }
          }
        }
        // Remove empty nested dir
        try { fs.rmdirSync(extractedDir, { recursive: true }); } catch {}
      }
      const sep = ';';

      // Add nodejs dir to PATH for this session
      if (!(process.env.PATH || '').includes(nodejsDir)) {
        process.env.PATH = nodejsDir + sep + (process.env.PATH || '');
      }
      // npm global installs go to %APPDATA%\npm
      const npmGlobal = path.join(process.env.APPDATA || '', 'npm');
      if (npmGlobal && !(process.env.PATH || '').includes(npmGlobal)) {
        process.env.PATH = npmGlobal + sep + process.env.PATH;
      }

    } else {
      // macOS / Linux: download portable tar.gz/tar.xz, extract to ~/.openagents/nodejs/
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const ext = plat === 'macos' ? 'tar.gz' : 'tar.xz';
      const platName = plat === 'macos' ? 'darwin' : 'linux';
      const url = `https://nodejs.org/dist/${nodeVersion}/node-${nodeVersion}-${platName}-${arch}.${ext}`;
      const tarPath = path.join(os.tmpdir(), `node-${nodeVersion}.${ext}`);

      if (onData) onData(`Downloading ${url}...\n`);
      await this._downloadFile(url, tarPath, onData);

      const nodeDir = path.join(this.configDir, 'nodejs');
      fs.mkdirSync(nodeDir, { recursive: true });

      if (onData) onData(`\nExtracting to ${nodeDir}...\n`);
      const tarFlag = ext === 'tar.gz' ? '-xzf' : '-xJf';
      await new Promise((resolve, reject) => {
        const proc = spawnProc('tar', [tarFlag, tarPath, '-C', nodeDir, '--strip-components=1'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (proc.stdout) proc.stdout.on('data', (d) => { if (onData) onData(d.toString()); });
        if (proc.stderr) proc.stderr.on('data', (d) => { if (onData) onData(d.toString()); });
        proc.on('error', reject);
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Extraction failed with code ${code}`));
        });
      });

      // Add portable node bin to PATH
      const nodeBin = path.join(nodeDir, 'bin');
      if (!(process.env.PATH || '').includes(nodeBin)) {
        process.env.PATH = nodeBin + ':' + (process.env.PATH || '');
      }
    }

    if (onData) onData(`\nNode.js ${nodeVersion} installed successfully.\n\n`);
  }

  /**
   * Download a file with progress reporting.
   */
  _downloadFile(url, destPath, onData) {
    const https = require('https');
    const http = require('http');
    return new Promise((resolve, reject) => {
      const get = url.startsWith('https') ? https.get : http.get;
      get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          return this._downloadFile(res.headers.location, destPath, onData).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        let lastPercent = -1;
        const file = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.floor((downloaded / totalBytes) * 100);
            if (pct !== lastPercent && pct % 10 === 0) {
              lastPercent = pct;
              if (onData) onData(`  ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)\n`);
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Locate a `node` binary plus its `npm-cli.js` so npm can be invoked as
   * `node npm-cli.js …` with argv passed array-style and NO shell. On Windows
   * that goes through CreateProcessW (UTF-16), so an install prefix under a
   * non-ASCII home dir (e.g. `C:\Users\用户名\.openagents\runtimes\…`) is
   * preserved exactly. The legacy `npm.cmd` shell shim instead has cmd.exe
   * decode the path bytes with the OEM code page (936/GBK on zh-CN), corrupting
   * it and silently breaking every install. Returns { node, npmCli } or null
   * when no usable layout is found (caller falls back to the legacy shell
   * command, which still works for ASCII paths).
   */
  _resolveNodeNpmCli() {
    const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
    const isWin = process.platform === 'win32';
    const nodeName = isWin ? 'node.exe' : 'node';

    const nodeCandidates = [];
    // Bundled portable node (~/.openagents/nodejs, plus nested node-* layouts)
    const bundledDir = path.join(this.configDir, 'nodejs');
    nodeCandidates.push(path.join(bundledDir, nodeName));
    nodeCandidates.push(path.join(bundledDir, 'bin', 'node'));
    try {
      for (const e of fs.readdirSync(bundledDir)) {
        if (e.startsWith('node-')) {
          nodeCandidates.push(path.join(bundledDir, e, nodeName));
          nodeCandidates.push(path.join(bundledDir, e, 'bin', 'node'));
        }
      }
    } catch {}
    // System node — its npm-cli.js lives next to (or one level above) it.
    try {
      const sys = whichBinary('node');
      if (sys) nodeCandidates.push(sys);
    } catch {}

    for (const node of nodeCandidates) {
      if (!node || !exists(node)) continue;
      const dir = path.dirname(node);
      const npmCli = [
        path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ].find(exists);
      if (npmCli && this._canExecute(node)) return { node, npmCli };
    }
    return null;
  }

  /**
   * Resolve the npm CLI command. Uses system npm if available.
   */
  _resolveNpmCommand(args) {
    const systemNpm = whichBinary('npm');
    const npmBin = systemNpm ? `"${systemNpm}"` : 'npm';

    // On macOS/Linux, use a user-writable prefix to avoid sudo for global installs
    if (process.platform !== 'win32' && args.includes('-g')) {
      const globalDir = path.join(this.configDir, 'npm-global');
      fs.mkdirSync(globalDir, { recursive: true });
      // Add the bin dir to PATH so installed binaries are found
      const binDir = path.join(globalDir, 'bin');
      if (!(process.env.PATH || '').includes(binDir)) {
        process.env.PATH = binDir + ':' + (process.env.PATH || '');
      }
      return `${npmBin} --prefix "${globalDir}" ${args}`;
    }

    return `${npmBin} ${args}`;
  }

  /**
   * Wrap a command in `powershell.exe -Command "..."` when (a) we're on Windows
   * and (b) the command uses PowerShell-only tokens like `irm`, `iex`,
   * `Invoke-RestMethod`, etc. The launcher's install shell is cmd.exe, which
   * doesn't recognize these aliases — without wrapping, e.g. Cursor's
   * `irm '…' | iex` exits 255. Skips commands already prefixed with
   * `powershell`/`powershell.exe` so we don't double-wrap.
   */
  _wrapForWindowsShell(cmd) {
    if (!cmd || process.platform !== 'win32') return cmd;
    const trimmed = cmd.trimStart();
    if (/^("[^"]*\\)?powershell(\.exe)?["']?\s/i.test(trimmed)) return cmd;
    const psTokens = /\b(irm|iwr|iex|Invoke-RestMethod|Invoke-WebRequest|Invoke-Expression|Expand-Archive|Get-[A-Z]\w*|Set-[A-Z]\w*)\b/;
    if (!psTokens.test(cmd)) return cmd;
    const escaped = cmd.replace(/"/g, '\\"');
    return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${escaped}"`;
  }

  _execShell(cmd, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const env = this._buildShellEnv();

      let shell = true;
      if (process.platform === 'win32') {
        shell = env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
      }

      const finalCmd = this._wrapForWindowsShell(cmd);
      exec(finalCmd, {
        encoding: 'utf-8',
        timeout: timeoutMs,
        shell,
        env,
      }, (error, stdout, stderr) => {
        const output = ((stdout || '') + '\n' + (stderr || '')).trim();
        if (error) {
          const err = new Error(output || error.message);
          err.exitCode = error.code;
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }
}

module.exports = { Installer, compareVersions, clearVersionCache };
