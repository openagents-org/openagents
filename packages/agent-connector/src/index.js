'use strict';

const { Config } = require('./config');
const { EnvManager } = require('./env');
const { Registry } = require('./registry');
const { Installer } = require('./installer');
const { Daemon } = require('./daemon');
const { WorkspaceClient } = require('./workspace-client');

/**
 * Main entry point for the agent-connector library.
 * Provides agent management, configuration, and lifecycle control.
 */
class AgentConnector {
  constructor(opts = {}) {
    const configDir = opts.configDir || AgentConnector.defaultConfigDir();
    this.config = new Config(configDir);
    this.env = new EnvManager(configDir);
    this.registry = new Registry(configDir, opts.registryUrl);
    this.installer = new Installer(this.registry, configDir);
    this.workspace = new WorkspaceClient(opts.workspaceEndpoint);
    this._configDir = configDir;
  }

  static defaultConfigDir() {
    const os = require('os');
    const path = require('path');
    return path.join(os.homedir(), '.openagents');
  }

  // -- Registry --

  async getCatalog() {
    const catalog = await this.registry.getCatalog();
    // Always re-check installed status (don't trust cached value)
    return catalog.map((entry) => {
      const info = this.installer.getInstallInfo(entry.name);
      return { ...entry, installed: info.installed, managed: info.managed, location: info.location };
    });
  }

  /**
   * Clear catalog cache so next getCatalog re-checks installed status.
   */
  clearCatalogCache() {
    this.registry._catalog = null;
  }

  getEnvFields(agentType) {
    return this.registry.getEnvFields(agentType);
  }

  // -- Install / Uninstall --

  async install(agentType) {
    return this.installer.install(agentType);
  }

  async uninstall(agentType) {
    return this.installer.uninstall(agentType);
  }

  isInstalled(agentType) {
    return this.installer.isInstalled(agentType);
  }

  healthCheck(agentType) {
    return this.installer.healthCheck(agentType);
  }

  // -- Agent CRUD --

  listAgents() {
    const agents = this.config.getAgents();
    const networks = this.config.getNetworks();
    return agents.map((a) => {
      const agentEnv = this.env.load(a.type);
      const network = networks.find((n) => n.slug === a.network || n.id === a.network);
      return {
        name: a.name,
        type: a.type || 'openclaw',
        role: a.role || 'worker',
        network: a.network || null,
        networkName: network ? (network.name || network.slug) : null,
        path: a.path || null,
        env: { ...agentEnv, ...(a.env || {}) },
      };
    });
  }

  addAgent({ name, type, role, path }) {
    this.config.addAgent({ name, type: type || 'openclaw', role: role || 'worker', path });
    return { success: true };
  }

  removeAgent(name) {
    this.config.removeAgent(name);
    return { success: true };
  }

  // -- Env config --

  getAgentEnv(agentType) {
    return this.env.load(agentType);
  }

  saveAgentEnv(agentType, env) {
    this.env.save(agentType, env);
    // Configure native auth for agents that need it (e.g. OpenClaw auth-profiles.json)
    try {
      if (agentType === 'openclaw') {
        const OpenClawAdapter = require('./adapters/openclaw');
        const saved = this.env.load(agentType);
        OpenClawAdapter.configureNativeAuth(saved);
      }
    } catch {}
    return { success: true };
  }

  resolveAgentEnv(agentType, saved) {
    return this.env.resolve(agentType, saved, this.registry);
  }

  // -- Workspace --

  listWorkspaces() {
    return this.config.getNetworks().map((n) => ({
      id: n.id,
      slug: n.slug,
      name: n.name || n.slug,
      endpoint: n.endpoint || '',
      token: n.token || '',
    }));
  }

  connectWorkspace(agentName, networkSlug) {
    this.config.setAgentNetwork(agentName, networkSlug);
    return { success: true };
  }

  disconnectWorkspace(agentName) {
    this.config.setAgentNetwork(agentName, null);
    return { success: true };
  }

  // -- Daemon lifecycle --

  /**
   * Create a Daemon instance for this connector's config.
   */
  createDaemon() {
    return new Daemon(this.config, this.env, this.registry);
  }

  /**
   * Start daemon in background (daemonize).
   */
  startDaemon(foregroundArgs) {
    if (!foregroundArgs) {
      // Auto-detect the CLI entry point for foreground mode
      const binPath = require.resolve('../bin/agent-connector.js');
      foregroundArgs = [binPath, 'up', '--foreground'];
    }
    Daemon.daemonize(this._configDir, foregroundArgs);
  }

  /**
   * Stop running daemon.
   */
  stopDaemon() {
    return Daemon.stopDaemon(this._configDir);
  }

  /**
   * Get daemon PID if running, null otherwise.
   */
  getDaemonPid() {
    return Daemon.readDaemonPid(this._configDir);
  }

  /**
   * Get agent status from daemon status file.
   */
  getDaemonStatus() {
    return this.config.getStatus();
  }

  /**
   * Send a command to the running daemon via daemon.cmd file.
   */
  sendDaemonCommand(cmd) {
    this.config.writeCommand(cmd);
  }

  /**
   * Get daemon logs, optionally filtered by agent name.
   */
  getLogs(agentName, lines = 200) {
    return this.config.getLogs(agentName, lines);
  }

  // -- Workspace API --

  async createWorkspace(opts) {
    return this.workspace.createWorkspace(opts);
  }

  async joinWorkspace(agentName, token, opts) {
    return this.workspace.joinNetwork(agentName, token, opts);
  }

  async resolveToken(token) {
    return this.workspace.resolveToken(token);
  }

  // -- LLM test --

  async testLLM(env) {
    const { testLLMConnection } = require('./utils');
    return testLLMConnection(env);
  }
}

const adapters = require('./adapters');

const paths = require('./paths');
module.exports = { AgentConnector, Daemon, WorkspaceClient, adapters, paths };
