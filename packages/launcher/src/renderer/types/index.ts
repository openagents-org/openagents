export type AgentState = 'online' | 'running' | 'idle' | 'starting' | 'reconnecting' | 'stopped' | 'error'

export interface HealthCheck {
  ready: boolean
  installed?: boolean
  // Structured readiness/failure reason shared with the core + daemon
  // (health-status.js REASON). The Agents list keys off this — NOT the free-text
  // message — to decide "Not installed" vs "Login required". Values include
  // 'ready' | 'not_installed' | 'login_required' | 'version_incompatible'.
  reason?: string
  // CLI sign-in state for dual-auth agents (e.g. Claude): true (signed in) /
  // false (signed out) / null (unknown — never probed or undecidable).
  logged_in?: boolean | null
  binary?: string | null
  version?: string | null
  message?: string
  auth_mode?: string
  // Coarse auth classification from the core's readiness probe: 'ready' |
  // 'no_credentials' | 'unknown' | null. Distinct from `ready` so the UI can
  // tell "found a credential file but couldn't read it" (unknown) apart from
  // "no credentials at all" (no_credentials).
  auth_status?: string | null
  execution_mode?: string
}

/**
 * Progress of an in-app CLI sign-in (main/cli-login.ts). "browser" carries the
 * authorize URL, "code" means the CLI is blocked waiting for the code the
 * browser showed, and "terminal" means it couldn't be hosted in-app and a real
 * terminal window was opened instead.
 */
export interface CliLoginEvent {
  agentType: string
  phase:
    | "starting"
    | "browser"
    | "code"
    | "verifying"
    | "success"
    | "failed"
    | "cancelled"
    | "terminal"
  url?: string
  message?: string
}

export interface Agent {
  name: string
  type: string
  state: AgentState
  health: HealthCheck | null
  network?: string | null
  networkName?: string | null
  lastError?: string | null
  runtimeMismatch?: boolean
  restarts?: number
  env?: Record<string, string>
  path?: string
  // True when the agent type has an interactive CLI that can be opened in a
  // terminal. API-only types (e.g. kimi) are false — the "Chat" action hides.
  hasCli?: boolean
}

/** One model an agent can be pointed at (main: agents/model-catalog). */
export interface ModelChoice {
  id: string
  label?: string
  note?: string
  deprecated?: boolean
}

/** Where the model list came from — the UI says so rather than implying truth. */
export interface ModelListResult {
  models: ModelChoice[]
  source: "cli" | "api" | "builtin" | "none"
  error?: string
  /** Translatable reason for an empty list; `error` is the raw fallback. */
  code?: "need_key" | "need_login" | "no_list"
}

/**
 * Which auth path a model picker is attached to. The list follows the path: the
 * API-key form lists what that endpoint serves even when the same agent is
 * signed in through its CLI on this machine.
 */
export type ModelListPath = "key" | "login"

export interface EnvField {
  name: string
  description: string
  required?: boolean
  password?: boolean
  placeholder?: string
  default?: string
  /** Optional fixed choices. Fields without options remain free-form inputs. */
  options?: string[]
}

/**
 * A fully-resolved onboarding agent (mirror of the main-process type). Only
 * agents the loaded core can actually run are returned, and `authMode` is
 * resolved authoritatively so onboarding never mislabels auth requirements.
 */
export interface OnboardingAgent {
  name: string
  label: string
  description: string
  featured: boolean
  order: number
  installed: boolean
  authMode: "env" | "login" | "none"
  loginCommand: string | null
  envFields: EnvField[]
  docsUrl: string | null
  notReadyMessage: string | null
}

/** One workspace this device is registered with as a node. */
export interface NodeConnection {
  nodeId: string
  workspaceId: string
  workspaceSlug: string | null
  workspaceName: string | null
  endpoint: string | null
}

/**
 * This device's registrations ("connect a node"): paired with a code from the
 * workspace's Connect Agent → Nodes view, after which the workspace can install
 * and run agents here remotely.
 *
 * A device can be a node in several workspaces at once, so `workspaces` is the
 * real answer; the singular fields describe the most recent pairing.
 */
