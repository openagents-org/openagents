import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  pythonStatus: () => ipcRenderer.invoke('python:status'),
  installSDK: () => ipcRenderer.invoke('python:install'),
  runtimeInfo: () => ipcRenderer.invoke('runtime:info'),

  listAgents: () => ipcRenderer.invoke('agents:list'),
  getSupportedAgentTypes: () => ipcRenderer.invoke('agents:supported-types'),
  getAgentCoreInfo: () => ipcRenderer.invoke('agents:core-info'),
  addAgent: (config: unknown) => ipcRenderer.invoke('agents:add', config),
  removeAgent: (name: string) => ipcRenderer.invoke('agents:remove', name),
  updateAgent: (name: string, config: unknown) => ipcRenderer.invoke('agents:update', name, config),

  startAgent: (name: string) => ipcRenderer.invoke('agents:start', name),
  stopAgent: (name: string) => ipcRenderer.invoke('agents:stop', name),
  startAll: () => ipcRenderer.invoke('agents:start-all'),
  stopAll: () => ipcRenderer.invoke('agents:stop-all'),
  agentStatus: () => ipcRenderer.invoke('agents:status'),
  agentLogs: (name: string, lines: number) => ipcRenderer.invoke('agents:logs', name, lines),
  tailAgentLogs: (name: string, lines: number, offset: number) => ipcRenderer.invoke('agents:tail-logs', name, lines, offset),
  clearLogsInRange: (start: string, end: string) => ipcRenderer.invoke('agents:clear-logs-range', start, end),

  installAgentType: (type: string) => ipcRenderer.invoke('agents:install-type', type),
  installAgentTypeStreaming: (type: string) => ipcRenderer.invoke('agents:install-type-streaming', type),
  onInstallOutput: (callback: (data: string) => void) => ipcRenderer.on('install:output', (_e, data) => callback(data)),
  removeInstallOutputListener: () => ipcRenderer.removeAllListeners('install:output'),
  onInstallProgress: (callback: (ev: unknown) => void) => ipcRenderer.on('install:progress', (_e, ev) => callback(ev)),
  removeInstallProgressListener: () => ipcRenderer.removeAllListeners('install:progress'),
  uninstallAgentType: (type: string) => ipcRenderer.invoke('agents:uninstall-type', type),
  uninstallAgentTypeStreaming: (type: string) => ipcRenderer.invoke('agents:uninstall-type-streaming', type),
  checkAgentType: (type: string) => ipcRenderer.invoke('agents:check-type', type),
  getCatalog: () => ipcRenderer.invoke('agents:catalog'),
  getInstalledAgents: () => ipcRenderer.invoke('agents:installed-list'),
  checkAgentUpdates: () => ipcRenderer.invoke('agents:check-updates'),
  rollbackAgentType: (type: string) => ipcRenderer.invoke('agents:rollback', type),
  installAgentTypeAtVersionStreaming: (type: string, target: string) =>
    ipcRenderer.invoke('agents:install-at-version-streaming', type, target),
  getAgentChangelog: (type: string) => ipcRenderer.invoke('agents:changelog', type),

  getEnvFields: (type: string) => ipcRenderer.invoke('agents:env-fields', type),
  getAgentEnv: (type: string) => ipcRenderer.invoke('agents:get-env', type),
  saveAgentEnv: (type: string, env: unknown) => ipcRenderer.invoke('agents:save-env', type, env),
  deleteAgentEnv: (type: string) => ipcRenderer.invoke('agents:delete-env', type),
  getAgentInstanceEnv: (name: string) => ipcRenderer.invoke('agents:get-instance-env', name),
  saveAgentInstanceEnv: (name: string, env: unknown) => ipcRenderer.invoke('agents:save-instance-env', name, env),
  testLLM: (env: unknown) => ipcRenderer.invoke('agents:test-llm', env),
  signalReload: () => ipcRenderer.invoke('agents:signal-reload'),

  connectWorkspace: (agentName: string, slug: string) => ipcRenderer.invoke('workspace:connect', agentName, slug),
  disconnectWorkspace: (agentName: string) => ipcRenderer.invoke('workspace:disconnect', agentName),
  removeWorkspace: (slug: string) => ipcRenderer.invoke('workspace:remove', slug),
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  createWorkspace: (name: string) => ipcRenderer.invoke('workspace:create', name),
  registerWorkspaceFromToken: (input: { url?: string; token?: string; slug?: string }) =>
    ipcRenderer.invoke('workspace:register-from-token', input),

  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: (json: string) => ipcRenderer.invoke('settings:import', json),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  listPaths: () => ipcRenderer.invoke('paths:list'),
  showPath: (p: string) => ipcRenderer.invoke('paths:show', p),

  healthCheck: (type: string) => ipcRenderer.invoke('agents:health-check', type),

  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  shellExec: (cmd: string) => ipcRenderer.invoke('shell:exec', cmd),
  openTerminal: (cmd: string) => ipcRenderer.invoke('shell:open-terminal', cmd),
  updateCore: () => ipcRenderer.invoke('core:update'),
  onCoreUpdate: (cb: (info: { current: string; latest: string }) => void) =>
    ipcRenderer.on('core-update-available', (_e, info) => cb(info)),
  onAgentUpdatesChanged: (cb: (updates: Array<{ name: string; current: string | null; latest: string | null }>) => void) =>
    ipcRenderer.on('agent-updates-changed', (_e, updates) => cb(updates)),
  onNavigateToInstall: (cb: (agentName: string) => void) =>
    ipcRenderer.on('navigate-to-install', (_e, name) => cb(name)),

  getIconPath: (name: string) => ipcRenderer.invoke('icons:get-path', name),
  getIconsDir: () => ipcRenderer.invoke('icons:get-dir'),

  debugEnv: () => ipcRenderer.invoke('debug:env'),

  // ── Chat ──
  chatSendMessage: (input: unknown) => ipcRenderer.invoke('workspace:send-message', input),
  chatGetMessages: (workspaceId: string, channelName?: string, limit?: number) =>
    ipcRenderer.invoke('workspace:get-messages', workspaceId, channelName, limit),
  chatStartPolling: (workspaceId: string, channelName?: string) =>
    ipcRenderer.invoke('workspace:start-polling', workspaceId, channelName),
  chatStopPolling: (workspaceId: string, channelName?: string) =>
    ipcRenderer.invoke('workspace:stop-polling', workspaceId, channelName),
  chatListParticipants: (workspaceId: string) =>
    ipcRenderer.invoke('workspace:list-participants', workspaceId),
  onChatEvent: (cb: (event: unknown) => void) => {
    const handler = (_e: unknown, ev: unknown): void => cb(ev)
    ipcRenderer.on('chat:event', handler)
    return () => ipcRenderer.removeListener('chat:event', handler)
  },

  // ── Files ──
  chatUploadFile: (workspaceId: string, filename: string, contentBase64: string, opts?: unknown) =>
    ipcRenderer.invoke('workspace:upload-file', workspaceId, filename, contentBase64, opts),
  chatListFiles: (workspaceId: string, opts?: unknown) =>
    ipcRenderer.invoke('workspace:list-files', workspaceId, opts),
  chatReadFile: (workspaceId: string, fileId: string) =>
    ipcRenderer.invoke('workspace:read-file', workspaceId, fileId),
  chatDeleteFile: (workspaceId: string, fileId: string) =>
    ipcRenderer.invoke('workspace:delete-file', workspaceId, fileId),

  // ── Sessions ──
  sessionList: (workspaceId?: string) => ipcRenderer.invoke('session:list', workspaceId),
  sessionLoad: (workspaceId: string, channelName: string) =>
    ipcRenderer.invoke('session:load', workspaceId, channelName),
  sessionDelete: (workspaceId: string, channelName: string) =>
    ipcRenderer.invoke('session:delete', workspaceId, channelName),
  sessionClear: (workspaceId?: string) => ipcRenderer.invoke('session:clear', workspaceId),

  // ── Connections ──
  listConnections: () => ipcRenderer.invoke('connections:list'),
  upsertConnection: (record: unknown) => ipcRenderer.invoke('connections:upsert', record),
  removeConnection: (id: string) => ipcRenderer.invoke('connections:remove', id),
  setConnectionStatus: (id: string, status: string, lastError?: string) =>
    ipcRenderer.invoke('connections:set-status', id, status, lastError),
  testConnection: (id: string) => ipcRenderer.invoke('connections:test', id),

  // ── Notifications (5.4) ──
  notificationsList: () => ipcRenderer.invoke('notifications:list'),
  notificationsPush: (input: unknown) => ipcRenderer.invoke('notifications:push', input),
  notificationsMarkRead: (id: string) => ipcRenderer.invoke('notifications:mark-read', id),
  notificationsMarkAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
  notificationsClear: (id?: string) => ipcRenderer.invoke('notifications:clear', id),
  notificationsGetPrefs: () => ipcRenderer.invoke('notifications:get-prefs'),
  notificationsSetPrefs: (prefs: unknown) => ipcRenderer.invoke('notifications:set-prefs', prefs),
  onNotificationsUpdated: (cb: (list: unknown[]) => void) => {
    const handler = (_e: unknown, list: unknown[]): void => cb(list)
    ipcRenderer.on('notifications:updated', handler)
    return () => ipcRenderer.removeListener('notifications:updated', handler)
  },
  onNotificationClicked: (cb: (record: unknown) => void) => {
    const handler = (_e: unknown, record: unknown): void => cb(record)
    ipcRenderer.on('notifications:clicked', handler)
    return () => ipcRenderer.removeListener('notifications:clicked', handler)
  },

  // ── GitHub Integration (4.3) ──
  githubProbe: (payload: { credentialId?: string; secret?: string }) =>
    ipcRenderer.invoke('github:probe', payload),
  githubParseRepo: (input: string) => ipcRenderer.invoke('github:parse-repo', input),
  githubListBindings: () => ipcRenderer.invoke('github:list-bindings'),
  githubBindRepo: (payload: { agentName: string; repo: string; credentialId: string }) =>
    ipcRenderer.invoke('github:bind-repo', payload),
  githubUnbindRepo: (agentName: string) => ipcRenderer.invoke('github:unbind-repo', agentName),
  githubListIssues: (payload: {
    agentName: string
    state?: 'open' | 'closed' | 'all'
    perPage?: number
    page?: number
  }) => ipcRenderer.invoke('github:list-issues', payload),
  githubListPullRequests: (payload: {
    agentName: string
    state?: 'open' | 'closed' | 'all'
    perPage?: number
    page?: number
  }) => ipcRenderer.invoke('github:list-pull-requests', payload),
  githubComment: (payload: { agentName: string; issueNumber: number; body: string }) =>
    ipcRenderer.invoke('github:comment', payload),

  // ── Credentials ──
  listCredentials: () => ipcRenderer.invoke('credentials:list'),
  upsertCredential: (input: unknown) => ipcRenderer.invoke('credentials:upsert', input),
  removeCredential: (id: string) => ipcRenderer.invoke('credentials:remove', id),
  revealCredential: (id: string) => ipcRenderer.invoke('credentials:reveal', id),
  testCredential: (input: { id?: string; provider: string; secret?: string }) =>
    ipcRenderer.invoke('credentials:test', input),
  applyCredentialToAgents: (input: { credentialId: string; envKey: string; agentTypes: string[] }) =>
    ipcRenderer.invoke('credentials:apply-to-agents', input),
})
