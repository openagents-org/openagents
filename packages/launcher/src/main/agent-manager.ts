import path from "path"
import fs from "fs"
import os from "os"
import https from "https"
import { spawnSync } from "child_process"
import { withPathEnv } from "./env"
import { EventEmitter } from "events"

const CONFIG_DIR = path.join(os.homedir(), ".openagents")
const GLOBAL_CORE = path.join(
  CONFIG_DIR,
  "nodejs",
  "node_modules",
  "@openagents-org",
  "agent-launcher",
)
const LOCAL_CORE = path.resolve(__dirname, "../../../agent-connector")
const INSTALLED_HISTORY_FILE = path.join(
  CONFIG_DIR,
  "installed_agents_history.json",
)
const DAEMON_PID_FILE = path.join(CONFIG_DIR, "daemon.pid")
const DAEMON_STATUS_FILE = path.join(CONFIG_DIR, "daemon.status.json")
const DAEMON_CMD_FILE = path.join(CONFIG_DIR, "daemon.cmd")
const DAEMON_LOG_FILE = path.join(CONFIG_DIR, "daemon.log")

const LAUNCHER_SESSIONS_DIR = path.join(CONFIG_DIR, "launcher-sessions")
const DEFAULT_CHAT_CHANNEL = "main"
const CHAT_POLL_INTERVAL_MS = 2500

interface LauncherSettingsStore {
  get(key?: string): unknown
}

function normalizeWorkspaceEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const raw = value.trim()
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (url.hostname === "workspace.openagents.org") {
      return url.origin.replace("workspace.openagents.org", "workspace-endpoint.openagents.org")
    }
    return url.origin
  } catch {
    return undefined
  }
}

export interface InstalledAgentRecord {
  name: string
  version: string | null
  installedAt: string
  previousVersion?: string | null
  history?: Array<{ version: string; installedAt: string }>
}

// ── Chat types (Stage 3.1) ──

export interface ChatToolCall {
  id: string
  name: string
  category?:
    | "workspace"
    | "files"
    | "browser"
    | "tunnel"
    | "todos"
    | "timers"
    | "terminal"
    | "other"
  status: "pending" | "success" | "error"
  args?: unknown
  result?: unknown
  durationMs?: number
}

export interface ChatAttachment {
  fileId?: string
  filename?: string
  contentType?: string
  size?: number
  url?: string
}

export interface ChatMessage {
  messageId: string
  sessionId: string
  senderType: "human" | "agent" | "system"
  senderName: string
  content: string
  mentions?: string[]
  messageType?: string
  metadata?: Record<string, unknown>
  attachments?: ChatAttachment[]
  createdAt?: string
  toolCalls?: ChatToolCall[]
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

export interface SendMessageInput {
  workspaceId: string
  channelName?: string
  agentId?: string
  content: string
  mentions?: string[]
  attachments?: ChatAttachment[]
}

export interface SendMessageResult {
  success: boolean
  messageId: string
  error?: string
}

export type ChatStreamEvent =
  | {
      type: "message"
      channel: string
      workspaceId: string
      message: ChatMessage
    }
  | {
      type: "agent-status"
      channel: string
      workspaceId: string
      agentName: string
      status: "thinking" | "idle" | "error"
      detail?: string
    }
  | { type: "error"; channel: string; workspaceId: string; error: string }

interface WorkspaceConfig {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token: string
}

interface ChatPollingState {
  workspaceId: string
  channelName: string
  token: string
  cursor: string | null
  seenIds: Set<string>
  timer: NodeJS.Timeout | null
  refs: number
  inFlight: boolean
  workspace: WorkspaceConfig
}

function ensureDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

function sessionFilePath(workspaceId: string, channelName: string): string {
  return path.join(LAUNCHER_SESSIONS_DIR, workspaceId, `${channelName}.json`)
}

function classifyTool(name: string): ChatToolCall["category"] {
  const n = (name || "").toLowerCase()
  if (n.includes("browser")) return "browser"
  if (n.includes("file")) return "files"
  if (n.includes("tunnel")) return "tunnel"
  if (n.includes("todo")) return "todos"
  if (n.includes("timer")) return "timers"
  if (
    n.includes("shell") ||
    n.includes("exec") ||
    n.includes("terminal") ||
    n.includes("bash")
  )
    return "terminal"
  if (n.includes("workspace")) return "workspace"
  return "other"
}

// The agent adapters (see agent-connector/src/adapters/utils.js
// formatAttachmentsForPrompt) read attachments in camelCase — they look up
// att.fileId, att.contentType. The workspace API stores attachments verbatim
// and replays them through _eventToMessage. So we MUST send camelCase end to
// end. Snake_case here would land in the agent prompt as an empty file_id,
// which is the literal bug the user reported.
function attachmentsToServer(
  attachments?: ChatAttachment[],
): unknown[] | undefined {
  if (!attachments || attachments.length === 0) return undefined
  return attachments.map((a) => {
    const out: Record<string, unknown> = {}
    if (a.fileId) out.fileId = a.fileId
    if (a.filename) out.filename = a.filename
    if (a.contentType) out.contentType = a.contentType
    if (typeof a.size === "number") out.size = a.size
    if (a.url) out.url = a.url
    return out
  })
}

// Defensive: tolerate either casing on the way in (older messages, future
// schema changes) and normalize to camelCase for the renderer.
function attachmentsFromServer(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((entry) => {
    const e = (entry || {}) as Record<string, unknown>
    return {
      fileId:
        (e.fileId as string) ||
        (e.file_id as string) ||
        (e.id as string) ||
        undefined,
      filename: (e.filename as string) || (e.name as string) || undefined,
      contentType:
        (e.contentType as string) || (e.content_type as string) || undefined,
      size: typeof e.size === "number" ? e.size : undefined,
      url: (e.url as string) || undefined,
    }
  })
}

function normalizeIncomingMessage(m: ChatMessage): ChatMessage {
  return {
    ...m,
    attachments: m.attachments
      ? attachmentsFromServer(m.attachments)
      : undefined,
    toolCalls: extractToolCalls(m),
  }
}

function extractToolCalls(msg: ChatMessage): ChatToolCall[] | undefined {
  const meta = (msg.metadata || {}) as Record<string, unknown>
  const raw =
    (meta.tool_calls as unknown[] | undefined) ||
    (meta.toolCalls as unknown[] | undefined) ||
    undefined
  if (!Array.isArray(raw) || raw.length === 0) return undefined

  return raw.map((entry, i) => {
    const e = (entry || {}) as Record<string, unknown>
    const name = (e.name as string) || (e.tool as string) || `tool_${i}`
    const status =
      (e.status as ChatToolCall["status"]) ||
      (e.error ? "error" : e.result !== undefined ? "success" : "pending")
    return {
      id: (e.id as string) || `${msg.messageId}:${i}`,
      name,
      category: classifyTool(name),
      status,
      args: e.args ?? e.arguments,
      result: e.result ?? e.error,
      durationMs:
        typeof e.duration_ms === "number"
          ? e.duration_ms
          : typeof e.durationMs === "number"
            ? e.durationMs
            : undefined,
    }
  })
}

export function extractMentions(text: string): string[] {
  const out: string[] = []
  const re = /(^|\s)@([a-zA-Z0-9_-]+)/g
  let match = re.exec(text)
  while (match !== null) {
    if (!out.includes(match[2])) out.push(match[2])
    match = re.exec(text)
  }
  return out
}

interface NpmRegistryInfo {
  "dist-tags"?: { latest?: string }
  versions?: Record<string, unknown>
  time?: Record<string, string>
  homepage?: string
}

function loadCore(): Record<string, unknown> | null {
  if (fs.existsSync(path.join(LOCAL_CORE, "package.json"))) {
    try {
      return require(LOCAL_CORE)
    } catch (e) {
      console.error("Failed to load local core:", e)
    }
  }
  if (fs.existsSync(path.join(GLOBAL_CORE, "package.json"))) {
    try {
      return require(GLOBAL_CORE)
    } catch {}
  }
  try {
    return require("@openagents-org/agent-launcher")
  } catch {}
  return null
}

function appendDaemonLog(message: string): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.appendFileSync(
      DAEMON_LOG_FILE,
      `[${new Date().toISOString()}] launcher: ${message}\n`,
      "utf-8",
    )
  } catch {}
}

function isPidAlive(pid: number | null): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Smoke-test a node binary by running `--version`. Returns false if the
 * binary is missing, blocked by Defender/SmartScreen, has an arch mismatch,
 * or any other CreateProcess failure. Used to avoid spawning the daemon with
 * a bundled node.exe that Windows refuses to load — which would otherwise
 * leave the daemon perpetually offline.
 */