export interface NodeStatus {
  connected: boolean
  nodeId: string | null
  workspaceId: string | null
  workspaceSlug: string | null
  workspaceName: string | null
  endpoint: string | null
  hostname: string
  deviceType: string
  /** Every workspace this device is paired to, most recent first. */
  workspaces: NodeConnection[]
  /**
   * Workspaces that removed this device. The local entry and its agent
   * bindings go with the pairing, so these name workspaces that are no longer
   * in the list — kept so the launcher can say what happened to them.
   */
  revoked: RevokedPairing[]
}

export interface RevokedPairing {
  workspaceId: string
  workspaceSlug: string | null
  workspaceName: string | null
  /** Agents unbound with it; re-joining files them back under the workspace. */
  agents?: string[]
}

export interface CatalogEntry {
  name: string
  label?: string
  description?: string
  homepage?: string
  tags?: string[]
  featured?: boolean
  order?: number
  // Launcher-stamped (see CORE_AGENTS in agent-manager). Agents outside the
  // supported core set are surfaced as "coming soon": visible, not installable,
  // sorted to the bottom. `coreOrder` is the product-defined display order for
  // the core set (999 for coming-soon agents).
  comingSoon?: boolean
  coreOrder?: number
  builtin?: boolean
  installed: boolean
  managed?: boolean
  location?: string
  support?: {
    install?: boolean
    workspace?: boolean
    collaboration?: boolean
  }
  requires?: string[]
  install?: {
    binary?: string
    binary_aliases?: string[]
    npm?: string
    npm_package?: string
    requires?: (string | null)[]
    macos?: string
    linux?: string
    windows?: string
    api_only?: boolean
  }
  check_ready?: {
    login_command?: string
    not_ready_message?: string
    env_vars?: string[]
    saved_env_key?: string
    // Non-sensitive, human-readable labels for a READY auth_mode (e.g. Gemini
    // maps cli_login → "Google account sign-in detected"). When present, the
    // Configure dialog shows an auth-status banner distinguishing a CLI sign-in
    // from an API key. Never contains a token, email, or path.
    auth_detected_labels?: Record<string, string>
  }
  env_config?: EnvField[]
  screenshots?: string[]
  demo?: string
  demo_url?: string
  long_description?: string
  // Stage.md §2.2 "使用入门指南" — optional structured getting-started hints.
  // Renderer falls back to deriving from install.binary + check_ready when
  // these aren't set, so older registry entries still get a useful section.
  quick_start?: string
  example_commands?: Array<{ cmd: string; description?: string }>
  docs?: string
  github?: string
}

export interface InstalledAgentRecord {
  name: string
  version: string | null
  installedAt: string
  previousVersion?: string | null
  history?: Array<{ version: string; installedAt: string }>
}

export interface AgentUpdateInfo {
  name: string
  current: string | null
  latest: string | null
  changelog?: Array<{ version: string; date?: string }>
}

export type InstallPhase = 'idle' | 'preparing' | 'downloading' | 'installing' | 'verifying' | 'done' | 'error'

/**
 * One dependency an agent's installer needs but the machine does not have,
 * as reported by the core's install preflight. `action` names a fix the
 * launcher can perform itself (currently only 'install-xcode-clt').
 */
export interface PrereqRemedy {
  name: string
  action: string | null
  summary: string
  command: string
  alternative: string | null
  /**
   * Key for the localized wording of `summary`; `summary` itself is the
   * English fallback the core also writes to the CLI and the install log.
   */
  summaryKey?: string
  /**
   * Which tool `alternative` uses ("homebrew", "winget", "pipx"), so the row
   * can be labelled for the platform the user is actually on.
   */
  alternativeKind?: string | null
}

export interface InstallProgressEvent {
  agent: string
  verb: 'install' | 'update' | 'uninstall' | 'rollback'
  phase: InstallPhase
  detail?: string
  log?: string
  error?: string
  /** Set when the install was refused because a dependency is missing. */
  missing?: PrereqRemedy[]
  /** This run's log file under ~/.openagents/installs/. */
  logFile?: string
}

export interface Workspace {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token?: string
}

// ── Platform Connections ──

