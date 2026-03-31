/**
 * Agent manager for the OpenAgents Launcher.
 *
 * Thin adapter over @openagents-org/agent-launcher — provides the same
 * IPC-facing API as the old Python-based agent-manager, but all operations
 * are now pure Node.js (no Python subprocess calls).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.openagents');
// All platforms use --prefix, so node_modules/ is always the location
const GLOBAL_CORE = path.join(CONFIG_DIR, 'nodejs', 'node_modules', '@openagents-org', 'agent-launcher');

// Load core library from global install (not bundled asar)
function loadCore() {
  if (fs.existsSync(path.join(GLOBAL_CORE, 'package.json'))) {
    try { return require(GLOBAL_CORE); } catch {}
  }
  // Fallback to bundled (for dev mode or if global not yet installed)
  try { return require('@openagents-org/agent-launcher'); } catch {}
  return null;
}

let core = loadCore();

class AgentManager {
  constructor(store) {
    this._store = store;
    if (!core) core = loadCore();
    if (core) {
      this._connector = new core.AgentConnector({ configDir: CONFIG_DIR });
    } else {
      // Core not available yet — will be initialized after install
      this._connector = null;
    }
  }

  getSupportedAgentTypes() {
    const supported = core?.adapters?.ADAPTER_MAP
      ? Object.keys(core.adapters.ADAPTER_MAP)
      : [];
    return supported.sort();
  }

  /** Reload core library after install/update */
  reloadCore() {
    // Clear require cache for global path
    const cacheKeys = Object.keys(require.cache).filter(k => k.includes('agent-launcher'));
    for (const k of cacheKeys) delete require.cache[k];
    core = loadCore();
    if (core) {
      this._connector = new core.AgentConnector({ configDir: CONFIG_DIR });
    }
    return !!core;
  }

  get coreVersion() {
    try {
      const pkg = path.join(GLOBAL_CORE, 'package.json');
      if (fs.existsSync(pkg)) return JSON.parse(fs.readFileSync(pkg, 'utf-8')).version;
    } catch {}
    // Fallback to bundled
    try { return require('@openagents-org/agent-launcher/package.json').version; } catch {}
    return null;
  }

  _ensureConnector() {
    if (!this._connector) {
      if (!this.reloadCore()) {
        throw new Error('Core library not installed. Install an agent first via the Install tab.');
      }
    }
  }

  // ------------------------------------------------------------------
  // Agent listing (merges config + status + env)
  // ------------------------------------------------------------------

  getAgents() {
    if (!this._connector) return [];
    const agents = this._connector.listAgents();
    const status = this.getAllStatus();

    return agents.map((a) => ({
      ...a,
      state: status[a.name]?.state || 'stopped',
      restarts: status[a.name]?.restarts || 0,
      lastError: status[a.name]?.last_error || null,
    }));
  }

  // ------------------------------------------------------------------
  // Agent CRUD
  // ------------------------------------------------------------------

  async addAgent(agentConfig) {
    const name = agentConfig.name;
    const type = agentConfig.type || 'openclaw';
    const supportedTypes = this.getSupportedAgentTypes();

    if (supportedTypes.length > 0 && !supportedTypes.includes(type)) {
      throw new Error(`Agent type '${type}' is not supported in Launcher yet. Supported: ${supportedTypes.join(', ')}`);
    }

    this._connector.addAgent({ name, type, role: 'worker' });

    // Save env vars for the agent type
    if (agentConfig.env && Object.keys(agentConfig.env).length > 0) {
      this._connector.saveAgentEnv(type, agentConfig.env);
    }

    return { success: true, agent: agentConfig };
  }

  async removeAgent(name) {
    try { await this.stopAgent(name); } catch {}
    this._connector.removeAgent(name);
    return { success: true };
  }

  async updateAgent(name, updates) {
    if (updates.env) {
      const agents = this._connector.listAgents();
      const agent = agents.find((a) => a.name === name);
      const type = agent ? agent.type : 'openclaw';
      this._connector.saveAgentEnv(type, updates.env);
    }
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Agent catalog & env config
  // ------------------------------------------------------------------

  async getCatalog() {
    let catalog;
    try {
      catalog = await this._connector.getCatalog();
    } catch {
      catalog = this._connector.registry.getCatalogSync().map((e) => {
        const info = this._connector.installer.getInstallInfo(e.name);
        return { ...e, installed: info.installed, managed: info.managed, location: info.location };
      });
    }
    // Ensure bundled fields (check_ready, env_config, launch) are always present
    const bundled = this._connector.registry._loadBundled();
    for (const entry of catalog) {
      const b = bundled.find(x => x.name === entry.name);
      if (b) {
        if (!entry.check_ready && b.check_ready) entry.check_ready = b.check_ready;
        if ((!entry.env_config || !entry.env_config.length) && b.env_config?.length) entry.env_config = b.env_config;
        if (!entry.install && b.install) entry.install = b.install;
        if (!entry.launch && b.launch) entry.launch = b.launch;
      }
    }
    return catalog;
  }

  async getEnvFields(agentType) {
    return this._connector.getEnvFields(agentType);
  }

  getAgentEnv(agentType) {
    return this._connector.getAgentEnv(agentType);
  }

  saveAgentEnv(agentType, env) {
    this._connector.saveAgentEnv(agentType, env);

    // Configure agent-specific native auth (e.g., OpenClaw's auth-profiles.json)
    try {
      if (agentType === 'openclaw') {
        const OpenClawAdapter = require('@openagents-org/agent-launcher/src/adapters/openclaw');
        OpenClawAdapter.configureNativeAuth(env);
      }
    } catch {}

    this.signalReload();
    return { success: true };
  }

  async testLLM(env) {
    return this._connector.testLLM(env);
  }

  signalReload() {
    const pid = this._connector.getDaemonPid();
    if (!pid) return;

    if (process.platform === 'win32') {
      this._connector.sendDaemonCommand('reload');
    } else {
      try { process.kill(pid, 'SIGHUP'); } catch {}
    }
  }

  // ------------------------------------------------------------------
  // Workspace
  // ------------------------------------------------------------------

  getNetworks() {
    return this._connector.listWorkspaces();
  }

  async createWorkspace(name) {
    return this._connector.createWorkspace({ name: name || 'My Workspace' });
  }

  async connectWorkspace(agentName, tokenOrSlug) {
    // Resolve the token to get workspace info (slug, name, id)
    try {
      const info = await this._connector.resolveToken(tokenOrSlug);
      const slug = info.slug || info.workspace_id;
      const wsName = info.name || slug;

      // Save network to config
      this._connector.config.addNetwork({
        id: info.workspace_id,
        slug,
        name: wsName,
        endpoint: info.endpoint || this._connector.workspace?.endpoint,
        token: tokenOrSlug,
      });

      // Connect agent to the resolved slug
      this._connector.connectWorkspace(agentName, slug);
    } catch {
      // Fallback: treat as slug directly
      this._connector.connectWorkspace(agentName, tokenOrSlug);
    }
    this.signalReload();
    return { success: true };
  }

  async disconnectWorkspace(agentName) {
    this._connector.disconnectWorkspace(agentName);
    this.signalReload();
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Agent type install / uninstall
  // ------------------------------------------------------------------

  async checkAgentType(agentType) {
    const installed = this._connector.isInstalled(agentType);
    const binary = installed ? this._connector.installer.which(agentType) : null;
    return { installed, binary: binary || null };
  }

  async installAgentType(agentType) {
    return this._connector.install(agentType);
  }

  async installAgentTypeStreaming(agentType, onData) {
    const result = await this._connector.installer.installStreaming(agentType, onData);
    this._connector.clearCatalogCache();
    return result;
  }

  async uninstallAgentType(agentType) {
    const result = await this._connector.uninstall(agentType);
    this._connector.clearCatalogCache();
    return result;
  }

  async uninstallAgentTypeStreaming(agentType, onData) {
    const result = await this._connector.installer.uninstallStreaming(agentType, onData);
    this._connector.clearCatalogCache();
    return result;
  }

  // ------------------------------------------------------------------
  // Daemon lifecycle
  // ------------------------------------------------------------------

  async startAgent(name) {
    // Ensure daemon is running (long-lived background process)
    await this._ensureDaemon();
    // Send start command — daemon will launch the agent's adapter
    this._connector.sendDaemonCommand(`start:${name}`);
    return { success: true, message: `Start command sent for ${name}` };
  }

  async stopAgent(name) {
    const pid = this._connector.getDaemonPid();
    if (!pid) {
      return { success: true, message: 'Daemon not running' };
    }
    // Send stop command — daemon stops only this agent, keeps running
    this._connector.sendDaemonCommand(`stop:${name}`);
    return { success: true, message: `Stop command sent for ${name}` };
  }

  async startAll() {
    // Ensure daemon is running, then restart all agents
    await this._ensureDaemon();
    this._connector.sendDaemonCommand('reload');
    return { success: true, message: 'Start all command sent' };
  }

  async stopAll() {
    const stopped = this._connector.stopDaemon();
    return { success: stopped, message: stopped ? 'Daemon stopped' : 'Daemon not running' };
  }

  /**
   * Ensure the daemon is running. Start it if not.
   * The daemon is a long-lived process — it stays running and
   * individual agents are started/stopped via commands.
   */
  async _ensureDaemon() {
    const pid = this._connector.getDaemonPid();
    if (pid) {
      // Daemon already running — don't restart (avoids status flicker)
      return;
    }
    // Don't attempt if Node.js isn't installed yet
    const portableNodeDir = path.join(os.homedir(), '.openagents', 'nodejs');
    // Check both unified path (symlink) and legacy platform-specific path
    const nodeBin = path.join(portableNodeDir, 'node' + (process.platform === 'win32' ? '.exe' : ''));
    const nodeBinLegacy = path.join(portableNodeDir, 'bin', 'node');
    if (!fs.existsSync(nodeBin) && !fs.existsSync(nodeBinLegacy)) return;

    return this._startDaemon();
  }

  getAllStatus() {
    // Read status file directly — PID validation is unreliable in Electron
    // on Windows (cross-session process.kill, fs.existsSync races).
    // The daemon cleans up its own status file on exit.
    return this._connector.getDaemonStatus();
  }

  getLogs(name, lines = 200) {
    const logLines = this._connector.getLogs(name, lines);
    return { lines: logLines };
  }

  healthCheck(type) {
    return this._connector.healthCheck(type);
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  _startDaemon() {
    try { this._connector.stopDaemon(); } catch {}

    const { spawn } = require('child_process');
    const portableNodeDir = path.join(os.homedir(), '.openagents', 'nodejs');

    // Build enhanced PATH with portable Node.js and agent binaries
    const openagentsDir = path.join(os.homedir(), '.openagents');
    const extraDirs = [
      portableNodeDir,                                      // node, npm (unified via symlinks)
      path.join(portableNodeDir, 'bin'),                    // legacy macOS/Linux node, npm
    ];
    // Add per-agent runtime bin dirs (~/.openagents/runtimes/<type>/node_modules/.bin)
    const runtimesDir = path.join(openagentsDir, 'runtimes');
    try {
      for (const d of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
        if (d.isDirectory()) extraDirs.push(path.join(runtimesDir, d.name, 'node_modules', '.bin'));
      }
    } catch {}
    // Core library bin
    extraDirs.push(path.join(openagentsDir, 'core', 'node_modules', '.bin'));
    // Legacy shared bin
    extraDirs.push(path.join(portableNodeDir, 'node_modules', '.bin'));
    if (process.platform === 'win32') {
      extraDirs.push(path.join(process.env.APPDATA || '', 'npm'));
    }
    const enhancedPath = [...extraDirs, process.env.PATH || ''].join(path.delimiter);

    // Find CLI entry point on disk (NOT in asar)
    // All platforms use --prefix ~/.openagents/nodejs → node_modules/
    let cliPath = null;
    const cliCandidates = [
      path.join(portableNodeDir, 'node_modules', '@openagents-org', 'agent-launcher', 'bin', 'agent-connector.js'),
    ];
    for (const c of cliCandidates) {
      try { if (fs.existsSync(c)) { cliPath = c; break; } } catch {}
    }
    if (!cliPath) {
      return { success: false, message: 'agent-launcher CLI not found. Install an agent first via the Install tab.' };
    }

    // Find node binary
    let nodeBin = path.join(portableNodeDir, 'node' + (process.platform === 'win32' ? '.exe' : ''));
    if (!fs.existsSync(nodeBin)) {
      try {
        const { execSync } = require('child_process');
        nodeBin = execSync(process.platform === 'win32' ? 'where node' : 'which node',
          { encoding: 'utf-8', timeout: 5000, env: { ...process.env, PATH: enhancedPath } }).split(/\r?\n/)[0].trim();
      } catch { nodeBin = 'node'; }
    }

    // Spawn daemon as detached background process
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const logFile = path.join(CONFIG_DIR, 'daemon.log');
      const pidFile = path.join(CONFIG_DIR, 'daemon.pid');
      const logFd = fs.openSync(logFile, 'a');

      const proc = spawn(nodeBin, [cliPath, 'up', '--foreground'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PATH: enhancedPath },
        windowsHide: true,
      });
      proc.unref();
      fs.writeFileSync(pidFile, String(proc.pid), 'utf-8');
      fs.closeSync(logFd);

      return { success: true, pid: proc.pid, message: `Daemon started (PID ${proc.pid})` };
    } catch (e) {
      return { success: false, message: `Failed to start daemon: ${e.message}` };
    }
  }
}

module.exports = { AgentManager };