function canExecuteNode(binaryPath: string): boolean {
  try {
    const r = spawnSync(binaryPath, ["--version"], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return r.status === 0 && !r.error
  } catch {
    return false
  }
}

/**
 * Resolve a working node binary, preferring the bundled portable runtime
 * when it actually launches, otherwise falling back to a system `node` on
 * PATH. Returns null if nothing works.
 */
function resolveWorkingNode(
  portableNodeDir: string,
  enhancedPath: string,
): string | null {
  const candidates = [
    path.join(
      portableNodeDir,
      "node" + (process.platform === "win32" ? ".exe" : ""),
    ),
    path.join(portableNodeDir, "bin", "node"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c) && canExecuteNode(c)) return c
  }
  // Bundled node missing or won't run — try the system one.
  try {
    const which = process.platform === "win32" ? "where" : "which"
    const out = require("child_process").execFileSync(which, ["node"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
      env: withPathEnv(enhancedPath),
    }) as string
    for (const line of out
      .split(/\r?\n/)
      .map((s: string) => s.trim())
      .filter(Boolean)) {
      if (canExecuteNode(line)) return line
    }
  } catch {}
  return null
}

let core: Record<string, unknown> | null = loadCore()

export class AgentManager extends EventEmitter {
  private _store: LauncherSettingsStore
  private _healthByType = new Map<string, unknown>()
  private _healthRefreshInFlight = new Set<string>()
  private _lastHealthRefreshAt = 0
  private _healthQueue: string[] = []
  private _healthProcessing = false
  private _agentsCache: { value: unknown[]; at: number } = { value: [], at: 0 }
  private _catalogCache: {
    value: unknown[] | null
    at: number
    inFlight: Promise<unknown[]> | null
  } = {
    value: null,
    at: 0,
    inFlight: null,
  }
  private _updatesCache: {
    value: Array<{
      name: string
      current: string | null
      latest: string | null
    }>
    at: number
    inFlight: Promise<
      Array<{ name: string; current: string | null; latest: string | null }>
    > | null
  } = {
    value: [],
    at: 0,
    inFlight: null,
  }
  private _statusCache: { value: unknown; at: number } = { value: {}, at: 0 }
  private _chatPolls = new Map<string, ChatPollingState>()
  _connector: Record<string, unknown> | null = null

  constructor(store: LauncherSettingsStore) {
    super()
    this._store = store
    if (!core) core = loadCore()
    if (core) {
      this._connector = this.createConnector()
    }
    ensureDir(LAUNCHER_SESSIONS_DIR)
  }

  private createConnector(): Record<string, unknown> {
    const AgentConnector = (core as Record<string, unknown>)
      .AgentConnector as new (opts: unknown) => Record<string, unknown>
    const workspaceEndpoint = normalizeWorkspaceEndpoint(
      this._store.get("workspaceEndpoint"),
    )
    return new AgentConnector({
      configDir: CONFIG_DIR,
      ...(workspaceEndpoint ? { workspaceEndpoint } : {}),
    })
  }

  private configuredWorkspaceEndpoint(): string | undefined {
    return normalizeWorkspaceEndpoint(this._store.get("workspaceEndpoint"))
  }

  getSupportedAgentTypes(): string[] {
    const supported = (core as Record<string, unknown> | null)?.adapters
      ? Object.keys(
          (
            (core as Record<string, unknown>).adapters as Record<
              string,
              unknown
            >
          ).ADAPTER_MAP as Record<string, unknown>,
        )
      : []
    return (supported as string[]).sort()
  }

  getCoreInfo(): unknown {
    return {
      version: this.coreVersion,
      supportedTypes: this.getSupportedAgentTypes(),
      globalCorePath: GLOBAL_CORE,
      globalCorePresent: fs.existsSync(path.join(GLOBAL_CORE, "package.json")),
    }
  }

  reloadCore(): boolean {
    const cacheKeys = Object.keys(require.cache).filter(
      (k) => k.includes("agent-launcher") || k.includes("agent-connector"),
    )
    for (const k of cacheKeys) delete require.cache[k]
    core = loadCore()
    if (core) {
      this._connector = this.createConnector()
    }
    this.clearCatalogCache()
    this._agentsCache = { value: [], at: 0 }
    this._healthByType.clear()
    return !!core
  }

  get coreVersion(): string | null {
    try {
      const pkg = path.join(LOCAL_CORE, "package.json")
      if (fs.existsSync(pkg))
        return JSON.parse(fs.readFileSync(pkg, "utf-8")).version
    } catch {}
    try {
      const pkg = path.join(GLOBAL_CORE, "package.json")
      if (fs.existsSync(pkg))
        return JSON.parse(fs.readFileSync(pkg, "utf-8")).version
    } catch {}
    try {
      return require("@openagents-org/agent-launcher/package.json").version
    } catch {}
    return null
  }

  private _ensureConnector(): void {
    if (!this._connector) {
      if (!this.reloadCore()) {
        throw new Error(
          "Core library not installed. Install an agent first via the Install tab.",
        )
      }
    }
  }

  getAgents(): unknown[] {
    const now = Date.now()
    if (
      this._agentsCache.value.length > 0 &&
      now - this._agentsCache.at < 1500
    ) {
      return this._agentsCache.value
    }
    if (!this._connector) return []
    const listAgents = this._connector.listAgents as () => unknown[]
    const agents = listAgents.call(this._connector)
    const status = this.getAllStatus() as Record<
      string,
      { state?: string; restarts?: number; last_error?: string }
    >
    this._scheduleHealthRefresh(
      agents as Array<{ type?: string; name: string }>,
    )

    const supportedTypes = new Set(this.getSupportedAgentTypes())
    const value = (agents as Array<Record<string, unknown>>).map((a) => {
      const type = (a.type as string) || "openclaw"
      const runtimeMismatch = !supportedTypes.has(type)
      const runtimeMessage = runtimeMismatch
        ? `Agent runtime '${type}' is not available in the currently loaded core. Update Launcher and restart it.`
        : null
      const statusEntry = status[a.name as string]
      const statusError = statusEntry?.last_error || null
      return {
        ...a,
        state: statusEntry?.state || "stopped",
        restarts: statusEntry?.restarts || 0,
        lastError: statusError || runtimeMessage,
        health: this._healthByType.get(type) || null,
        runtimeMismatch,
      }
    })
    this._agentsCache = { value, at: now }
    return value
  }

  private _scheduleHealthRefresh(
    agents: Array<{ type?: string; name: string }>,
  ): void {
    const now = Date.now()
    if (now - this._lastHealthRefreshAt < 30_000) return
    this._lastHealthRefreshAt = now

    const types = [...new Set((agents || []).map((a) => a.type || "openclaw"))]
    for (const type of types) {
      if (this._healthRefreshInFlight.has(type)) continue
      if (this._healthQueue.includes(type)) continue
      this._healthRefreshInFlight.add(type)
      this._healthQueue.push(type)
    }
    this._processHealthQueue()
  }

  private _processHealthQueue(): void {
    if (this._healthProcessing) return
    this._healthProcessing = true
    const tick = (): void => {
      const type = this._healthQueue.shift()
      if (!type) {
        this._healthProcessing = false
        return
      }
      setTimeout(() => {
        try {
          const healthCheck = this._connector?.healthCheck as
            | ((type: string) => unknown)
            | undefined
          const health = healthCheck
            ? healthCheck.call(this._connector, type)
            : null
          this._healthByType.set(type, health)
        } catch {
          this._healthByType.set(type, null)
        } finally {
          this._healthRefreshInFlight.delete(type)
        }
        setTimeout(tick, 250)
      }, 0)
    }
    tick()
  }

  async addAgent(agentConfig: {
    name: string
    type?: string
    path?: string
    env?: Record<string, string>
  }): Promise<unknown> {
    const name = agentConfig.name
    const type = agentConfig.type || "openclaw"
    const supportedTypes = this.getSupportedAgentTypes()

    if (supportedTypes.length > 0 && !supportedTypes.includes(type)) {
      throw new Error(
        `Agent type '${type}' is not supported. Supported: ${supportedTypes.join(", ")}`,
      )
    }

    const addAgent = this._connector!.addAgent as (opts: unknown) => void
    addAgent.call(this._connector, {
      name,
      type,
      role: "worker",
      path: agentConfig.path,
      env: agentConfig.env,
    })
    // Bust the 1.5s agents cache so the renderer's immediate post-mutation
    // refresh() returns fresh data instead of the stale pre-add list.
    this._agentsCache = { value: [], at: 0 }
    return { success: true, agent: agentConfig }
  }