export type ConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'expired'
  | 'unauthorized'
  | 'rate_limited'
  | 'offline'
  | 'error'

export type ConnectionAuthKind = 'oauth' | 'token' | 'pat' | 'app' | 'webhook'

export type PlatformId =
  | 'github' | 'slack' | 'discord' | 'telegram'
  | 'notion' | 'linear' | 'openai' | 'anthropic' | 'google'

/** One agent whose MCP config the launcher can write. Mirrors main/mcp-config.ts. */
export interface McpTargetState {
  id: string
  label: string
  /** Absolute path to that agent's MCP config file. */
  file: string
  /** The agent appears to be installed. */
  detected: boolean
  /** This platform's server is already registered there. */
  configured: boolean
  /** Config file exists but couldn't be parsed — writes are refused. */
  error?: string
}

export interface McpApplyResult {
  ok: boolean
  written: string[]
  errors: string[]
}

export interface ConnectionRecord {
  id: string
  platform: PlatformId | string
  account?: string
  label?: string
  status: ConnectionStatus
  authKind?: ConnectionAuthKind
  scopes?: string[]
  credentialId?: string
  meta?: Record<string, unknown>
  lastSyncAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export type CredentialKind = 'api_key' | 'token' | 'oauth' | 'webhook_secret' | 'password'

export interface CredentialSummary {
  id: string
  provider: string
  kind: CredentialKind
  label: string
  secretMasked: string
  shared: boolean
  scopes?: string[]
  usedByAgents?: string[]
  usedByConnections?: string[]
  lastTestedAt?: string
  lastTestOk?: boolean
  lastTestError?: string
  createdAt: string
  updatedAt: string
}

export interface ConnectionTestResult {
  ok: boolean
  status: 'connected' | 'unauthorized' | 'rate_limited' | 'expired' | 'offline' | 'error'
  account?: string
  detail?: string
}

export interface RuntimeInfo {
  nodeVersion: string | null
  npmVersion: string | null
  coreVersion: string | null
  latestVersion: string | null
}

/** Host + process snapshot behind Settings → Runtime. Byte counts, not strings. */
export interface SystemInfo {
  platform: string
  osRelease: string
  arch: string
  cpuModel: string | null
  cpuCount: number
  totalMemory: number
  freeMemory: number
  /** null when the runtime has no statfs (older Node) or the call failed. */
  diskFree: number | null
  diskTotal: number | null
  /** The launcher's own footprint, summed over every Electron process. */
  appMemory: number
  appCpu: number
  uptime: number
  electronVersion: string
  chromeVersion: string
  appVersion: string
  locale: string
  packaged: boolean
}

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"

export interface UpdaterState {
  status: UpdaterStatus
  currentVersion: string
  latestVersion: string | null
  percent: number
  bytesPerSecond: number
  releaseNotes: string | null
  error: string | null
  supported: boolean
  downloadUrl: string
  /**
   * Version that was downloaded and handed to the installer but never actually
   * replaced the app (repeatedly). Set on the launch that detects the failure
   * so the UI can offer a manual download instead of another no-op restart.
   */
  installFailedVersion: string | null
}

// ── Chat ──

export interface Attachment {
  fileId?: string
  filename?: string
  contentType?: string
  size?: number
  url?: string
}

export interface ToolCall {
  id: string
  name: string
  category?: 'workspace' | 'files' | 'browser' | 'tunnel' | 'todos' | 'timers' | 'terminal' | 'other'
  status: 'pending' | 'success' | 'error'
  args?: unknown
  result?: unknown
  durationMs?: number
}

export interface ChatMessage {
  messageId: string
  sessionId: string
  senderType: 'human' | 'agent' | 'system'
  senderName: string
  content: string
  mentions?: string[]
  messageType?: string
  metadata?: Record<string, unknown>
  attachments?: Attachment[]
  createdAt?: string
  toolCalls?: ToolCall[]
}

export interface SendMessageInput {
  workspaceId: string
  channelName?: string
  agentId?: string
  content: string
  mentions?: string[]
  attachments?: Attachment[]
}

export interface SendMessageResult {
  success: boolean
  messageId: string
  error?: string
}

export interface ChatSessionMeta {
  id: string
  workspaceId: string
  workspaceSlug?: string
  workspaceName?: string
  channelName: string
  title: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  messageCount: number
  participants: string[]
  createdAt: string
}

export type ChatStreamEvent =
  | { type: 'message'; channel: string; workspaceId: string; message: ChatMessage }
  | { type: 'agent-status'; channel: string; workspaceId: string; agentName: string; status: 'thinking' | 'idle' | 'error'; detail?: string }
  | { type: 'error'; channel: string; workspaceId: string; error: string }

export interface WorkspaceParticipant {
  agentName: string
  role: string
  status: string
}

export interface FileListEntry {
  id: string
  filename: string
  content_type?: string
  size?: number
  created_at?: string
}

export interface PythonStatus {
  pythonPath: string | null
  pythonFound: boolean
  sdkInstalled: boolean
  sdkVersion: string
  launcherVersion: string
  runtime: string
}

declare global {
  interface Window {
    api: {
      /** `process.platform` — a value, not a call. See preload. */
      platform: string
      /** Fires on change and once on subscribe. Returns an unsubscribe fn. */
      onFullScreenChange(cb: (isFullScreen: boolean) => void): () => void
      pythonStatus(): Promise<PythonStatus>
      installSDK(): Promise<unknown>
      runtimeInfo(): Promise<RuntimeInfo>
      listAgents(): Promise<Agent[]>
      getSupportedAgentTypes(): Promise<string[]>
      getAgentCoreInfo(): Promise<unknown>
      addAgent(config: { name: string; type: string; path?: string }): Promise<unknown>
      removeAgent(name: string): Promise<unknown>
      updateAgent(name: string, config: unknown): Promise<unknown>
      setAgentWorkingDir(name: string, dir: string): Promise<{ success: boolean; path?: string }>
      startAgent(name: string): Promise<unknown>
      stopAgent(name: string): Promise<unknown>
      startAll(): Promise<unknown>
      stopAll(): Promise<unknown>
      agentStatus(): Promise<Record<string, { state: AgentState; last_error?: string; restarts?: number }>>
      agentLogs(name: string, lines: number): Promise<{ lines: string[] }>
      tailAgentLogs(name: string, lines: number, offset: number): Promise<{ lines: string[]; size?: number }>
      clearLogsInRange(start: string, end: string): Promise<{ removed: number; remaining: number }>
      installAgentType(type: string): Promise<unknown>
      installAgentTypeStreaming(type: string): Promise<unknown>
      onInstallOutput(callback: (data: string) => void): void
      removeInstallOutputListener(): void
      onInstallProgress(callback: (ev: InstallProgressEvent) => void): void
      removeInstallProgressListener(): void
      uninstallAgentType(type: string): Promise<unknown>
      uninstallAgentTypeStreaming(type: string): Promise<unknown>
      checkAgentType(type: string): Promise<{ installed: boolean; binary: string | null }>
      getCatalog(force?: boolean): Promise<CatalogEntry[]>
      getInstalledAgents(): Promise<InstalledAgentRecord[]>
      checkAgentUpdates(force?: boolean): Promise<AgentUpdateInfo[]>
      rollbackAgentType(type: string): Promise<{ success: boolean; version?: string | null; error?: string }>
      getAgentChangelog(type: string): Promise<{ versions: Array<{ version: string; date?: string }>; homepage?: string; latest?: string | null; error?: string }>
      getEnvFields(type: string): Promise<EnvField[]>
      getAgentEnv(type: string): Promise<Record<string, string>>
      saveAgentEnv(type: string, env: Record<string, string>): Promise<unknown>
      deleteAgentEnv(type: string): Promise<unknown>
      getAgentInstanceEnv(name: string): Promise<Record<string, string>>
      saveAgentInstanceEnv(name: string, env: Record<string, string>): Promise<unknown>
      testLLM(env: Record<string, string>): Promise<{ success: boolean; model?: string; response?: string; error?: string }>
      listModels(
        agentType: string,
        env: Record<string, string>,
        path?: ModelListPath,
      ): Promise<ModelListResult>
      signalReload(): Promise<unknown>
      connectWorkspace(agentName: string, slug: string): Promise<unknown>
      disconnectWorkspace(agentName: string): Promise<unknown>
      /**
       * Always unpairs this device from the workspace on the server and drops
       * the local record; `deleteRemote` also deletes the workspace itself,
       * for every member.
       */
      removeWorkspace(
        slug: string,
        opts?: { deleteRemote?: boolean },
      ): Promise<{
        success: boolean
        unpaired: boolean
        deleted: boolean
        warning: string | null
      }>
      listWorkspaces(): Promise<Workspace[]>
      /** Renames it on the server, for every member — not a local alias. */
      renameWorkspace(
        workspaceId: string,
        name: string,
      ): Promise<{ id: string; slug: string; name: string }>
      getOnboardingAgents(): Promise<OnboardingAgent[]>
      consumeOnboardingReset(): Promise<boolean>
      provisionFirstAgent(opts: {
        agentType: string
        agentName: string
        path?: string | null
      }): Promise<{ agentName: string; warning: string | null }>
      getNodeStatus(): Promise<NodeStatus>
      /** Same, but verified against the workspace first (throttled). */
      refreshNodeStatus(force?: boolean): Promise<NodeStatus>
      connectNode(
        code: string,
        opts?: { name?: string; deviceType?: string },
      ): Promise<NodeStatus & { warning: string | null }>
      /** Forget the notice that a workspace removed this device. */
      dismissNodeRevocation(workspaceId: string): Promise<NodeStatus | null>
      getSetting(key: string): Promise<unknown>
      setSetting(key: string, value: unknown): Promise<unknown>
      /** Themes the OS-drawn window frame to match the app's theme. */
      setThemeSource(mode: "light" | "dark" | "system"): Promise<unknown>
      /**
       * Dims the Windows/Linux window-controls overlay while a dialog scrims
       * the page. No-op on macOS, whose traffic lights AppKit tints itself.
       */
      setChromeDimmed(dim: boolean): Promise<unknown>
      getAllSettings(): Promise<Record<string, unknown>>
      exportSettings(): Promise<string>
      exportSettingsToFile(): Promise<{
        ok: boolean
        canceled?: boolean
        path?: string
        error?: string
      }>
      importSettings(json: string): Promise<{ ok: boolean; error?: string }>
      resetSettings(): Promise<boolean>
      /** Empties Chromium's HTTP/image cache. `freed` is bytes reclaimed. */
      clearAppCache(): Promise<{ ok: boolean; freed?: number; error?: string }>
      /** The running app's version, e.g. "0.9.9" — cheap, unlike systemInfo. */
      appVersion(): Promise<string>
      /**
       * Whether this profile ran the launcher before this launch, judged from
       * the settings file as it was at boot. Answers "upgrade or fresh
       * install?" for anything with no record of its own to go on.
       */
      hasRunBefore(): Promise<boolean>
      /** Quits and starts the app again — for launch-time settings like GPU. */
      relaunchApp(): Promise<boolean>
      /** Reachability probe for a workspace URL. `error` is a code, not prose. */
      testWorkspaceEndpoint(url: string): Promise<{
        ok: boolean
        status?: number
        error?: "invalid-url" | "timeout" | "unreachable"
      }>
      listPaths(): Promise<{
        userData: string
        logs: string
        downloads: string
        home: string
        cache: string
        portableNode: string
        openagentsHome: string
      }>
      systemInfo(): Promise<SystemInfo>
      showPath(path: string): Promise<boolean>
      selectDirectory(defaultPath?: string): Promise<string | null>
      healthCheck(type: string): Promise<HealthCheck>
      refreshLogin(type: string): Promise<HealthCheck>
      clearLoginKey(type: string, agentName?: string): Promise<{ success: boolean }>
      openExternal(url: string): Promise<void>
      installXcodeCommandLineTools(): Promise<{ ok: boolean; error?: string }>
      openTerminal(cmd: string): Promise<void>

      // ── In-app CLI sign-in ──
      /** Runs `<cli> login` inside the launcher; falls back to a terminal. */
      startCliLogin(
        type: string,
        opts?: { terminal?: boolean },
      ): Promise<{ mode: "in-app" | "terminal" }>
      submitCliLoginCode(type: string, code: string): Promise<void>
      cancelCliLogin(type: string): Promise<void>
      onCliLoginEvent(cb: (ev: CliLoginEvent) => void): () => void
      openAgentTerminal(agentName: string): Promise<void>
      updateCore(): Promise<{ success: boolean; version?: string; error?: string }>
      onCoreUpdate(cb: (info: { current: string; latest: string }) => void): void

      // ── Launcher self-update ──
      getUpdaterState(): Promise<UpdaterState>
      checkLauncherUpdate(): Promise<UpdaterState>
      downloadLauncherUpdate(): Promise<UpdaterState>
      installLauncherUpdate(): Promise<boolean>
      onUpdaterEvent(cb: (state: UpdaterState) => void): () => void
      onAgentUpdatesChanged(cb: (updates: AgentUpdateInfo[]) => void): void
      onNavigateToInstall(cb: (agentName: string) => void): void
      getIconPath(name: string): Promise<string | null>
      getIconsDir(): Promise<string | null>
      debugEnv(): Promise<Record<string, string>>

      // ── Chat ──
      chatSendMessage(input: SendMessageInput): Promise<SendMessageResult>
      chatGetMessages(workspaceId: string, channelName?: string, limit?: number): Promise<ChatMessage[]>
      /** Every channel in the workspace, not just the default one — used by
       *  the activity summaries, which must not miss per-session channels. */
      chatGetWorkspaceMessages(workspaceId: string, limit?: number): Promise<ChatMessage[]>
      chatStartPolling(workspaceId: string, channelName?: string): Promise<{ success: boolean; key?: string }>
      chatStopPolling(workspaceId: string, channelName?: string): Promise<{ success: boolean }>
      chatListParticipants(workspaceId: string): Promise<WorkspaceParticipant[]>
      onChatEvent(cb: (ev: ChatStreamEvent) => void): () => void

      // ── Files ──
      chatUploadFile(workspaceId: string, filename: string, contentBase64: string, opts?: { contentType?: string; channelName?: string }): Promise<{ success: boolean; fileId?: string; url?: string; filename?: string; error?: string }>
      chatListFiles(workspaceId: string, opts?: { limit?: number; offset?: number }): Promise<{ files?: FileListEntry[] } | unknown>
      chatReadFile(workspaceId: string, fileId: string): Promise<{ success: boolean; contentBase64?: string; error?: string }>
      chatDeleteFile(workspaceId: string, fileId: string): Promise<{ success: boolean; error?: string }>

      // ── Sessions ──
      sessionList(workspaceId?: string): Promise<ChatSessionMeta[]>
      sessionCreate(workspaceId: string): Promise<ChatSessionMeta>
      sessionLoad(workspaceId: string, channelName: string): Promise<ChatSessionMeta | null>
      sessionDelete(workspaceId: string, channelName: string): Promise<boolean>
      sessionClear(workspaceId?: string): Promise<number>

      // ── Connections ──
      listConnections(): Promise<ConnectionRecord[]>
      upsertConnection(record: Partial<ConnectionRecord> & { platform: string }): Promise<ConnectionRecord>
      removeConnection(id: string): Promise<boolean>
      setConnectionStatus(id: string, status: ConnectionStatus, lastError?: string): Promise<ConnectionRecord | null>
      testConnection(id: string): Promise<ConnectionTestResult>

      // ── Credentials ──
      listCredentials(): Promise<CredentialSummary[]>
      upsertCredential(input: {
        id?: string
        provider: string
        kind: CredentialKind
        label: string
        secret?: string
        shared?: boolean
        scopes?: string[]
        usedByAgents?: string[]
      }): Promise<{ ok: boolean; record?: CredentialSummary; error?: string }>
      removeCredential(id: string): Promise<boolean>
      revealCredential(id: string): Promise<{ ok: boolean; secret?: string; error?: string }>
      testCredential(input: { id?: string; provider: string; secret?: string }): Promise<ConnectionTestResult>
      applyCredentialToAgents(input: {
        credentialId: string
        envKey: string
        agentTypes: string[]
      }): Promise<{ ok: boolean; written?: string[]; errors?: string[]; error?: string }>

      // ── MCP registration ──
      mcpPlatforms(): Promise<string[]>
      mcpListTargets(platform: string): Promise<McpTargetState[]>
      mcpApply(input: {
        connectionId: string
        targetIds: string[]
      }): Promise<McpApplyResult>
      mcpRemove(input: {
        platform: string
        targetIds: string[]
      }): Promise<McpApplyResult>

      // ── Notifications (5.4) ──
      notificationsList(): Promise<NotifRecord[]>
      notificationsPush(input: NotifInput): Promise<NotifRecord>
      notificationsMarkRead(id: string): Promise<boolean>
      notificationsMarkAllRead(): Promise<boolean>
      notificationsClear(id?: string): Promise<boolean>
      notificationsGetPrefs(): Promise<NotifPrefs>
      notificationsSetPrefs(prefs: Partial<NotifPrefs>): Promise<NotifPrefs>
      onNotificationsUpdated(cb: (list: NotifRecord[]) => void): () => void
      onNotificationClicked(cb: (record: NotifRecord) => void): () => void

      // ── GitHub Integration (4.3) ──
      githubProbe(payload: {
        credentialId?: string
        secret?: string
      }): Promise<{
        ok: boolean
        login?: string
        name?: string | null
        avatarUrl?: string | null
        scopes?: string[]
        rate?: { limit: number; used: number; remaining: number; reset: number } | null
        error?: string
      }>
      githubParseRepo(input: string): Promise<{ owner: string; name: string } | null>
      githubListBindings(): Promise<GitHubBinding[]>
      githubBindRepo(payload: {
        agentName: string
        repo: string
        credentialId: string
      }): Promise<{ ok: boolean; binding?: GitHubBinding; error?: string }>
      githubUnbindRepo(agentName: string): Promise<boolean>
      githubListIssues(payload: {
        agentName: string
        state?: 'open' | 'closed' | 'all'
        perPage?: number
        page?: number
      }): Promise<{ ok: boolean; items?: GitHubIssue[]; error?: string }>
      githubListPullRequests(payload: {
        agentName: string
        state?: 'open' | 'closed' | 'all'
        perPage?: number
        page?: number
      }): Promise<{ ok: boolean; items?: GitHubPullRequest[]; error?: string }>
      githubComment(payload: {
        agentName: string
        issueNumber: number
        body: string
      }): Promise<{ ok: boolean; result?: unknown; error?: string }>
    }
  }
}

export type NotifKind =
  | 'agent_error'
  | 'agent_finished'
  | 'agent_mention'
  | 'agent_waiting_input'
  | 'workspace_mention'
  | 'workspace_message'
  | 'workspace_error'
  | 'platform_error'
  | 'github'
  | 'update_available'
  | 'system'

export type NotifPriority = 'low' | 'normal' | 'high' | 'critical'

export interface NotifInput {
  kind: NotifKind
  title: string
  body: string
  priority?: NotifPriority
  source?: string
  payload?: Record<string, unknown>
  silent?: boolean
}

export interface NotifRecord extends NotifInput {
  id: string
  createdAt: string
  read: boolean
}

export interface NotifPrefs {
  enabled: boolean
  soundEnabled: boolean
  mutedKinds: NotifKind[]
  mutedSources: string[]
  quietHours: [number, number] | null
}

export interface GitHubBinding {
  agentName: string
  owner: string
  repo: string
  credentialId: string
  createdAt: string
  updatedAt: string
}

export interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  html_url: string
  user: { login: string; avatar_url?: string }
  created_at: string
  updated_at: string
  comments: number
  labels: Array<{ name: string; color?: string }>
  body?: string | null
}

export interface GitHubPullRequest {
  number: number
  title: string
  state: 'open' | 'closed'
  draft?: boolean
  merged_at?: string | null
  html_url: string
  user: { login: string; avatar_url?: string }
  created_at: string
  updated_at: string
  head: { ref: string }
  base: { ref: string }
}
