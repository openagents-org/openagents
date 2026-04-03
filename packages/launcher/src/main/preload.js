const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Python / SDK
  pythonStatus: () => ipcRenderer.invoke('python:status'),
  installSDK: () => ipcRenderer.invoke('python:install'),
  runtimeInfo: () => ipcRenderer.invoke('runtime:info'),

  // Agents
  listAgents: () => ipcRenderer.invoke('agents:list'),
  addAgent: (config) => ipcRenderer.invoke('agents:add', config),
  removeAgent: (name) => ipcRenderer.invoke('agents:remove', name),
  updateAgent: (name, config) => ipcRenderer.invoke('agents:update', name, config),

  startAgent: (name) => ipcRenderer.invoke('agents:start', name),
  stopAgent: (name) => ipcRenderer.invoke('agents:stop', name),
  startAll: () => ipcRenderer.invoke('agents:start-all'),
  stopAll: () => ipcRenderer.invoke('agents:stop-all'),
  agentStatus: () => ipcRenderer.invoke('agents:status'),
  agentLogs: (name, lines) => ipcRenderer.invoke('agents:logs', name, lines),

  // Agent type install & catalog
  installAgentType: (type) => ipcRenderer.invoke('agents:install-type', type),
  installAgentTypeStreaming: (type) => ipcRenderer.invoke('agents:install-type-streaming', type),
  onInstallOutput: (callback) => ipcRenderer.on('install:output', (_e, data) => callback(data)),
  removeInstallOutputListener: () => ipcRenderer.removeAllListeners('install:output'),
  uninstallAgentType: (type) => ipcRenderer.invoke('agents:uninstall-type', type),
  uninstallAgentTypeStreaming: (type) => ipcRenderer.invoke('agents:uninstall-type-streaming', type),
  checkAgentType: (type) => ipcRenderer.invoke('agents:check-type', type),
  getCatalog: () => ipcRenderer.invoke('agents:catalog'),

  // Agent configuration
  getEnvFields: (type) => ipcRenderer.invoke('agents:env-fields', type),
  getAgentEnv: (type) => ipcRenderer.invoke('agents:get-env', type),
  saveAgentEnv: (type, env) => ipcRenderer.invoke('agents:save-env', type, env),
  testLLM: (env) => ipcRenderer.invoke('agents:test-llm', env),
  signalReload: () => ipcRenderer.invoke('agents:signal-reload'),

  // Workspace
  connectWorkspace: (agentName, slug) => ipcRenderer.invoke('workspace:connect', agentName, slug),
  disconnectWorkspace: (agentName) => ipcRenderer.invoke('workspace:disconnect', agentName),
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  createWorkspace: (name) => ipcRenderer.invoke('workspace:create', name),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // Health check
  healthCheck: (type) => ipcRenderer.invoke('agents:health-check', type),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  shellExec: (cmd) => ipcRenderer.invoke('shell:exec', cmd),
  openTerminal: (cmd) => ipcRenderer.invoke('shell:open-terminal', cmd),
  updateCore: () => ipcRenderer.invoke('core:update'),
  onCoreUpdate: (cb) => ipcRenderer.on('core-update-available', (_e, info) => cb(info)),

  // Icons
  getIconPath: (name) => ipcRenderer.invoke('icons:get-path', name),
  getIconsDir: () => ipcRenderer.invoke('icons:get-dir'),

  // Debug
  debugEnv: () => ipcRenderer.invoke('debug:env'),
});
