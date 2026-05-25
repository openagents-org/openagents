'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, exec } = require('child_process');
const { whichBinary, getEnhancedEnv, getRuntimePrefix } = require('./paths');
const { EnvManager } = require('./env');

const STATUS_CACHE_TTL_MS = 10000;
const statusCache = new Map();

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
      try { fs.unlinkSync(path.join(this.markersDir, agentType)); } catch {}
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
        require('child_process').execSync(verifyCmd, { stdio: 'ignore', timeout: 5000 });
        return true;
      } catch { return false; }
    }
    return this.isInstalled(agentType);
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
          ready: false,
          auth_mode: null,
          execution_mode: 'unavailable',
          message: 'Not installed',
        };
      }

      return {
        installed: true,
        binary: null,
        version: null,
        ...this._evaluateReadiness(agentType, entry, null),
      };
    }

    const binary = this._whichBinary(agentType);
    if (!binary) {
      return {
        installed: false,
        binary: null,
        version: null,
        ready: false,
        auth_mode: null,
        execution_mode: 'unavailable',
        message: 'Not installed',
      };
    }

    const checkCmd = entry && entry.install ? entry.install.check_command : null;
    const versionCmd = checkCmd || `${entry && entry.install && entry.install.binary || agentType} --version`;

    let version = null;
    try {
      const raw = execSync(versionCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getEnhancedEnv(),
        timeout: 10000,
      }).trim();
      // Extract version number (e.g. "openclaw 2024.1.5" → "2024.1.5")
      const match = raw.match(/(\d+[\d.]+\d+)/);
      version = match ? match[1] : raw.split('\n')[0];
    } catch {}

    const readiness = this._evaluateReadiness(agentType, entry, binary);
    return { installed: true, binary, version, ...readiness };
  }

  _evaluateReadiness(agentType, entry, binary) {
    const checkReady = entry?.check_ready;
    if (!checkReady) {
      return {
        ready: true,
        auth_mode: null,
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

    let cliReady = false;
    if (checkReady.status_command && binary) {
      cliReady = this._checkStatusCommand(checkReady.status_command);
    }

    if (directReady) {
      return {
        ready: true,
        auth_mode: 'api_key',
        execution_mode: 'direct',
        message: 'Ready',
      };
    }

    if (cliReady) {
      return {
        ready: true,
        auth_mode: 'cli_login',
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
        execution_mode: 'direct',
        message: 'Ready',
      };
    }

    if (credsReady) {
      return {
        ready: true,
        auth_mode: 'cli_login',
        execution_mode: 'subprocess',
        message: 'Ready',
      };
    }

    return {
      ready: false,
      auth_mode: null,
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

    // Resolve npm command
    let cmd = rawCmd;
    if (rawCmd.startsWith('npm install')) {
      const prefixDir = getRuntimePrefix(agentType);
      fs.mkdirSync(prefixDir, { recursive: true });
      // Use --save so npm tracks the package in package.json (prevents pruning on next install)
      const args = rawCmd.replace('npm install', 'install --loglevel=verbose --save').replace(' -g ', ` --prefix "${prefixDir}" `);
      cmd = this._resolveNpmCommand(args);
    } else if (rawCmd.startsWith('pip install') || rawCmd.startsWith('pipx install')) {
      cmd = rawCmd; // pip commands stay as-is
    }

    if (onData) onData(`$ ${cmd}\n\n`);

    const env = this._buildShellEnv();
    const shell = process.platform === 'win32'
      ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
      : true;
    // Set cwd to runtime prefix dir (avoids running from System32 on Windows)
    const installCwd = rawCmd.startsWith('npm install') ? getRuntimePrefix(agentType) : os.homedir();

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, [], { shell, env, cwd: installCwd, stdio: ['ignore', 'pipe', 'pipe'] });

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
          this._markInstalled(agentType);
          if (onData) onData(`\nDone! ${agentType} is now installed.\n`);
          resolve({ success: true, command: cmd });
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
            ? `Install failed with exit code ${code}\nCommand: ${cmd}\n\n${tail}`
            : `Install failed with exit code ${code}\nCommand: ${cmd}`;
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

    if (onData) onData(`$ ${cmd}\n\n`);

    const env = this._buildShellEnv();
    const shell = process.platform === 'win32'
      ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
      : true;

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, [], { shell, env, stdio: ['ignore', 'pipe', 'pipe'] });

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
    for (const d of extraDirs) {
      if (d && !(env.PATH || '').includes(d)) {
        env.PATH = d + sep + (env.PATH || '');
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
    const nodeVersion = 'v22.16.0';
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
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
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

  _execShell(cmd, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const env = this._buildShellEnv();

      let shell = true;
      if (process.platform === 'win32') {
        shell = env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
      }

      exec(cmd, {
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

module.exports = { Installer };
