'use strict';

// Must run before anything captures a child_process reference: on Windows it
// keeps every spawn from popping a stray console window. See win-console.js.
require('./win-console').installWindowsHideDefault();

const { Config } = require('./config');
const { EnvManager } = require('./env');
const { Registry } = require('./registry');
const { Installer } = require('./installer');
const { Daemon } = require('./daemon');
const { WorkspaceClient } = require('./workspace-client');
const { GitHubClient } = require('./github-client');

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
      const type = a.type || 'openclaw';
      const typeEnv = this.env.load(type);
      const network = networks.find((n) => n.slug === a.network || n.id === a.network);
      return {
        name: a.name,
        // The label to show. `name` stays the identity — callers that key on
        // it (sessions, working dirs, workspace membership) must keep using
        // `name`, never this.
        displayName: a.display_name || null,
        type,
        role: a.role || 'worker',
        network: a.network || null,
        networkName: network ? (network.name || network.slug) : null,
        path: a.path || null,
        env: { ...typeEnv, ...(a.env || {}) },
        instanceEnv: { ...(a.env || {}) },
      };
    });
  }

  addAgent({ name, type, role, path, env }) {
    this.config.addAgent({ name, type: type || 'openclaw', role: role || 'worker', path, env });
    return { success: true };
  }

  /**
   * The workspace an agent is bound to, as a ready-to-use client — or null
   * when it is local-only or its network is no longer configured.
   *
   * Each network carries its own endpoint (a self-hosted workspace is not the
   * official one), so the client is built per call rather than reusing
   * `this.workspace`, the same way removeWorkspace does.
   */
  _workspaceClientFor(agentName) {
    const agent = this.config.getAgent(agentName);
    if (!agent || !agent.network) return null;
    const network = this.config
      .getNetworks()
      .find((n) => n.slug === agent.network || n.id === agent.network);
    if (!network || !network.id) return null;
    const endpoint = network.endpoint || (this.workspace && this.workspace.endpoint);
    const { WorkspaceClient } = require('./workspace-client');
    return { client: new WorkspaceClient(endpoint), network };
  }

  /**
   * Set (or clear, with an empty value) an agent's display label.
   *
   * The agent's `name` is its identity — it keys daemon.yaml, the working
   * directory under ~/.openagents/agents, its sessions and its workspace
   * membership — so renaming NEVER touches it. What changes is the label the
   * launcher and the workspace show, which is precisely what the workspace
   * already models as `display_name` next to `agent_name`.
   *
   * When the agent is in a workspace the new label is pushed there too, so the
   * two sides agree. A workspace that rejects it (a name another member
   * already answers to) fails the whole call rather than leaving the label
   * changed on one side only.
   */
  async setAgentDisplayName(name, displayName) {
    const agent = this.config.getAgent(name);
    if (!agent) throw new Error(`Agent '${name}' not found`);
    const label = (displayName || '').trim();

    const bound = this._workspaceClientFor(name);
    if (bound) {
      await bound.client.setMemberDisplayName(
        bound.network.id,
        bound.network.token || '',
        name,
        label,
      );
    }
    // Local write comes second: if the workspace refused the label, nothing
    // here has changed and the two sides are still in agreement.
    this.config.updateAgent(name, { display_name: label || undefined });
    return { success: true, displayName: label || null };
  }

  /**
   * Drop an agent's member row from the workspace it joined.
   *
   * Deliberately SEPARATE from removeAgent rather than a flag on it. Removing
   * an agent is a synchronous local edit that `agn remove` and the TUI call
   * without awaiting, inside a try/catch — making it async would turn a thrown
   * error into an unhandled rejection those callers can no longer see. So the
   * network half lives here, and a caller that wants both awaits this first:
   * failing to reach the workspace then leaves the agent intact locally, which
   * is the recoverable order.
   *
   * A local-only agent is a no-op success — there is nothing over there.
   */
  async removeAgentFromWorkspace(name) {
    const bound = this._workspaceClientFor(name);
    if (!bound) return { success: true, skipped: true };
    try {
      await bound.client.removeMember(
        bound.network.id,
        bound.network.token || '',
        name,
      );
    } catch (e) {
      // 404 is the goal state, reached by someone else: the member row is
      // already gone, or the whole workspace is. Treating it as a failure
      // would strand the agent on this device — removal happens local-last, so
      // an error here means it cannot be removed at all. Anything else (a
      // network blip, an auth failure) is real and must stop the removal so
      // the user can retry rather than lose track of a live membership.
      if (!e || e.status !== 404) throw e;
      return { success: true, alreadyGone: true };
    }
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

  getAgentInstanceEnv(agentName) {
    const agent = this.config.getAgent(agentName);
    if (!agent) throw new Error(`Agent '${agentName}' not found`);
    return { ...(agent.env || {}) };
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
      // Hermes reads a custom endpoint only from its own config.yaml, so the
      // saved LLM_* values must be pushed through `hermes config set` — the
      // env file alone leaves it "No inference provider configured".
      if (agentType === 'hermes') {
        const HermesAdapter = require('./adapters/hermes');
        const saved = this.env.load(agentType);
        HermesAdapter.configureNativeAuth(saved);
      }
    } catch {}
    return { success: true };
  }

  /**
   * Delete the entire type-level env file (~/.openagents/env/<type>.env).
   * Used by the launcher's "wipe saved credentials" path on uninstall so
   * sensitive values (API keys) don't survive a reinstall as surprise
   * pre-filled defaults in the setup wizard.
   */
  deleteAgentEnv(agentType) {
    this.env.delete(agentType);
    return { success: true };
  }

  saveAgentInstanceEnv(agentName, env) {
    const agent = this.config.getAgent(agentName);
    if (!agent) throw new Error(`Agent '${agentName}' not found`);
    const saved = this.config.updateAgentEnv(agentName, env);

    // Preserve native auth side effects for agents that need them while
    // keeping the model choice scoped to this individual agent.
    try {
      if ((agent.type || 'openclaw') === 'openclaw') {
        const OpenClawAdapter = require('./adapters/openclaw');
        const typeEnv = this.env.load(agent.type || 'openclaw');
        OpenClawAdapter.configureNativeAuth({ ...typeEnv, ...saved });
      }
      if (agent.type === 'hermes') {
        const HermesAdapter = require('./adapters/hermes');
        const typeEnv = this.env.load('hermes');
        HermesAdapter.configureNativeAuth({ ...typeEnv, ...saved });
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

  async removeWorkspace(slug) {
    const networks = this.config.getNetworks();
    const network = networks.find(n => n.slug === slug || n.id === slug);
    if (network && network.id) {
      // Use the network's specific endpoint (e.g., localhost vs official)
      const endpoint = network.endpoint || (this.workspace && this.workspace.endpoint);
      const { WorkspaceClient } = require('./workspace-client');
      const tempClient = new WorkspaceClient(endpoint);
      // Try to remove from backend first
      await tempClient.deleteWorkspace(network.id, network.token || '');
    }
    // Remove from local config (which also disconnects any agents)
    this.config.removeNetwork(slug);
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

  tailLogs(opts = {}) {
    return this.config.tailLogs(opts);
  }

  clearLogsInRange(opts = {}) {
    return this.config.clearLogsInRange(opts);
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

  async redeemNodePairingCode(code, deviceInfo) {
    return this.workspace.redeemPairingCode(code, deviceInfo);
  }

  // -- LLM test --

  async testLLM(env) {
    const { testLLMConnection } = require('./utils');
    return testLLMConnection(env);
  }

  /**
   * Smoke-test an agent type end to end (tiny "hi" prompt through its CLI or
   * LLM API) and classify any failure into actionable guidance. See probe.js.
   */
  async probeAgentType(agentType, opts) {
    const { probeAgentType } = require('./probe');
    return probeAgentType(this, agentType, opts);
  }
}

const adapters = require('./adapters');

const paths = require('./paths');
module.exports = { AgentConnector, Daemon, WorkspaceClient, GitHubClient, adapters, paths };