  async removeAgent(name: string): Promise<unknown> {
    try {
      await this.stopAgent(name)
    } catch {}
    const removeAgent = this._connector!.removeAgent as (name: string) => void
    removeAgent.call(this._connector, name)
    // See addAgent: bust the cache so the deleted agent doesn't linger.
    this._agentsCache = { value: [], at: 0 }
    return { success: true }
  }

  async updateAgent(
    name: string,
    updates: { env?: Record<string, string> },
  ): Promise<unknown> {
    if (updates.env) {
      const saveEnv = this._connector!.saveAgentInstanceEnv as (
        name: string,
        env: unknown,
      ) => void
      saveEnv.call(this._connector, name, updates.env)
    }
    this._agentsCache = { value: [], at: 0 }
    return { success: true }
  }

  clearCatalogCache(): void {
    this._catalogCache = { value: null, at: 0, inFlight: null }
    this._updatesCache = { value: [], at: 0, inFlight: null }
    try {
      const clearCache = this._connector?.clearCatalogCache as
        | (() => void)
        | undefined
      clearCache?.call(this._connector)
    } catch {}
  }

  async getCatalog(force = false): Promise<unknown[]> {
    const now = Date.now()
    const ttl = process.platform === "win32" ? 60_000 : 10_000
    if (
      !force &&
      this._catalogCache.value &&
      now - this._catalogCache.at < ttl
    ) {
      return this._catalogCache.value
    }
    if (!force && this._catalogCache.inFlight)
      return this._catalogCache.inFlight

    const load = this._loadCatalog()
      .then((catalog) => {
        this._catalogCache = { value: catalog, at: Date.now(), inFlight: null }
        return catalog
      })
      .catch((err) => {
        this._catalogCache.inFlight = null
        throw err
      })
    this._catalogCache.inFlight = load
    return load
  }

  private async _loadCatalog(): Promise<unknown[]> {
    let catalog: unknown[]
    try {
      const getCatalog = this._connector!.getCatalog as () => Promise<unknown[]>
      catalog = await getCatalog.call(this._connector)
    } catch {
      const registry = this._connector!.registry as Record<string, unknown>
      const getCatalogSync = registry.getCatalogSync as () => unknown[]
      catalog = getCatalogSync.call(registry).map((e) => {
        const entry = e as Record<string, unknown>
        const installer = this._connector!.installer as Record<string, unknown>
        const getInstallInfo = installer.getInstallInfo as (name: string) => {
          installed: boolean
          managed?: boolean
          location?: string
        }
        const info = getInstallInfo.call(installer, entry.name as string)
        return {
          ...entry,
          installed: info.installed,
          managed: info.managed,
          location: info.location,
        }
      })
    }
    const registry = this._connector!.registry as Record<string, unknown>
    const loadBundled = registry._loadBundled as () => unknown[]
    const bundled = loadBundled.call(registry)
    for (const entry of catalog) {
      const e = entry as Record<string, unknown>
      const b = (bundled as Array<Record<string, unknown>>).find(
        (x) => x.name === e.name,
      )
      if (b) {
        if (!e.check_ready && b.check_ready) e.check_ready = b.check_ready
        if (
          (!e.env_config || !(e.env_config as unknown[]).length) &&
          (b.env_config as unknown[] | undefined)?.length
        )
          e.env_config = b.env_config
        if (b.install) e.install = { ...b.install }
        if (!e.launch && b.launch) e.launch = b.launch
      }
    }
    return catalog
  }

  async getEnvFields(agentType: string): Promise<unknown[]> {
    this._ensureConnector()
    const getEnvFields = this._connector!.getEnvFields as (
      type: string,
    ) => unknown[]
    return getEnvFields.call(this._connector, agentType)
  }

  getAgentEnv(agentType: string): unknown {
    const getAgentEnv = this._connector!.getAgentEnv as (
      type: string,
    ) => unknown
    return getAgentEnv.call(this._connector, agentType)
  }

  getAgentInstanceEnv(agentName: string): unknown {
    const getInstanceEnv = this._connector!.getAgentInstanceEnv as (
      name: string,
    ) => unknown
    return getInstanceEnv.call(this._connector, agentName)
  }

  deleteAgentEnv(agentType: string): unknown {
    const deleteEnv = this._connector!.deleteAgentEnv as (
      type: string,
    ) => unknown
    return deleteEnv.call(this._connector, agentType)
  }

  saveAgentEnv(agentType: string, env: Record<string, string>): unknown {
    const saveEnv = this._connector!.saveAgentEnv as (
      type: string,
      env: unknown,
    ) => void
    saveEnv.call(this._connector, agentType, env)

    try {
      if (agentType === "openclaw") {
        const OpenClawAdapter = require("@openagents-org/agent-launcher/src/adapters/openclaw")
        OpenClawAdapter.configureNativeAuth(env)
      }
    } catch {}

    this.signalReload()
    return { success: true }
  }

  saveAgentInstanceEnv(
    agentName: string,
    env: Record<string, string>,
  ): unknown {
    const saveEnv = this._connector!.saveAgentInstanceEnv as (
      name: string,
      env: unknown,
    ) => void
    saveEnv.call(this._connector, agentName, env)
    this.signalReload()
    return { success: true }
  }

  async testLLM(env: Record<string, string>): Promise<unknown> {
    const testLLM = this._connector!.testLLM as (
      env: unknown,
    ) => Promise<unknown>
    return testLLM.call(this._connector, env)
  }

  signalReload(): void {
    const getDaemonPid = this._connector!.getDaemonPid as () => number | null
    const pid = getDaemonPid.call(this._connector)
    if (!pid) return

    if (process.platform === "win32") {
      const sendCmd = this._connector!.sendDaemonCommand as (
        cmd: string,
      ) => void
      sendCmd.call(this._connector, "reload")
    } else {
      try {
        process.kill(pid, "SIGHUP")
      } catch {}
    }
  }

  getNetworks(): unknown[] {
    const listWorkspaces = this._connector!.listWorkspaces as () => unknown[]
    return listWorkspaces.call(this._connector)
  }

  async createWorkspace(name: string): Promise<unknown> {
    const createWorkspace = this._connector!.createWorkspace as (
      opts: unknown,
    ) => Promise<unknown>
    return createWorkspace.call(this._connector, {
      name: name || "My Workspace",
    })
  }

  private parseCustomWorkspaceUrl(
    urlStr: string,
  ): { endpoint?: string; slug?: string; token?: string } | null {
    try {
      const u = new URL(urlStr.trim())
      if (u.protocol !== "http:" && u.protocol !== "https:") return null
      const host = u.hostname.toLowerCase()
      if (host === "workspace.openagents.org") {
        return null
      }
      const endpoint = u.origin
      const slug = u.pathname.replace(/^\//, "").split("/")[0] || undefined
      const token = u.searchParams.get("token") || undefined
      return { endpoint, slug, token }
    } catch {
      return null
    }
  }

  async registerWorkspaceFromToken(input: {
    url?: string
    token?: string
    slug?: string
  }): Promise<{
    id?: string
    slug?: string
    name?: string
    endpoint?: string
    token?: string
  }> {
    const tokenOrSlug = (input.token || input.slug || input.url || "").trim()
    if (!tokenOrSlug) throw new Error("Missing workspace URL or token")

    const customParsed = input.url ? this.parseCustomWorkspaceUrl(input.url) : null
    if (customParsed) {
      const slug = input.slug || customParsed.slug
      const token = input.token || customParsed.token
      if (!slug)
        throw new Error(
          "Custom workspace URL must include slug (first path segment) or provide slug explicitly",
        )
      if (!token)
        throw new Error(
          "Custom workspace URL must include token query parameter or provide token explicitly",
        )

      const config = this._connector!.config as Record<string, unknown>
      const addNetwork = config.addNetwork as (opts: unknown) => unknown
      addNetwork.call(config, {
        id: slug,
        slug,
        name: slug,
        endpoint: customParsed.endpoint,
        token,
      })
      this.signalReload()
      return {
        id: slug,
        slug,
        name: slug,
        endpoint: customParsed.endpoint,
        token,
      }
    }

    const resolveToken = this._connector!.resolveToken as (
      token: string,
    ) => Promise<{
      slug?: string
      workspace_id?: string
      name?: string
      endpoint?: string
    }>
    const info = await resolveToken.call(this._connector, tokenOrSlug)
    const slug = info.slug || info.workspace_id || input.slug
    if (!slug) throw new Error("Could not resolve workspace from input")
    const endpoint = info.endpoint || this.configuredWorkspaceEndpoint()

    const config = this._connector!.config as Record<string, unknown>
    const addNetwork = config.addNetwork as (opts: unknown) => unknown
    addNetwork.call(config, {
      id: info.workspace_id,
      slug,
      name: info.name || slug,
      endpoint,
      token: input.token || tokenOrSlug,
    })
    this.signalReload()
    return {
      id: info.workspace_id,
      slug,
      name: info.name || slug,
      endpoint,
      token: input.token || tokenOrSlug,
    }
  }

  async connectWorkspace(
    agentName: string,
    tokenOrSlug: string,
  ): Promise<unknown> {
    try {
      const resolveToken = this._connector!.resolveToken as (
        token: string,
      ) => Promise<{
        slug?: string
        workspace_id?: string
        name?: string
        endpoint?: string
      }>
      const info = await resolveToken.call(this._connector, tokenOrSlug)
      const slug = info.slug || info.workspace_id
      const wsName = info.name || slug
      const endpoint = info.endpoint || this.configuredWorkspaceEndpoint()

      const addNetwork = (this._connector!.config as Record<string, unknown>)
        .addNetwork as (opts: unknown) => void
      addNetwork.call(this._connector!.config as Record<string, unknown>, {
        id: info.workspace_id,
        slug,
        name: wsName,
        endpoint,
        token: tokenOrSlug,
      })

      const connectWorkspace = this._connector!.connectWorkspace as (
        name: string,
        slug: string,
      ) => void
      connectWorkspace.call(this._connector, agentName, slug as string)
    } catch (err) {
      const networks = this.getNetworks() as Array<{ id?: string; slug?: string }>
      const existing = networks.some(
        (network) => network.slug === tokenOrSlug || network.id === tokenOrSlug,
      )
      if (!existing) throw err

      const connectWorkspace = this._connector!.connectWorkspace as (
        name: string,
        slug: string,
      ) => void
      connectWorkspace.call(this._connector, agentName, tokenOrSlug)
    }
    this.signalReload()
    return { success: true }
  }

  async disconnectWorkspace(agentName: string): Promise<unknown> {
    const disconnectWorkspace = this._connector!.disconnectWorkspace as (
      name: string,
    ) => void
    disconnectWorkspace.call(this._connector, agentName)
    this.signalReload()
    return { success: true }
  }

  async removeWorkspace(slug: string): Promise<unknown> {
    const removeWorkspace = this._connector!.removeWorkspace as (
      slug: string,
    ) => Promise<unknown>
    const result = await removeWorkspace.call(this._connector, slug)
    this.signalReload()
    return result
  }

  async checkAgentType(agentType: string): Promise<unknown> {
    const isInstalled = this._connector!.isInstalled as (
      type: string,
    ) => boolean
    const installed = isInstalled.call(this._connector, agentType)
    const installer = this._connector!.installer as Record<string, unknown>
    const which = installer.which as (type: string) => string | null
    const binary = installed ? which.call(installer, agentType) : null
    return { installed, binary: binary || null }
  }

  async installAgentType(agentType: string): Promise<unknown> {
    const install = this._connector!.install as (
      type: string,
    ) => Promise<unknown>
    const result = await install.call(this._connector, agentType)
    this._recordInstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async installAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    const installer = this._connector!.installer as Record<string, unknown>
    const installStreaming = installer.installStreaming as (
      type: string,
      onData: (data: string) => void,
    ) => Promise<unknown>
    const result = await installStreaming.call(installer, agentType, onData)
    this._recordInstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async uninstallAgentType(agentType: string): Promise<unknown> {
    const uninstall = this._connector!.uninstall as (
      type: string,
    ) => Promise<unknown>
    const result = await uninstall.call(this._connector, agentType)
    this._recordUninstall(agentType)
    this.clearCatalogCache()
    return result
  }

  async uninstallAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    const installer = this._connector!.installer as Record<string, unknown>
    const uninstallStreaming = installer.uninstallStreaming as (
      type: string,
      onData: (data: string) => void,
    ) => Promise<unknown>
    const result = await uninstallStreaming.call(installer, agentType, onData)
    this._recordUninstall(agentType)
    this.clearCatalogCache()
    return result
  }

  /** Read installed package version by inspecting runtime prefix package.json. */
  getInstalledVersion(agentType: string): string | null {
    try {
      const entry = this._getRegistryEntry(agentType)
      const npmPkg = this._resolveNpmPackage(entry)
      if (!npmPkg) return null
      const candidates = [
        path.join(
          CONFIG_DIR,
          "runtimes",
          agentType,
          "node_modules",
          npmPkg,
          "package.json",
        ),
        path.join(CONFIG_DIR, "nodejs", "node_modules", npmPkg, "package.json"),
      ]
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) {
            const pkg = JSON.parse(fs.readFileSync(c, "utf-8"))
            if (pkg?.version) return pkg.version
          }
        } catch {}
      }
    } catch {}
    return null
  }

  private _getRegistryEntry(agentType: string): Record<string, unknown> | null {
    try {
      const registry = this._connector?.registry as
        | Record<string, unknown>
        | undefined
      if (!registry) return null
      const getEntry = registry.getEntry as ((t: string) => unknown) | undefined
      const entry = getEntry
        ? (getEntry.call(registry, agentType) as Record<string, unknown> | null)
        : null
      return entry || null
    } catch {
      return null
    }
  }

  private _resolveNpmPackage(
    entry: Record<string, unknown> | null,
  ): string | null {
    if (!entry) return null
    const install = entry.install as Record<string, unknown> | undefined
    if (!install) return null
    if (install.npm_package) return install.npm_package as string
    const cmd = (install[Installer.platformKey()] || install.command || install.npm) as
      | string
      | undefined
    if (!cmd) return install.binary as string | null
    const m = cmd.match(
      /npm install\s+(?:-g\s+)?(@?[\w-]+(?:\/[\w-]+)?)(?:@\S*)?$/,
    )
    if (m) return m[1]
    return (install.binary as string | undefined) || null
  }

  getInstalledHistory(): Record<string, InstalledAgentRecord> {
    try {
      if (fs.existsSync(INSTALLED_HISTORY_FILE)) {
        const data = JSON.parse(
          fs.readFileSync(INSTALLED_HISTORY_FILE, "utf-8"),
        )
        if (data && typeof data === "object") return data
      }
    } catch {}
    return {}
  }

  private _writeInstalledHistory(
    data: Record<string, InstalledAgentRecord>,
  ): void {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.writeFileSync(
        INSTALLED_HISTORY_FILE,
        JSON.stringify(data, null, 2),
        "utf-8",
      )
    } catch {}
  }

  private _recordInstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      const version = this.getInstalledVersion(agentType)
      const prev = data[agentType]
      const history = prev?.history ? [...prev.history] : []
      const versionChanged = !!(
        prev?.version &&
        version &&
        prev.version !== version
      )
      if (versionChanged) {
        history.unshift({
          version: prev.version!,
          installedAt: prev.installedAt,
        })
      }
      // Only carry a previousVersion when the install actually changed the
      // version. A reinstall / repair that lands on the same version must NOT
      // record `previousVersion = currentVersion` — that self-referential
      // pointer lights up `canRollback` and points `rollbackAgentType` at the
      // same version we're already on. End result before this fix: a
      // permanent "Roll back" button that no-op reinstalls the current
      // version forever.
      const nextPreviousVersion = versionChanged
        ? prev!.version
        : prev?.previousVersion && prev.previousVersion !== version
          ? prev.previousVersion
          : null
      data[agentType] = {
        name: agentType,
        version,
        installedAt: new Date().toISOString(),
        previousVersion: nextPreviousVersion,
        history: history.slice(0, 10),
      }
      this._writeInstalledHistory(data)
    } catch {}
  }

  private _recordUninstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      if (data[agentType]) {
        delete data[agentType]
        this._writeInstalledHistory(data)
      }
    } catch {}
  }

  listInstalledAgents(): InstalledAgentRecord[] {
    const data = this.getInstalledHistory()
    const out: InstalledAgentRecord[] = []
    for (const name of Object.keys(data)) {
      const r = data[name]
      const version = r.version || this.getInstalledVersion(name)
      // Auto-heal self-referential previousVersion / history entries written
      // by the pre-fix _recordInstall code. Without this scrub, machines
      // upgraded from the buggy version keep seeing the Roll back button
      // even though the only "previous" pointer points at themselves.
      const cleanHistory = (r.history || []).filter(
        (h) => h.version && h.version !== version,
      )
      const cleanPrev =
        r.previousVersion && r.previousVersion !== version
          ? r.previousVersion
          : null
      out.push({
        ...r,
        version,
        history: cleanHistory,
        previousVersion: cleanPrev,
      })
    }
    return out
  }

  /**
   * Install an npm-backed agent at an arbitrary version specifier (semver
   * version, dist-tag, or anything `npm install pkg@<spec>` accepts).
   * Powers both rollback (previous version) and update-channel installs
   * (stage.md §2.5 — Beta / Nightly).
   */
  async _installAtVersionTag(
    agentType: string,
    target: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    const entry = this._getRegistryEntry(agentType)
    const npmPkg = this._resolveNpmPackage(entry)
    if (!npmPkg)
      return {
        success: false,
        version: null,
        error: "Cannot determine npm package",
      }

    const { spawn } = require("child_process") as typeof import("child_process")
    const prefixDir = path.join(CONFIG_DIR, "runtimes", agentType)
    fs.mkdirSync(prefixDir, { recursive: true })
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
    const args = [
      "install",
      "--save",
      "--prefix",
      prefixDir,
      `${npmPkg}@${target}`,
    ]

    if (onData) onData(`$ ${npmCmd} ${args.join(" ")}\n\n`)

    return new Promise((resolve) => {
      const proc = spawn(npmCmd, args, {
        shell: true,
        cwd: prefixDir,
        stdio: ["ignore", "pipe", "pipe"],
      })
      proc.stdout?.setEncoding("utf-8")
      proc.stderr?.setEncoding("utf-8")
      proc.stdout?.on("data", (d) => onData && onData(d))
      proc.stderr?.on("data", (d) => onData && onData(d))
      proc.on("error", (err) =>
        resolve({ success: false, version: null, error: err.message }),
      )
      proc.on("close", (code) => {
        if (code === 0) {
          this._recordInstall(agentType)
          this.clearCatalogCache()
          // Read what actually landed — for dist-tags the resolved version
          // can differ from the input string ("beta" → "2.1.144-beta.3").
          const resolved = this.getInstalledVersion(agentType) || target
          if (onData) onData(`\nInstalled ${npmPkg}@${resolved}.\n`)
          resolve({ success: true, version: resolved })
        } else {
          resolve({
            success: false,
            version: null,
            error: `Install failed with code ${code}`,
          })
        }
      })
    })
  }

  /**
   * Wrapper that exposes the version-tag installer to the install IPC.
   * Used by the AgentDetail update channel selector (stable / beta / nightly).
   */
  async installAgentTypeAtVersionStreaming(
    agentType: string,
    target: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    return this._installAtVersionTag(agentType, target, onData)
  }

  async rollbackAgentType(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    const data = this.getInstalledHistory()
    const record = data[agentType]
    const current = record?.version || this.getInstalledVersion(agentType)
    // Resolve the first history / previousVersion entry that is *different*
    // from the version currently on disk. Without this filter a stale
    // previousVersion pointer (pre-fix history records carrying
    // previousVersion === currentVersion) makes rollback re-install the
    // same version and the UI keep offering Roll back forever.
    const candidates = [
      ...(record?.history || []).map((h) => h.version),
      record?.previousVersion || null,
    ].filter((v): v is string => !!v && v !== current)
    const target = candidates[0]
    if (!target)
      return {
        success: false,
        version: null,
        error: "No previous version to roll back to",
      }

    // Delegate to the shared install-at-version pipeline so rollback and
    // channel switching share the same npm spawn + history recording path.
    return this._installAtVersionTag(agentType, target, onData)
  }

  async checkAgentUpdates(
    options: { force?: boolean } = {},
  ): Promise<
    Array<{ name: string; current: string | null; latest: string | null }>
  > {
    const now = Date.now()
    const ttl = 60 * 60 * 1000
    // Cache hit ONLY when the renderer didn't ask for a forced refresh,
    // the cache holds something useful, and the entry is still inside the
    // TTL. The previous implementation had this inverted: `!options.force`
    // returned the cache unconditionally, even after `clearCatalogCache()`
    // had reset it to `[]` — so the detail page silently lost the
    // "Update to v…" button immediately after a rollback / install /
    // uninstall, until the hourly background refresh re-populated the
    // cache.
    const cacheFresh =
      this._updatesCache.value.length > 0 && now - this._updatesCache.at < ttl
    if (!options.force && cacheFresh) {
      return this._updatesCache.value
    }

    if (this._updatesCache.inFlight) return this._updatesCache.inFlight
    this._updatesCache.inFlight = this._loadAgentUpdates()
      .then((updates) => {
        this._updatesCache = { value: updates, at: Date.now(), inFlight: null }
        return updates
      })
      .catch((err) => {
        this._updatesCache.inFlight = null
        throw err
      })
    return this._updatesCache.inFlight
  }

  private async _loadAgentUpdates(): Promise<
    Array<{ name: string; current: string | null; latest: string | null }>
  > {
    // Use the full catalog (every entry with installed=true), not just the
    // history file — agents installed globally / pre-launcher won't be in
    // the history but are still installed and worth checking for updates.
    const catalog = (await this.getCatalog()) as Array<Record<string, unknown>>
    const installedEntries = catalog.filter((e) => e.installed === true)
    const historyByName = new Map(
      this.listInstalledAgents().map((r) => [r.name, r.version]),
    )

    const results = await Promise.all(
      installedEntries.map(async (entry) => {
        const name = entry.name as string
        const npmPkg = this._resolveNpmPackage(entry)
        const current =
          historyByName.get(name) || this.getInstalledVersion(name)
        if (!npmPkg) return { name, current, latest: null }
        const info = await fetchNpmInfo(npmPkg).catch(() => null)
        return { name, current, latest: resolveLatestVersion(info) }
      }),
    )
    return results
  }

  async getAgentChangelog(
    agentType: string,
  ): Promise<{
    versions: Array<{ version: string; date?: string }>
    homepage?: string
    latest?: string | null
    error?: string
  }> {
    const entry = this._getRegistryEntry(agentType)
    const homepage = (entry?.homepage as string | undefined) || undefined
    const npmPkg = this._resolveNpmPackage(entry)
    if (!npmPkg)
      return { versions: [], homepage, latest: null, error: "No npm package" }
    try {
      const info = await fetchNpmInfo(npmPkg)
      const time = info.time || {}
      // Show pre-releases in the changelog list (useful for visibility), but
      // return `latest` as the stable dist-tag so the detail page's
      // "Update to vX" computation matches what `npm install` actually fetches.
      const versions = sortedPublishedVersions(info, {
        includePreRelease: true,
      })
        .slice(0, 12)
        .map((v) => ({ version: v, date: time[v] }))
      return { versions, homepage, latest: resolveLatestVersion(info) }
    } catch (e: unknown) {
      return {
        versions: [],
        homepage,
        latest: null,
        error: (e as Error).message,
      }
    }
  }

  async startAgent(name: string): Promise<unknown> {
    const ready = await this._ensureDaemon()
    if (!ready)
      throw new Error(
        "Daemon failed to start. Check the Logs page for details.",
      )
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, `start:${name}`)
    // Bust the 1s status cache so the next poll from the renderer sees the
    // daemon's freshly written 'starting' state instead of stale 'stopped'.
    this._statusCache = { value: {}, at: 0 }
    return { success: true, message: `Start command sent for ${name}` }
  }

  async stopAgent(name: string): Promise<unknown> {
    const pid = this._getLiveDaemonPid()
    if (!pid) return { success: true, message: "Daemon not running" }
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, `stop:${name}`)
    this._statusCache = { value: {}, at: 0 }
    return { success: true, message: `Stop command sent for ${name}` }
  }

  async startAll(): Promise<unknown> {
    const ready = await this._ensureDaemon()
    if (!ready)
      throw new Error(
        "Daemon failed to start. Check the Logs page for details.",
      )
    const sendCmd = this._connector!.sendDaemonCommand as (cmd: string) => void
    sendCmd.call(this._connector, "reload")
    return { success: true, message: "Start all command sent" }
  }

  async stopAll(): Promise<unknown> {
    const stopDaemon = this._connector!.stopDaemon as () => boolean
    const stopped = stopDaemon.call(this._connector)
    return {
      success: stopped,
      message: stopped ? "Daemon stopped" : "Daemon not running",
    }
  }

  async _ensureDaemon(): Promise<boolean> {
    const pid = this._getLiveDaemonPid()
    if (pid) return true

    const result = await this._startDaemon()
    if (!result.success) appendDaemonLog(result.message)
    return !!(result.success && result.pid)
  }

  getAllStatus(): unknown {
    const now = Date.now()
    if (this._statusCache.value && now - this._statusCache.at < 1000) {
      return this._statusCache.value
    }
    let value: unknown = {}
    if (this._getLiveDaemonPid()) {
      const getDaemonStatus = this._connector!.getDaemonStatus as () => unknown
      try {
        value = getDaemonStatus.call(this._connector)
      } catch {
        value = {}
      }
    }
    this._statusCache = { value, at: now }
    return value
  }

  getLogs(name: string, lines = 200): unknown {
    const getLogs = this._connector!.getLogs as (
      name: string,
      lines: number,
    ) => string[]
    const logLines = getLogs.call(this._connector, name, lines)
    return { lines: logLines }
  }

  tailLogs(name: string, lines = 200, offset = 0): unknown {
    const config = this._connector!.config as Record<string, unknown>
    const tailLogs = config.tailLogs as (opts: unknown) => unknown
    return tailLogs.call(config, { agent: name || undefined, lines, offset })
  }

  clearLogsInRange(
    start: string | number | Date,
    end: string | number | Date,
  ): unknown {
    const startTime = normalizeTimeValue(start)
    const endTime = normalizeTimeValue(end)

    if (!startTime || !endTime) {
      throw new Error("Start time and end time are required")
    }
    if (startTime.getTime() > endTime.getTime()) {
      throw new Error("Start time must be before end time")
    }

    const logFile = path.join(CONFIG_DIR, "daemon.log")
    if (!fs.existsSync(logFile)) return { removed: 0, remaining: 0 }

    const content = fs.readFileSync(logFile, "utf-8")
    const hasTrailingNewline = content.endsWith("\n")
    const allLines = content.split("\n")
    if (hasTrailingNewline) allLines.pop()

    const { keptLines, removed } = filterLogsByTimeRange(
      allLines,
      startTime,
      endTime,
    )

    const nextContent =
      keptLines.join("\n") +
      (hasTrailingNewline && keptLines.length > 0 ? "\n" : "")

    // Rewrite in place rather than write-temp + rename. The daemon spawn
    // inherits an open append-mode handle to daemon.log
    // (`stdio: ['ignore', logFd, logFd]`), and on Windows `renameSync` over a
    // file with any open handle fails with EPERM — that's why the Clear Logs
    // dialog used to dead-end with a rename error. `openSync('a')` uses
    // shared write/read/delete mode, so a parallel `r+` open + truncate
    // succeeds while the daemon keeps appending at the new file end.
    const nextBytes = Buffer.from(nextContent, "utf-8")
    const fd = fs.openSync(logFile, "r+")
    try {
      if (nextBytes.length > 0)
        fs.writeSync(fd, nextBytes, 0, nextBytes.length, 0)
      fs.ftruncateSync(fd, nextBytes.length)
    } finally {
      fs.closeSync(fd)
    }

    return { removed, remaining: keptLines.length }
  }

  healthCheck(type: string): unknown {
    const healthCheck = this._connector!.healthCheck as (
      type: string,
    ) => unknown
    return healthCheck.call(this._connector, type)
  }

  /**
   * Daemon liveness from the launcher's perspective, independent of whether
   * any agents are configured. Used by the sidebar status dot — relying on
   * agent state means "no agents" looks identical to "daemon dead", which
   * makes the launcher feel broken on first run / after every install
   * failure.
   */
  getDaemonState(): {
    state: "online" | "starting" | "offline"
    pid: number | null
  } {
    const pid = this._getLiveDaemonPid()
    if (pid) return { state: "online", pid }

    // Pid file present but failing the freshness checks in _getLiveDaemonPid
    // (typically during the first few seconds after spawn) — surface as
    // "starting" so the dot doesn't flicker between offline and online.
    try {
      const raw = fs.readFileSync(DAEMON_PID_FILE, "utf-8").trim()
      const candidatePid = parseInt(raw, 10)
      if (Number.isFinite(candidatePid) && isPidAlive(candidatePid)) {
        const age = Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs
        if (age < 15_000) return { state: "starting", pid: candidatePid }
      }
    } catch {}
    return { state: "offline", pid: null }
  }

  private _getLiveDaemonPid(): number | null {
    try {
      const getDaemonPid = this._connector?.getDaemonPid as
        | (() => number | null)
        | undefined
      const pid = getDaemonPid ? getDaemonPid.call(this._connector) : null
      if (!pid) return null

      const pidFileAge = (() => {
        try {
          return Date.now() - fs.statSync(DAEMON_PID_FILE).mtimeMs
        } catch {
          return Number.POSITIVE_INFINITY
        }
      })()
      const statusInfo = (() => {
        try {
          const stat = fs.statSync(DAEMON_STATUS_FILE)
          const raw = JSON.parse(
            fs.readFileSync(DAEMON_STATUS_FILE, "utf-8"),
          ) as { pid?: number }
          return { pid: raw.pid || null, age: Date.now() - stat.mtimeMs }
        } catch {
          return { pid: null, age: Number.POSITIVE_INFINITY }
        }
      })()

      // A live PID alone is not enough on Windows because stale PIDs can be
      // reused by unrelated processes. The daemon writes status every 5s; once
      // the pid file is older than the startup grace period, require matching
      // fresh status as proof that this is really our daemon.
      const startupGraceMs = 15_000
      const statusFreshMs = 20_000
      const hasFreshMatchingStatus =
        statusInfo.pid === pid && statusInfo.age < statusFreshMs
      if (
        isPidAlive(pid) &&
        (pidFileAge < startupGraceMs || hasFreshMatchingStatus)
      )
        return pid

      appendDaemonLog(`removing stale daemon pid ${pid}`)
      for (const file of [
        DAEMON_PID_FILE,
        DAEMON_STATUS_FILE,
        DAEMON_CMD_FILE,
      ]) {
        try {
          fs.unlinkSync(file)
        } catch {}
      }
      this._statusCache = { value: {}, at: 0 }
      return null
    } catch {
      return null
    }
  }

  private _startDaemon(): { success: boolean; pid?: number; message: string } {
    try {
      const stopDaemon = this._connector!.stopDaemon as () => void
      stopDaemon.call(this._connector)
    } catch {}

    const { spawn } = require("child_process")
    const portableNodeDir = path.join(os.homedir(), ".openagents", "nodejs")
    const openagentsDir = path.join(os.homedir(), ".openagents")

    const extraDirs = [portableNodeDir, path.join(portableNodeDir, "bin")]
    const runtimesDir = path.join(openagentsDir, "runtimes")
    try {
      for (const d of fs.readdirSync(runtimesDir, { withFileTypes: true })) {
        if (d.isDirectory())
          extraDirs.push(path.join(runtimesDir, d.name, "node_modules", ".bin"))
      }
    } catch {}
    extraDirs.push(path.join(openagentsDir, "core", "node_modules", ".bin"))
    extraDirs.push(path.join(portableNodeDir, "node_modules", ".bin"))
    if (process.platform === "win32") {
      extraDirs.push(path.join(process.env.APPDATA || "", "npm"))
      try {
        const { execSync: _exec } = require("child_process")
        const npmPrefix = _exec("npm config get prefix", {
          encoding: "utf-8",
          timeout: 5000,
          windowsHide: true,
        }).trim()
        if (npmPrefix && !extraDirs.includes(npmPrefix))
          extraDirs.push(npmPrefix)
      } catch {}
    }
    const enhancedPath = [...extraDirs, process.env.PATH || ""].join(
      path.delimiter,
    )

    let cliPath: string | null = null
    const cliCandidates = [
      path.join(LOCAL_CORE, "bin", "agent-connector.js"),
      path.join(
        portableNodeDir,
        "node_modules",
        "@openagents-org",
        "agent-launcher",
        "bin",
        "agent-connector.js",
      ),
    ]
    for (const c of cliCandidates) {
      try {
        if (fs.existsSync(c)) {
          cliPath = c
          break
        }
      } catch {}
    }
    if (!cliPath) {
      appendDaemonLog(
        `agent-launcher CLI not found; checked ${cliCandidates.join(", ")}`,
      )
      return {
        success: false,
        message:
          "agent-launcher CLI not found. Install an agent first via the Install tab.",
      }
    }

    // Pick a node binary that actually launches. The bundled portable
    // node.exe is preferred when usable, but on some Windows machines it's
    // blocked by Defender / SmartScreen and CreateProcess fails — in that
    // case fall back to system node so the daemon can still start.
    const nodeBin = resolveWorkingNode(portableNodeDir, enhancedPath)
    if (!nodeBin) {
      appendDaemonLog(
        `cannot start daemon: no usable node binary found (portable=${portableNodeDir})`,
      )
      return {
        success: false,
        message:
          "No usable node binary found. Reinstall Node.js or repair the bundled runtime in Settings.",
      }
    }

    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      const logFd = fs.openSync(DAEMON_LOG_FILE, "a")
      appendDaemonLog(`starting daemon: node="${nodeBin}" cli="${cliPath}"`)

      const proc = spawn(nodeBin, [cliPath, "up", "--foreground"], {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: withPathEnv(enhancedPath),
        windowsHide: true,
      })
      proc.once("error", (err: Error) => {
        appendDaemonLog(`daemon spawn error: ${err.message}`)
      })
      proc.once(
        "exit",
        (code: number | null, signal: NodeJS.Signals | null) => {
          appendDaemonLog(
            `daemon process exited early: code=${code ?? "null"} signal=${signal ?? "null"}`,
          )
        },
      )
      proc.unref()
      fs.writeFileSync(DAEMON_PID_FILE, String(proc.pid), "utf-8")
      fs.closeSync(logFd)

      return {
        success: true,
        pid: proc.pid,
        message: `Daemon started (PID ${proc.pid})`,
      }
    } catch (e: unknown) {
      return {
        success: false,
        message: `Failed to start daemon: ${(e as Error).message}`,
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  // Stage 3.1 — Workspace chat (send / get / poll messages)
  // Mirrors the legacy launcher's pattern: chat lives on AgentManager
  // and is invoked from the main process via IPC.
  // ─────────────────────────────────────────────────────────

  private _getWorkspaceClient(): {
    sendMessage: (
      workspaceId: string,
      channelName: string,
      token: string,
      content: string,
      opts?: Record<string, unknown>,
    ) => Promise<{ id?: string }>
    pollMessages: (
      workspaceId: string,
      channelName: string,
      token: string,
      opts?: { after?: string; limit?: number },
    ) => Promise<ChatMessage[]>
    getRecentMessages: (
      workspaceId: string,
      channelName: string,
      token: string,
      limit?: number,
    ) => Promise<ChatMessage[]>
    getAgents: (
      workspaceId: string,
      token: string,
    ) => Promise<Array<{ agentName: string; role: string; status: string }>>
    uploadFile: (
      workspaceId: string,
      token: string,
      filename: string,
      contentBase64: string,
      opts?: Record<string, unknown>,
    ) => Promise<{ id?: string; url?: string; filename?: string }>
    listFiles: (
      workspaceId: string,
      token: string,
      opts?: { limit?: number; offset?: number },
    ) => Promise<unknown>
    readFile: (
      workspaceId: string,
      token: string,
      fileId: string,
    ) => Promise<Buffer>
    deleteFile: (
      workspaceId: string,
      token: string,
      fileId: string,
    ) => Promise<unknown>
  } | null {
    if (!this._connector) return null
    const ws = this._connector.workspace as Record<string, unknown> | undefined
    if (!ws) return null
    return ws as unknown as ReturnType<AgentManager["_getWorkspaceClient"]>
  }

  private _resolveChatWorkspace(workspaceId: string): WorkspaceConfig | null {
    const list = this.getNetworks() as Array<Record<string, unknown>>
    const match = list.find(
      (w) => w.id === workspaceId || w.slug === workspaceId,
    )
    if (!match) return null
    return {
      id: (match.id as string) || (match.slug as string),
      slug: (match.slug as string) || (match.id as string),
      name: match.name as string | undefined,
      endpoint: match.endpoint as string | undefined,
      token: (match.token as string) || "",
    }
  }

  async sendChatMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const ws = this._resolveChatWorkspace(input.workspaceId)
    if (!ws)
      return { success: false, messageId: "", error: "Workspace not found" }
    if (!ws.token)
      return { success: false, messageId: "", error: "Workspace has no token" }

    const client = this._getWorkspaceClient()
    if (!client)
      return {
        success: false,
        messageId: "",
        error: "Workspace client unavailable",
      }

    const channelName = input.channelName || DEFAULT_CHAT_CHANNEL
    const mentions = input.mentions || extractMentions(input.content)
    const targetAgents =
      mentions.length > 0
        ? mentions
        : input.agentId
          ? [input.agentId]
          : undefined

    try {
      const result = await client.sendMessage(
        ws.id,
        channelName,
        ws.token,
        input.content,
        {
          senderType: "human",
          senderName: "user",
          messageType: "chat",
          metadata: targetAgents
            ? { target_agents: targetAgents, mentions }
            : { mentions },
          attachments: attachmentsToServer(input.attachments),
        },
      )
      this._touchChatSession(
        ws,
        channelName,
        input.content || (input.attachments?.[0]?.filename ?? ""),
      )
      return { success: true, messageId: (result as { id?: string }).id || "" }
    } catch (e: unknown) {
      return { success: false, messageId: "", error: (e as Error).message }
    }
  }

  async getChatMessages(
    workspaceId: string,
    channelName?: string,
    limit = 100,
  ): Promise<ChatMessage[]> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return []
    const client = this._getWorkspaceClient()
    if (!client) return []
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    try {
      const messages = await client.getRecentMessages(
        ws.id,
        ch,
        ws.token,
        limit,
      )
      return messages.map(normalizeIncomingMessage)
    } catch {
      return []
    }
  }

  async listChatParticipants(
    workspaceId: string,
  ): Promise<Array<{ agentName: string; role: string; status: string }>> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return []
    const client = this._getWorkspaceClient()
    if (!client) return []
    try {
      return await client.getAgents(ws.id, ws.token)
    } catch {
      return []
    }
  }

  startChatPolling(
    workspaceId: string,
    channelName?: string,
  ): { key: string } | null {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return null
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    const key = `${ws.id}:${ch}`

    const existing = this._chatPolls.get(key)
    if (existing) {
      existing.refs += 1
      return { key }
    }

    const state: ChatPollingState = {
      workspaceId: ws.id,
      channelName: ch,
      token: ws.token,
      cursor: null,
      seenIds: new Set(),
      timer: null,
      refs: 1,
      inFlight: false,
      workspace: ws,
    }
    void this._seedChatCursor(state)
    state.timer = setInterval(() => {
      void this._pollChatOnce(state)
    }, CHAT_POLL_INTERVAL_MS)
    this._chatPolls.set(key, state)
    return { key }
  }

  stopChatPolling(workspaceId: string, channelName?: string): void {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    const key = `${ws.id}:${ch}`
    const state = this._chatPolls.get(key)
    if (!state) return
    state.refs -= 1
    if (state.refs <= 0) {
      if (state.timer) clearInterval(state.timer)
      this._chatPolls.delete(key)
    }
  }

  stopAllChatPolling(): void {
    for (const state of this._chatPolls.values()) {
      if (state.timer) clearInterval(state.timer)
    }
    this._chatPolls.clear()
  }

  private async _seedChatCursor(state: ChatPollingState): Promise<void> {
    const client = this._getWorkspaceClient()
    if (!client) return
    try {
      const recent = await client.getRecentMessages(
        state.workspaceId,
        state.channelName,
        state.token,
        50,
      )
      for (const m of recent) {
        if (m.messageId) state.seenIds.add(m.messageId)
      }
      if (recent.length > 0)
        state.cursor = recent[recent.length - 1].messageId || null
    } catch {}
  }

  private async _pollChatOnce(state: ChatPollingState): Promise<void> {
    if (state.inFlight) return
    state.inFlight = true
    try {
      const client = this._getWorkspaceClient()
      if (!client) return
      const messages = await client.pollMessages(
        state.workspaceId,
        state.channelName,
        state.token,
        {
          after: state.cursor || undefined,
          limit: 50,
        },
      )
      let lastId = state.cursor
      for (const m of messages) {
        if (!m.messageId || state.seenIds.has(m.messageId)) continue
        state.seenIds.add(m.messageId)
        lastId = m.messageId
        const enriched = normalizeIncomingMessage(m)
        this.emit("chat-event", {
          type: "message",
          channel: state.channelName,
          workspaceId: state.workspaceId,
          message: enriched,
        } as ChatStreamEvent)
        if (m.senderType !== "human") {
          this._touchChatSession(
            state.workspace,
            state.channelName,
            m.content || "",
          )
        }
      }
      if (lastId) state.cursor = lastId
    } catch (e: unknown) {
      this.emit("chat-event", {
        type: "error",
        channel: state.channelName,
        workspaceId: state.workspaceId,
        error: (e as Error).message,
      } as ChatStreamEvent)
    } finally {
      state.inFlight = false
    }
  }

  listChatSessions(workspaceId?: string): ChatSessionMeta[] {
    ensureDir(LAUNCHER_SESSIONS_DIR)
    const out: ChatSessionMeta[] = []
    let wsDirs: string[]
    try {
      wsDirs = fs.readdirSync(LAUNCHER_SESSIONS_DIR)
    } catch {
      return []
    }
    for (const wsDir of wsDirs) {
      if (workspaceId && wsDir !== workspaceId) continue
      const dir = path.join(LAUNCHER_SESSIONS_DIR, wsDir)
      let files: string[]
      try {
        files = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith(".json")) continue
        try {
          const data = JSON.parse(
            fs.readFileSync(path.join(dir, f), "utf-8"),
          ) as ChatSessionMeta
          out.push(data)
        } catch {}
      }
    }
    out.sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0
      return tb - ta
    })
    return out
  }

  loadChatSession(
    workspaceId: string,
    channelName: string,
  ): ChatSessionMeta | null {
    try {
      return JSON.parse(
        fs.readFileSync(sessionFilePath(workspaceId, channelName), "utf-8"),
      ) as ChatSessionMeta
    } catch {
      return null
    }
  }

  deleteChatSession(workspaceId: string, channelName: string): boolean {
    try {
      fs.unlinkSync(sessionFilePath(workspaceId, channelName))
      return true
    } catch {
      return false
    }
  }

  clearChatSessions(workspaceId?: string): number {
    let removed = 0
    for (const s of this.listChatSessions(workspaceId)) {
      if (this.deleteChatSession(s.workspaceId, s.channelName)) removed++
    }
    return removed
  }

  private _touchChatSession(
    ws: WorkspaceConfig,
    channelName: string,
    preview: string,
  ): void {
    try {
      const dir = path.join(LAUNCHER_SESSIONS_DIR, ws.id)
      ensureDir(dir)
      const file = path.join(dir, `${channelName}.json`)
      const existing: ChatSessionMeta | null = (() => {
        try {
          return JSON.parse(fs.readFileSync(file, "utf-8")) as ChatSessionMeta
        } catch {
          return null
        }
      })()
      const now = new Date().toISOString()
      const cleaned = preview.replace(/\s+/g, " ").trim().slice(0, 140)
      const meta: ChatSessionMeta = {
        id: `${ws.id}:${channelName}`,
        workspaceId: ws.id,
        workspaceSlug: ws.slug,
        workspaceName: ws.name,
        channelName,
        title: existing?.title || ws.name || ws.slug || channelName,
        lastMessageAt: now,
        lastMessagePreview: cleaned || existing?.lastMessagePreview || null,
        messageCount: (existing?.messageCount || 0) + 1,
        participants: existing?.participants || [],
        createdAt: existing?.createdAt || now,
      }
      fs.writeFileSync(file, JSON.stringify(meta, null, 2), "utf-8")
    } catch {}
  }

  async uploadChatFile(
    workspaceId: string,
    filename: string,
    contentBase64: string,
    opts: { contentType?: string; channelName?: string } = {},
  ): Promise<{
    success: boolean
    fileId?: string
    url?: string
    filename?: string
    error?: string
  }> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this._getWorkspaceClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      const res = await client.uploadFile(
        ws.id,
        ws.token,
        filename,
        contentBase64,
        {
          contentType: opts.contentType || "application/octet-stream",
          source: "human:user",
          channelName: opts.channelName,
        },
      )
      // Server upload endpoint may surface the id as `id`, `file_id`, or
      // even a path-like `key` — match mcp-server.js which falls back across
      // both common names. Without a fileId here, the agent receives an
      // empty file_id in its prompt and can't access the file.
      const r = res as Record<string, unknown>
      const fileId =
        (r.id as string) ||
        (r.file_id as string) ||
        (r.fileId as string) ||
        (r.key as string) ||
        undefined
      return {
        success: true,
        fileId,
        url: (r.url as string) || undefined,
        filename: (r.filename as string) || filename,
      }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }

  async listChatFiles(
    workspaceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { files: [] }
    const client = this._getWorkspaceClient()
    if (!client) return { files: [] }
    try {
      return await client.listFiles(ws.id, ws.token, opts)
    } catch {
      return { files: [] }
    }
  }

  async readChatFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; contentBase64?: string; error?: string }> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this._getWorkspaceClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      const buf = await client.readFile(ws.id, ws.token, fileId)
      return {
        success: true,
        contentBase64: Buffer.from(buf).toString("base64"),
      }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }

  async deleteChatFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this._getWorkspaceClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      await client.deleteFile(ws.id, ws.token, fileId)
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }
}

class Installer {
  static platformKey(): "macos" | "linux" | "windows" {
    if (process.platform === "darwin") return "macos"
    if (process.platform === "win32") return "windows"
    return "linux"
  }
}

function fetchNpmInfo(pkg: string): Promise<NpmRegistryInfo> {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(pkg).replace("%40", "@")}`
    const req = https.get(
      url,
      { headers: { Accept: "application/json" } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchNpmInfo(res.headers.location as string).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let data = ""
        res.setEncoding("utf-8")
        res.on("data", (c) => {
          data += c
        })
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as NpmRegistryInfo)
          } catch (e) {
            reject(e as Error)
          }
        })
      },
    )
    req.on("error", reject)
    req.setTimeout(10000, () => req.destroy(new Error("npm registry timeout")))
  })
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return y - x
  }
  return 0
}

// Semver pre-release identifier — anything after a hyphen (`-beta.1`, `-rc.2`,
// `-canary.123`). Plain releases match /^\d+\.\d+\.\d+$/ with no hyphen.
function isPreRelease(version: string): boolean {
  return version.includes("-")
}

// Versions published to npm, sorted highest-first. Stable-only by default —
// previously this returned every published version including betas, which
// made the marketplace surface a beta as "latest" even though `npm install
// <pkg>` only fetches dist-tags.latest. After installing the actual newest
// stable, the card would still claim an update was available because it was
// comparing against the beta. Pass includePreRelease for the changelog
// listing where surfacing betas is useful.
function sortedPublishedVersions(
  info: NpmRegistryInfo | null,
  opts: { includePreRelease?: boolean } = {},
): string[] {
  return Object.keys(info?.versions || {})
    .filter((v) => /^\d/.test(v))
    .filter((v) => (opts.includePreRelease ? true : !isPreRelease(v)))
    .sort(compareVersionsDesc)
}

function resolveLatestVersion(info: NpmRegistryInfo | null): string | null {
  // dist-tags.latest is the source of truth for what `npm install <pkg>`
  // installs. Use it whenever it's published; only fall back to scanning the
  // versions map for packages that don't publish a `latest` tag.
  const tagged = info?.["dist-tags"]?.latest
  if (tagged) return tagged
  return sortedPublishedVersions(info)[0] || null
}

function normalizeTimeValue(value: string | number | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function filterLogsByTimeRange(
  lines: string[],
  start: Date,
  end: Date,
): { keptLines: string[]; removed: number } {
  const headerTimes = resolveLogHeaderTimestamps(lines, end)
  let activeRemove = false
  let removed = 0
  const keptLines: string[] = []

  for (let index = 0; index < lines.length; index++) {
    const headerTime = headerTimes[index]
    if (headerTime) {
      const time = headerTime.getTime()
      activeRemove = time >= start.getTime() && time <= end.getTime()
    }
    if (activeRemove) {
      removed++
    } else {
      keptLines.push(lines[index])
    }
  }

  return { keptLines, removed }
}

function resolveLogHeaderTimestamps(
  lines: string[],
  referenceTime: Date,
): (Date | null)[] {
  const resolved: (Date | null)[] = new Array(lines.length).fill(null)
  let currentDay = startOfLocalDay(referenceTime)
  let lastClockSeconds: number | null = null

  for (let index = lines.length - 1; index >= 0; index--) {
    const token = parseLogTimestampToken(lines[index])
    if (!token) continue

    if (token.kind === "iso") {
      resolved[index] = token.date
      currentDay = startOfLocalDay(token.date)
      lastClockSeconds =
        token.date.getHours() * 3600 +
        token.date.getMinutes() * 60 +
        token.date.getSeconds()
      continue
    }

    if (lastClockSeconds !== null && token.seconds > lastClockSeconds) {
      currentDay = addLocalDays(currentDay, -1)
    }

    resolved[index] = withLocalClock(currentDay, token.seconds)
    lastClockSeconds = token.seconds
  }

  return resolved
}

function parseLogTimestampToken(
  line: string,
): { kind: "iso"; date: Date } | { kind: "clock"; seconds: number } | null {
  if (!line) return null

  const isoMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))/,
  )
  if (isoMatch) {
    const date = new Date(isoMatch[1])
    if (!Number.isNaN(date.getTime())) return { kind: "iso", date }
  }

  const clockMatch = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/)
  if (clockMatch) {
    return {
      kind: "clock",
      seconds:
        Number(clockMatch[1]) * 3600 +
        Number(clockMatch[2]) * 60 +
        Number(clockMatch[3]),
    }
  }

  return null
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function withLocalClock(day: Date, seconds: number): Date {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes,
    secs,
  )
}
