import path from "path"
import fs from "fs"
import os from "os"
import { app } from "electron"
import { spawn } from "child_process"
import {
  PAIRING_CODE_LENGTH,
  clearPairing,
  clearRevocation,
  gatherDeviceInfo,
  inferDeviceType,
  listPairings,
  listRevocations,
  normalizePairingCode,
  recordPairing,
  revokePairing,
  type DeviceInfo,
  type NodePairing,
} from "./node-pairing"
import { EventEmitter } from "events"
import {
  CONFIG_DIR,
  DAEMON_LOG_FILE,
  GLOBAL_CORE,
  LAUNCHER_SESSIONS_DIR,
  ensureDir,
} from "./agents/paths"
import { loadCore, readCoreVersion } from "./agents/runtime"
import {
  AMP_LOGGED_OUT,
  CORE_AGENTS,
  CORE_AGENT_ORDER,
  DUAL_LOGIN_AGENTS,
  HOSTED_LOGIN_AGENTS,
  KEY_OPTIONAL_LOGIN_AGENTS,
  launcherAuthFields,
} from "./agents/auth-specs"
import {
  normalizeEnvForSave,
  normalizeWorkspaceEndpoint,
} from "./agents/env-normalize"
import { testLLMConnection, type LLMTestResult } from "./agents/llm-test"
import {
  listAgentModels,
  type ModelListPath,
  type ModelListResult,
} from "./agents/model-catalog"
import { clearLogsInRange as clearDaemonLogsInRange } from "./agents/daemon-logs"
import {
  appendDaemonLog,
  getLiveDaemonPid,
  readDaemonState,
  startDaemon,
} from "./agents/daemon-process"
import { HealthResolver, type HealthResolverDeps } from "./agents/health"
import {
  InstallService,
  type InstalledAgentRecord,
} from "./agents/install-service"
import { LoginProbe } from "./agents/login-probe"
import { buildBinaryTypeMap } from "./agents/binary-map"
import { shellCommandFor } from "./win-exec"
import { ChatService } from "./chat/service"
import type {
  ChatMessage,
  ChatSessionMeta,
  SendMessageInput,
  SendMessageResult,
  WorkspaceConfig,
  WorkspaceChatClient,
} from "./chat/types"
// Bundled fallback registry. When the agent-launcher core hasn't installed
// yet (slow network, antivirus interference on Windows, etc) the connector's
// catalog comes back empty and the onboarding step shows nothing to pick.
// Inlining the registry at build time gives the UI a guaranteed catalog so
// "Pick your first agent" is always populated.
import BUNDLED_REGISTRY from "../../../agent-connector/registry.json"

interface LauncherSettingsStore {
  get(key?: string): unknown
}

/**
 * A fully-resolved agent for the onboarding picker. Unlike a raw CatalogEntry
 * this is guaranteed to be runnable by the loaded core, and its auth mode is
 * resolved authoritatively (so an agent that needs a key/login is never
 * mislabelled as "no configuration needed").
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
  envFields: Array<Record<string, unknown>>
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
 * This device's workspace registrations — see the node-pairing section below.
 *
 * A device can be a node in SEVERAL workspaces at once (the node row is keyed
 * per workspace + device), so `workspaces` is the real answer and the
 * singular fields describe the most recent pairing among them.
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
   * Pairings the workspace side has revoked (node row gone). Kept so the UI
   * can say "device removed" and offer to join again, instead of the workspace
   * silently dropping off this machine.
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

// The chat and install types now live with the code that owns them, but the
// IPC layer still imports them from here.
export type {
  ChatAttachment,
  ChatMessage,
  ChatSessionMeta,
  ChatStreamEvent,
  ChatToolCall,
  SendMessageInput,
  SendMessageResult,
} from "./chat/types"
export type { InstalledAgentRecord } from "./agents/install-service"
export { extractMentions } from "./chat/messages"

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
  private _statusCache: { value: unknown; at: number } = { value: {}, at: 0 }
  _connector: Record<string, unknown> | null = null
  /** Last time the active node pairing was checked against its workspace. */
  private _nodeVerifiedAt = 0

  /** Sign-in state for CLIs that own their own login (Cursor, Hermes, Claude). */
  private _login: LoginProbe
  /** The Agents list's "Ready" verdict, reconciled against the core's own. */
  private _health: HealthResolver
  /** npm install/uninstall/rollback plus the on-disk install history. */
  private _install: InstallService
  /** Workspace chat: send, poll, sessions, files. */
  private _chat: ChatService

  constructor(store: LauncherSettingsStore) {
    super()
    this._store = store
    if (!core) core = loadCore()
    if (core) {
      this._connector = this.createConnector()
    }
    ensureDir(LAUNCHER_SESSIONS_DIR)

    this._login = new LoginProbe({
      resolveBinary: (type) => this.resolveBinary(type),
      getSavedTypeEnv: (type) => this._savedTypeEnvForProbe(type),
      getCore: () => core,
      // A probe that settles changes what the Agents list should say, so drop
      // the caches it would otherwise be served from.
      onSettled: (type) => {
        if (HOSTED_LOGIN_AGENTS[type]) {
          this._healthByType.set(type, this._health.hostedLoginHealth(type))
        }
        this._agentsCache = { value: [], at: 0 }
      },
    })
    this._health = new HealthResolver(this._healthDeps())
    this._install = new InstallService({
      connector: () => this._connector,
      clearCatalogCache: () => this.clearCatalogCache(),
      getCatalog: () => this.getCatalog(),
      resolveBinary: (type) => this.resolveBinary(type),
    })
    this._chat = new ChatService({
      getClient: () => this._getWorkspaceClient(),
      resolveWorkspace: (workspaceId) =>
        this._resolveChatWorkspace(workspaceId),
      emit: (event) => {
        this.emit("chat-event", event)
      },
    })
  }

  private _healthDeps(): HealthResolverDeps {
    return {
      isInstalled: (type) => this._isInstalled(type),
      getInstalledVersion: (type) => this.getInstalledVersion(type),
      getTypeEnv: (type) =>
        this.getAgentEnv(type) as Record<string, string> | undefined,
      loginIsAuthed: (type) => this._login.isAuthed(type),
      getRegistryEntry: (type) => this._getRegistryEntry(type),
    }
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
    return readCoreVersion()
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
    // The core can still be loading — or have been swapped out by an update —
    // when a page asks for the list. Returning [] here reads to the renderer as
    // "this machine has no agents", which is how the marketplace ends up
    // offering the setup wizard for an agent that already has an instance. Try
    // to bring the connector up first; only a core that truly isn't there
    // answers empty.
    if (!this._connector) {
      try {
        this._ensureConnector()
      } catch {
        return []
      }
    }
    const listAgents = this._connector!.listAgents as () => unknown[]
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
        health: this._health.reconcileAgentHealth(
          type,
          a.env as Record<string, string> | undefined,
          this._healthByType.get(type) || null,
        ),
        runtimeMismatch,
        // Whether this agent type has an interactive CLI binary we can open a
        // terminal session against. API-only types (kimi, openclaw — run via the
        // core's generic LLM runner) resolve to no binary, so the renderer hides
        // the "Chat" action for them.
        hasCli: !!this.resolveBinary(type),
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
          // Hosted-login agents derive readiness from the CLI's `status`, not
          // the core's check_ready (which has no login rule). Compute it here,
          // in the 30s refresh, so the per-call getAgents path never spawns.
          if (HOSTED_LOGIN_AGENTS[type]) {
            this._healthByType.set(type, this._health.hostedLoginHealth(type))
          } else {
            const healthCheck = this._connector?.healthCheck as
              ((type: string) => unknown) | undefined
            const health = healthCheck
              ? healthCheck.call(this._connector, type)
              : null
            this._healthByType.set(type, health)
            // Dual-auth agents (Claude): keep the CLI sign-in cache warm so the
            // agents list reflects a subscription login without an API key.
            if (DUAL_LOGIN_AGENTS[type]) void this._login.refresh(type)
          }
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

  /**
   * Install check matching the marketplace's "Installed" badge (getInstallInfo),
   * minus the installs that are only claimed by a marker — see
   * `InstallService.installVanished`. Without that second half an agent whose
   * package is gone reads as installed-but-broken everywhere: the Agents list
   * says "Login required" for a CLI that isn't on the machine, and the only
   * action that would actually fix it (install) is the one the UI hides.
   */
  private _isInstalled(type: string): boolean {
    try {
      const isInstalled = this._connector?.isInstalled as
        ((t: string) => boolean) | undefined
      if (!isInstalled?.call(this._connector, type)) return false
      return !this._install.installVanished(type)
    } catch {
      return false
    }
  }

  /**
   * Resolve an agent type's CLI to an ABSOLUTE binary path (via the core's
   * `installer.which`, which searches the enhanced PATH incl. the Cursor/Hermes
   * native install dirs). Returns null when the binary can't be located.
   */
  resolveBinary(type: string): string | null {
    try {
      const installer = this._connector?.installer as
        Record<string, unknown> | undefined
      const which = installer?.which as
        ((t: string) => string | null) | undefined
      const bin = which?.call(installer, type) || null
      this._logUnshimmedBinary(type, bin)
      return bin
    } catch {
      return null
    }
  }

  /** Last path we logged as shim-less, per type — so a re-install re-reports. */
  private _unshimmedLogged = new Map<string, string>()

  /**
   * Record when an agent's CLI resolves to something Windows can't execute
   * directly — the package's own `bin\x.js`, or npm's extensionless Git-Bash
   * script — because `where` found no `.cmd` shim for it.
   *
   * This is a diagnostic, not a failure: the launcher runs those shapes fine now
   * (see win-exec.ts). It is logged because the DAEMON does not. Every npm
   * adapter (claude, codex, gemini, cline, opencode, pi) resolves its binary
   * with its own tiered search that only ever builds `<name>.cmd` on Windows and
   * never falls back to the package bin — so an agent in this state looks
   * installed and signs in from the launcher while every message to it fails.
   * When that report comes in, this line in the log is the answer, and nobody
   * has to go read directories over chat to find it.
   */
  private _logUnshimmedBinary(type: string, bin: string | null): void {
    if (process.platform !== "win32" || !bin) return
    if (/\.(cmd|bat|exe)$/i.test(bin)) return
    if (this._unshimmedLogged.get(type) === bin) return
    this._unshimmedLogged.set(type, bin)
    appendDaemonLog(
      `${type}: CLI resolved to "${bin}" — no Windows .cmd shim was found for it. ` +
        `The launcher can run this, but the daemon's ${type} adapter only looks for ` +
        `${type}.cmd, so agents of this type may fail to start. Reinstalling ${type} ` +
        `from the marketplace should restore the shim.`,
    )
  }

  /** Binary name → agent type, built once from the registry. See binary-map.ts. */
  private _binaryTypeMap: Map<string, string> | null = null
  private _binaryToType(): Map<string, string> {
    if (!this._binaryTypeMap)
      this._binaryTypeMap = buildBinaryTypeMap(
        Array.isArray(BUNDLED_REGISTRY)
          ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
          : [],
      )
    return this._binaryTypeMap
  }

  /**
   * Rewrite a command (e.g. "codex login", "cursor-agent login", "hermes setup")
   * so its leading binary token becomes something Windows can actually execute:
   * the resolved ABSOLUTE path, quoted, and routed through `node` when the
   * resolved bin is a plain `.js` (see win-exec.ts).
   *
   * This is the fix for the Windows "'x' is not recognized as an internal or
   * external command" failure in the login terminal. A CLI's installer only
   * edits the *registry* PATH (Cursor drops itself under
   * %LOCALAPPDATA%\cursor-agent) or lands in a per-agent runtime prefix the
   * fresh cmd window was never told about — so a bare command dies even though
   * the launcher knows exactly where the binary is. An absolute path sidesteps
   * PATH entirely.
   *
   * `agentType` is passed by callers that already know which agent they're
   * launching; without it the type is traced from the binary name. Returns the
   * command unchanged when neither resolves (callers still inject PATH as a
   * fallback).
   */
  resolveLoginCommand(cmd: string, agentType?: string): string {
    if (!cmd || !cmd.trim()) return cmd
    const trimmed = cmd.trim()
    // First whitespace-delimited token, with any surrounding quotes stripped.
    const m = trimmed.match(/^("[^"]*"|'[^']*'|\S+)(\s+[\s\S]*)?$/)
    if (!m) return cmd
    const rawFirst = m[1].replace(/^["']|["']$/g, "")
    const rest = m[2] || ""
    // `.js` is in the strip list because that is what the core hands back for an
    // npm agent with no Windows shim on PATH (…\@openai\codex\bin\codex.js).
    const base = rawFirst
      .replace(/\.(exe|cmd|ps1|bat|js|cjs|mjs)$/i, "")
      .split(/[\\/]/)
      .pop()
    const type =
      agentType ||
      (base ? this._binaryToType().get(base.toLowerCase()) : undefined)
    if (!type) return cmd
    const abs = this.resolveBinary(type)
    if (!abs) return cmd
    return `${shellCommandFor(abs)}${rest}`
  }

  /**
   * The dirs the core prepends to PATH when it spawns an agent (npm's global
   * prefix, the per-agent runtime bins, nvm/fnm/volta, the native Cursor/Amp/
   * Hermes install dirs…). Exposed so the login terminal can hand a new cmd
   * window the SAME PATH the daemon uses instead of maintaining a second,
   * always-lagging copy of the list. Empty when the core isn't loaded.
   */
  extraBinDirs(): string[] {
    try {
      const paths = core?.paths as
        { getExtraBinDirs?: () => string[] } | undefined
      const dirs = paths?.getExtraBinDirs?.()
      return Array.isArray(dirs)
        ? dirs.filter((d) => typeof d === "string")
        : []
    } catch {
      return []
    }
  }

  /**
   * The CLI sign-in command for an agent type ("claude auth login"), or null
   * when it has none. Both login paths read it from here so the in-app flow and
   * the terminal fallback can never drift apart.
   */
  /**
   * A line to print in the login terminal before the command, when this CLI's
   * sign-in isn't where the user would look for it (Gemini's `/auth`). Null for
   * everything else.
   */
  loginHintFor(type: string): string | null {
    return this._login.specFor(type)?.terminalHint || null
  }

  loginCommandFor(type: string): string | null {
    const spec = this._login.specFor(type)
    if (spec) return spec.loginCommand
    // Agents the launcher has no spec of its own for (cline, copilot) still get
    // a login command from the shared registry, and the UI offers them a Login
    // button on the strength of it — so the in-app flow has to know it too, or
    // that button would only ever throw.
    try {
      const entries = Array.isArray(BUNDLED_REGISTRY)
        ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
        : []
      const entry = entries.find((e) => e.name === type)
      const cmd = (entry?.check_ready as Record<string, unknown> | undefined)
        ?.login_command
      return typeof cmd === "string" && cmd.trim() ? cmd : null
    } catch {
      return null
    }
  }

  /**
   * The enhanced-PATH child env, for callers outside this class that spawn an
   * agent CLI themselves (the in-app login orchestrator). Same env the daemon's
   * adapter and the sign-in probe use — never a bare process.env.
   */
  childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    return this._login.childEnv(extra)
  }

  /**
   * Run a FRESH sign-in probe for a hosted-login agent and resolve its health.
   * Awaitable — the Configure dialog calls this after the user confirms they
   * completed the terminal login, so the result reflects reality rather than an
   * optimistic guess.
   */
  async refreshHostedLogin(type: string): Promise<unknown> {
    if (!this._login.specFor(type)) return this.healthCheck(type)
    await this._login.refresh(type, true)
    // Pure hosted-login → login-only verdict. Dual-auth (Claude) → the combined
    // health, now reflecting the just-refreshed sign-in probe.
    if (HOSTED_LOGIN_AGENTS[type]) return this._health.hostedLoginHealth(type)
    return this.healthCheck(type)
  }

  /** Saved type-level env for a probe (e.g. AMP_URL / AMP_API_KEY), never thrown. */
  private _savedTypeEnvForProbe(type: string): Record<string, string> {
    try {
      return (this.getAgentEnv(type) as Record<string, string>) || {}
    } catch {
      return {}
    }
  }

  /**
   * Clear a hosted-login agent's stale env (e.g. CURSOR_API_KEY, CURSOR_MODEL)
   * from both the type-level and instance env. Cursor's CLI prefers an explicit
   * key/model over its own browser-login session and account defaults, so values
   * left over from the old setup wizard (an invalid key, a bogus model like
   * "gpt-5.4") make the agent fail — "API key is invalid" — even after a
   * successful `cursor-agent login`. When the user signs in via the browser flow
   * we wipe them so the login session + account defaults are what get used.
   * Saving an empty value removes the line (env.save filters out empties).
   */
  clearHostedLoginApiKey(type: string, agentName?: string): void {
    const keys = HOSTED_LOGIN_AGENTS[type]?.loginClearsEnv
    if (!keys?.length) return
    try {
      const typeEnv = (this.getAgentEnv(type) as Record<string, string>) || {}
      const drop = keys.filter((k) => (typeEnv[k] || "").trim())
      if (drop.length)
        this.saveAgentEnv(type, Object.fromEntries(drop.map((k) => [k, ""])))
    } catch {}
    if (agentName) {
      try {
        const instEnv =
          (this.getAgentInstanceEnv(agentName) as Record<string, string>) || {}
        const drop = keys.filter((k) => (instEnv[k] || "").trim())
        if (drop.length)
          this.saveAgentInstanceEnv(
            agentName,
            Object.fromEntries(drop.map((k) => [k, ""])),
          )
      } catch {}
    }
    this._agentsCache = { value: [], at: 0 }
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
      saveEnv.call(this._connector, name, normalizeEnvForSave(updates.env))
    }
    this._agentsCache = { value: [], at: 0 }
    return { success: true }
  }

  /**
   * Change an existing agent's working directory (its spawn cwd, stored as the
   * `path` field in daemon.yaml). The folder is created up-front — a missing
   * cwd makes the agent subprocess fail to spawn. The new cwd takes effect the
   * next time the agent starts; a running agent is asked to reload so the
   * daemon re-reads the config.
   *
   * The connector's published `config.updateAgent` is used directly here: the
   * top-level connector exposes no agent-path setter, and reimplementing the
   * daemon.yaml read-modify-write launcher-side would risk diverging from the
   * core's serializer. `config.updateAgent` has shipped in the core for a long
   * time, so it's a safe internal to lean on.
   */
  async setAgentWorkingDir(name: string, dirPath: string): Promise<unknown> {
    const p = (dirPath || "").trim()
    if (!p) throw new Error("A working directory is required.")
    try {
      fs.mkdirSync(p, { recursive: true })
    } catch (e) {
      throw new Error(
        `Could not create the agent folder '${p}': ${(e as Error).message}`,
      )
    }
    const config = (this._connector as { config?: unknown } | null)?.config as
      { updateAgent?: (name: string, updates: unknown) => unknown } | undefined
    if (!config?.updateAgent) {
      throw new Error(
        "Updating the working directory isn't supported by the installed core. Please update, then try again.",
      )
    }
    config.updateAgent(name, { path: p })
    this._agentsCache = { value: [], at: 0 }
    // Nudge the daemon to re-read daemon.yaml so a running agent picks up the
    // new cwd on its next (re)start. Best-effort: a stopped daemon just means
    // the change applies whenever it next starts the agent.
    try {
      const sendCmd = this._connector!.sendDaemonCommand as (c: string) => void
      sendCmd?.call(this._connector, "reload")
    } catch {}
    return { success: true, path: p }
  }

  clearCatalogCache(): void {
    this._catalogCache = { value: null, at: 0, inFlight: null }
    this._install.clearUpdatesCache()
    try {
      const clearCache = this._connector?.clearCatalogCache as
        (() => void) | undefined
      clearCache?.call(this._connector)
    } catch {}
  }

  async getCatalog(force = false): Promise<unknown[]> {
    const now = Date.now()
    const ttl = process.platform === "win32" ? 60_000 : 10_000
    // Empty arrays must NOT count as a valid cached value — otherwise a
    // transient miss (connector not loaded yet, network blocked, etc) gets
    // pinned for the full TTL and onboarding shows "no agents" until the
    // user restarts. Treat non-empty cached entries as fresh; empty ones
    // always re-fetch.
    const cached = this._catalogCache.value
    const haveFresh =
      Array.isArray(cached) &&
      cached.length > 0 &&
      now - this._catalogCache.at < ttl
    if (!force && haveFresh) return cached as unknown[]
    if (!force && this._catalogCache.inFlight)
      return this._catalogCache.inFlight

    const load = this._loadCatalog()
      .then((catalog) => {
        const value =
          Array.isArray(catalog) && catalog.length > 0
            ? catalog
            : this._fallbackCatalog()
        this._catalogCache = {
          value,
          // Pin the cache only when we got a real catalog. A fallback result
          // (connector still warming up) should keep retrying so the UI
          // updates as soon as the connector recovers.
          at: value === catalog ? Date.now() : 0,
          inFlight: null,
        }
        return value
      })
      .catch(() => {
        this._catalogCache.inFlight = null
        // Surface a fallback rather than a rejection — onboarding's IPC
        // handler swallows errors silently and would otherwise leave the
        // picker permanently empty.
        return this._fallbackCatalog()
      })
    this._catalogCache.inFlight = load
    return load
  }

  /**
   * Bundled fallback when the connector hasn't loaded yet. Annotates each
   * entry with `installed: false` so the UI treats them as "needs install".
   */
  private _fallbackCatalog(): unknown[] {
    const entries = Array.isArray(BUNDLED_REGISTRY)
      ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
      : []
    return entries.map((e) => {
      // Both hosted-login (Cursor/Hermes) and dual-auth (Claude) agents expose a
      // CLI login the shared registry doesn't carry — inject it so the Configure
      // dialog / Quick Start (which read check_ready.login_command) offer it too.
      const spec = this._login.specFor(e.name as string)
      const check_ready = spec
        ? {
            ...((e.check_ready as Record<string, unknown>) || {}),
            login_command: spec.loginCommand,
          }
        : e.check_ready
      return {
        ...e,
        check_ready,
        installed: false,
        managed: false,
        location: null,
      }
    })
  }

  private async _loadCatalog(): Promise<unknown[]> {
    if (!this._connector) return []
    let catalog: unknown[]
    try {
      const getCatalog = this._connector.getCatalog as () => Promise<unknown[]>
      catalog = await getCatalog.call(this._connector)
    } catch {
      try {
        const registry = this._connector.registry as Record<string, unknown>
        const getCatalogSync = registry.getCatalogSync as () => unknown[]
        const installer = this._connector.installer as Record<string, unknown>
        const getInstallInfo = installer.getInstallInfo as (name: string) => {
          installed: boolean
          managed?: boolean
          location?: string
        }
        catalog = getCatalogSync.call(registry).map((e) => {
          const entry = e as Record<string, unknown>
          const info = getInstallInfo.call(installer, entry.name as string)
          return {
            ...entry,
            installed: info.installed,
            managed: info.managed,
            location: info.location,
          }
        })
      } catch {
        return []
      }
    }
    try {
      const registry = this._connector.registry as Record<string, unknown>
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
    } catch {}
    // Launcher-side login wiring for hosted-login agents (e.g. Cursor): the
    // shared registry has no login_command for these, so expose the CLI's own
    // sign-in here. This makes the Configure dialog render its "Login" flow
    // (open a terminal running `cursor-agent login`) instead of falling back to
    // "No configuration required". Kept in launcher code so the shared registry
    // stays untouched — same rationale as LAUNCHER_AUTH_OVERRIDES.
    for (const entry of catalog) {
      const e = entry as Record<string, unknown>
      // _loginSpec covers both hosted-login (Cursor/Hermes) and dual-auth
      // (Claude) agents — both surface a CLI login the registry omits.
      const spec = this._login.specFor(e.name as string)
      if (!spec) continue
      const checkReady = (e.check_ready as Record<string, unknown>) || {}
      e.check_ready = { ...checkReady, login_command: spec.loginCommand }
    }
    // Demote installs the core only knows about from a marker. getInstallInfo
    // reports installed:true for an agent whose package has since disappeared,
    // which is how the marketplace offered "Update to v0.147.0" and "Uninstall"
    // for a Codex that wasn't on the disk at all. Cheap in the normal case: the
    // check short-circuits on entries that aren't claimed as installed, and on
    // the package.json of the ones that really are.
    for (const entry of catalog) {
      const e = entry as Record<string, unknown>
      if (!e.installed) continue
      if (!this._install.installVanished(e.name as string)) continue
      e.installed = false
      e.managed = false
      e.location = null
    }
    // Stamp the supported-core flag + display order. Non-core agents become
    // "coming soon" (the UI sinks + disables them); core agents carry the
    // product-defined order from CORE_AGENTS.
    for (const entry of catalog) {
      const e = entry as Record<string, unknown>
      const idx = CORE_AGENT_ORDER.get(e.name as string)
      e.comingSoon = idx === undefined
      e.coreOrder = idx ?? 999
    }
    return catalog
  }

  async getEnvFields(agentType: string): Promise<unknown[]> {
    // Launcher-side override is authoritative. Agents like claude/gemini ship
    // in the shared registry with an EMPTY env_config (they default to a
    // terminal login), but the launcher authenticates them with an API key /
    // base URL entered in-app. Returning the override fields here makes those
    // inputs appear everywhere env is edited — onboarding AND the Install
    // detail page — and stay editable after the agent is configured (otherwise
    // the detail page hides the setup wizard once an instance exists yet has no
    // inline fields to show, leaving no way to change the key/base URL).
    // required cleared for dual-login agents — see launcherAuthFields.
    const override = launcherAuthFields(agentType)
    if (override) return this._optionalWhenLoginExists(agentType, override)

    // Mirror getCatalog's bundled fallback: when the agent-launcher core
    // hasn't installed yet, _ensureConnector throws ("Core library not
    // installed"). Without a fallback that rejection bubbles up to the
    // onboarding Step 2 Promise.all, which then collapses every agent to the
    // default mode:"none" — so the "Configure agent" step shows "no
    // configuration needed" for codex/kimi/etc that actually require API keys.
    // Fall back to the inlined registry so env fields are always available.
    try {
      this._ensureConnector()
      const getEnvFields = this._connector!.getEnvFields as (
        type: string,
      ) => unknown[]
      const fields = getEnvFields.call(this._connector, agentType)
      if (Array.isArray(fields))
        return this._optionalWhenLoginExists(agentType, fields)
    } catch {
      // fall through to bundled fallback
    }
    return this._optionalWhenLoginExists(
      agentType,
      this._fallbackEnvFields(agentType),
    )
  }

  /**
   * Clear `required` on the env fields of a hosted-login agent.
   *
   * These agents (Cursor) sign in through their own service, and the registry
   * declares their key as an OPTIONAL alternative — Cursor's own env_config
   * marks CURSOR_API_KEY `required: false`. The launcher used to return [] here
   * instead, on the reasoning that there was nothing to collect and nothing to
   * test. But the key path is real and the launcher already honors it
   * everywhere else: HOSTED_LOGIN_AGENTS.apiKeyEnv names it, readiness treats a
   * set key as "signed in" (_reconcileAgentHealth), and loginClearsEnv wipes it
   * on a browser sign-in. Hiding the field left readiness reading a value no
   * screen could set, and left a user whose `cursor-agent login` won't complete
   * with no second option anywhere in the app.
   *
   * Forcing `required: false` is the safety belt: a login-only user must never
   * be blocked by a key field they're deliberately leaving empty. Agents with no
   * declared env (Hermes) still get [] and stay login-only, untouched.
   */
  private _optionalWhenLoginExists(type: string, fields: unknown[]): unknown[] {
    if (!HOSTED_LOGIN_AGENTS[type]) return fields
    return fields.map((f) => ({
      ...(f as Record<string, unknown>),
      required: false,
    }))
  }

  /**
   * env_config from the bundled registry for a single agent. Used when the
   * connector isn't loaded yet so onboarding's API-key step still renders the
   * right fields. Mirrors _fallbackCatalog.
   */
  private _fallbackEnvFields(agentType: string): unknown[] {
    const entries = Array.isArray(BUNDLED_REGISTRY)
      ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
      : []
    const entry = entries.find((e) => e.name === agentType)
    const env = entry?.env_config
    return Array.isArray(env) ? env : []
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
    env = normalizeEnvForSave(env)
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
    } catch (e) {
      // Swallowed on purpose: the env itself saved fine, so we still report
      // success. But a failure here means OpenClaw's native auth was NOT
      // configured and the agent will fail to authenticate later with no
      // obvious cause — log it so that later failure is traceable.
      console.error("Failed to configure OpenClaw native auth:", e)
    }

    this.signalReload()
    return { success: true }
  }

  saveAgentInstanceEnv(
    agentName: string,
    env: Record<string, string>,
  ): unknown {
    env = normalizeEnvForSave(env)
    const saveEnv = this._connector!.saveAgentInstanceEnv as (
      name: string,
      env: unknown,
    ) => void
    saveEnv.call(this._connector, agentName, env)
    this.signalReload()
    return { success: true }
  }

  async testLLM(env: Record<string, string>): Promise<LLMTestResult> {
    // Amp signs in against Sourcegraph's own service — there's no OpenAI-style
    // endpoint to probe — so when the user supplies an AMP_API_KEY we verify it
    // the way Amp itself does: run the installed CLI's `amp usage`. (Browser
    // sign-in via `amp login` is detected separately by the dual-login probe.)
    if ((env.AMP_API_KEY || "").trim()) {
      return this._testAmpConnection(env)
    }
    // Run the test in-launcher rather than delegating to the installed core's
    // testLLM: the core that ships on a user's machine is often older and only
    // probes the OpenAI-compatible path, so Claude/Gemini keys come back as
    // "No API key provided". testLLMConnection covers every provider and works
    // even before the core is installed.
    return testLLMConnection(env)
  }

  /**
   * The models this agent can be pointed at, given the credentials currently in
   * the form. Read from the agent's own CLI cache or the provider endpoint —
   * see agents/model-catalog. Kept in the launcher (not the installed core) for
   * the same reason testLLM is: an older core on the user's machine knows
   * nothing about it.
   */
  async listModels(
    agentType: string,
    env: Record<string, string>,
    path?: ModelListPath,
  ): Promise<ModelListResult> {
    return listAgentModels(
      agentType,
      env || {},
      {
        runCli: (type, args, extra) => this._runCliForModels(type, args, extra),
      },
      path,
    )
  }

  /**
   * Run an agent's CLI for its model list (today: `cursor-agent --list-models`).
   * Goes through LoginProbe.spawnAgentCli so it inherits the one launch shape
   * that survives Windows npm shims and the enhanced PATH — the same reasons
   * the sign-in probe can't just call spawn() itself. Returns null on anything
   * that isn't a clean run; the caller then falls back or says it has no list.
   *
   * `extra` carries the credentials being configured (e.g. the CURSOR_API_KEY
   * typed into the key form) so the CLI answers for THEM rather than for the
   * sign-in this machine happens to hold. It goes in the child's env, never on
   * the command line, where it would show up in the process list.
   */
  private _runCliForModels(
    agentType: string,
    args: string[],
    extra?: Record<string, string>,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const bin = this.resolveBinary(agentType)
      if (!bin) return resolve(null)
      try {
        const child = this._login.spawnAgentCli(bin, args, {
          ...this._savedTypeEnvForProbe(agentType),
          ...(extra || {}),
        })
        let out = ""
        let settled = false
        const finish = (value: string | null): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {}
          finish(null)
        }, 15000)
        child.stdout?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
        child.on("error", () => finish(null))
        child.on("close", (code) => finish(code === 0 ? out : null))
      } catch {
        resolve(null)
      }
    })
  }

  /**
   * Verify an Amp API key the way Amp itself does. Amp authenticates against
   * Sourcegraph's own service (no OpenAI-style endpoint to probe), so we run the
   * installed CLI's `amp usage` with the key injected: it prints the account's
   * credit balance for a valid token and AMP_LOGGED_OUT's error otherwise. Falls
   * back to an honest message when the CLI isn't installed yet — install Amp
   * first, then test (or run `amp login`).
   */
  private _testAmpConnection(
    env: Record<string, string>,
  ): Promise<LLMTestResult> {
    return new Promise((resolve) => {
      const bin = this.resolveBinary("amp")
      if (!bin) {
        resolve({
          success: false,
          error:
            "Amp CLI not found — install Amp first, then test (or run `amp login`).",
        })
        return
      }
      const extra: Record<string, string> = {}
      const key = (env.AMP_API_KEY || "").trim()
      if (key) extra.AMP_API_KEY = key
      const url = (env.AMP_URL || "").trim()
      if (url) extra.AMP_URL = url

      let out = ""
      let settled = false
      const done = (r: LLMTestResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(r)
      }
      let child: ReturnType<typeof spawn>
      try {
        // Enhanced PATH + Windows .cmd handling shared with the daemon adapter;
        // the entered key/URL are injected as `extra` (never the saved env).
        child = this._login.spawnAgentCli(bin, ["usage"], extra)
      } catch (e) {
        done({
          success: false,
          error: (e as Error)?.message || "Failed to run amp",
        })
        return
      }
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {}
        done({ success: false, error: "Request timed out" })
      }, 15000)
      child.stdout?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
      child.stderr?.on("data", (c: Buffer) => (out += c.toString("utf-8")))
      child.on("error", (e) =>
        done({ success: false, error: e?.message || "Failed to run amp" }),
      )
      child.on("close", () => {
        if (AMP_LOGGED_OUT.test(out)) {
          done({
            success: false,
            error:
              "Invalid or missing Amp API key — check the key or run `amp login`.",
          })
          return
        }
        // Strip terminal control sequences amp emits, then surface a short
        // snippet of the usage/balance line as confirmation.
        const clean = out
          .replace(/\x1b\[[0-9;=?]*[a-zA-Z]/g, "")
          .replace(/\s+/g, " ")
          .trim()
        done({ success: true, model: "amp", response: clean.slice(0, 80) })
      })
    })
  }

  /** Daemon PID, or null when no daemon runs or the core isn't loaded yet. */
  getDaemonPid(): number | null {
    if (!this._connector) return null
    try {
      const getDaemonPid = this._connector.getDaemonPid as () => number | null
      return getDaemonPid.call(this._connector) || null
    } catch {
      return null
    }
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

  /**
   * Bind an agent to a workspace this device is paired with, by slug or id.
   *
   * Tokens and workspace links are no longer accepted, and neither is creating
   * a workspace from here: pairing is the only way a workspace reaches this
   * launcher, and pairing registers it (endpoint + per-node credential) as it
   * goes.
   *
   * The pairing is what is checked, not the local `networks[]` entry. They are
   * two records kept in step by hand, so a workspace that has dropped this
   * device can sit in `networks[]` long after its pairing is gone — and an
   * agent bound to that one joins nothing: every call it makes carries a
   * credential the workspace has stopped honouring. The entry is still what
   * the core binds by, so it has to be there too; if it is not, the two
   * records have drifted and re-pairing is the fix, not a silent bind.
   */
  async connectWorkspace(agentName: string, input: string): Promise<unknown> {
    const ref = (input || "").trim()
    if (!ref) throw new Error("Missing workspace")

    const paired = listPairings().some(
      (p) => p.workspace_slug === ref || p.workspace_id === ref,
    )
    if (!paired)
      throw new Error(
        `WORKSPACE_NOT_PAIRED: '${ref}' is not a workspace this device is paired with`,
      )

    const known = (
      this.getNetworks() as Array<{ id?: string; slug?: string }>
    ).find((n) => n.slug === ref || n.id === ref)
    if (!known)
      throw new Error(
        `WORKSPACE_NOT_REGISTERED: '${ref}' is paired but has no local entry — re-pair this device`,
      )

    const connectWorkspace = this._connector!.connectWorkspace as (
      name: string,
      slug: string,
    ) => void
    connectWorkspace.call(
      this._connector,
      agentName,
      (known.slug || known.id) as string,
    )
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

  /**
   * Remove a workspace from this device — completely, on both sides.
   *
   * "Removed from this launcher only" stopped being true once pairing became
   * the only supported way in: it dropped the local record while leaving this
   * device's pairing (node.json) and its per-node token alive, so the workspace
   * went on listing the machine, went on heartbeating it, and could still
   * create agents and browse folders on it — with no card left in the UI to
   * unpair from. Removal is therefore always the whole act: every bound agent
   * leaves the workspace roster (POST /v1/leave), this device's node row is
   * deleted (real revocation — the per-node token stops verifying the moment
   * the row is gone), and the local pairing, network entry and agent bindings
   * go with it.
   *
   * `deleteRemote` adds the other, separately-confirmed act on top: DELETE
   * /v1/workspaces/{id} takes the workspace away from **every** member. It
   * replaces the node delete rather than following it — a soft-deleted
   * workspace 404s every node endpoint, and its node rows go with it anyway.
   *
   * A server that actively refuses (any HTTP error) aborts before the local
   * half runs, so the user can retry instead of being left with a pairing no
   * UI can reach. Being unreachable is not a refusal: the local half proceeds
   * and the result carries a warning.
   */
  async removeWorkspace(
    slug: string,
    opts: { deleteRemote?: boolean } = {},
  ): Promise<{
    success: boolean
    unpaired: boolean
    deleted: boolean
    warning: string | null
  }> {
    this._ensureConnector()
    const networks = this.getNetworks() as Array<Record<string, unknown>>
    const network =
      networks.find((n) => n.slug === slug || n.id === slug) || null
    const pairing =
      listPairings().find(
        (p) =>
          p.workspace_slug === slug ||
          p.workspace_id === slug ||
          (!!network &&
            (p.workspace_id === network.id ||
              p.workspace_slug === network.slug)),
      ) || null
    if (!network && !pairing)
      throw new Error("WORKSPACE_NOT_FOUND: no such workspace on this device")

    const workspaceId = (network?.id as string) || pairing?.workspace_id || null
    const workspaceSlug =
      (network?.slug as string) || pairing?.workspace_slug || null
    const endpoint =
      pairing?.endpoint ||
      (network?.endpoint as string) ||
      this.configuredWorkspaceEndpoint() ||
      null
    // The pairing's per-node token is the credential; a legacy manual entry's
    // shared workspace token is the fallback.
    const token = pairing?.token || (network?.token as string) || null

    let warning: string | null = null

    // Retire the agents from the workspace's roster BEFORE revoking the
    // credential that call needs. Best-effort per agent: a member row left
    // behind shows in the workspace as an agent that is simply never online
    // again, which is a cosmetic problem, not a reason to abort a removal. If
    // the removal below IS aborted, the agents rejoin on their next heartbeat.
    if (endpoint && token) {
      const ref = workspaceSlug || workspaceId
      for (const name of this._agentsOnWorkspace([workspaceSlug, workspaceId])) {
        try {
          await fetch(`${endpoint}/v1/leave`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Workspace-Token": token,
            },
            body: JSON.stringify({ agent_name: name, network: ref }),
          })
        } catch {
          // Offline — the member row ages out to offline on its own.
        }
      }
    }

    if (opts.deleteRemote) {
      if (!endpoint || !workspaceId || !token)
        throw new Error(
          "WORKSPACE_NO_CREDENTIALS: this workspace has no saved credential, so it can only be deleted on the web",
        )
      warning = await this._deleteFromWorkspaceApi(
        `${endpoint}/v1/workspaces/${encodeURIComponent(workspaceId)}`,
        token,
      )
    } else if (endpoint && token && pairing?.node_id) {
      // A per-node token stops verifying the moment the node row is deleted,
      // so 401/403 here is not a refusal — it is the workspace having already
      // removed this device (from its own UI, most likely). Aborting on that
      // would leave a dead pairing on this machine that no UI can clear.
      warning = await this._deleteFromWorkspaceApi(
        `${endpoint}/v1/nodes/${encodeURIComponent(pairing.node_id)}`,
        token,
        [401, 403],
      )
    }

    // Local half — nothing below can leave the server ahead of us.
    // A removal is a deliberate act, not a revocation: it settles the alarm
    // rather than raising one. Done even with no pairing left to drop — a
    // device the workspace already removed has only the record to clear.
    if (pairing) clearPairing(pairing.workspace_id)
    if (workspaceId) clearRevocation(workspaceId)
    this._removeNetworkAndUnbind(workspaceSlug, workspaceId)

    if (pairing) {
      // The node heartbeat loop lives in the daemon, so the pairing we just
      // dropped keeps being reported until the daemon is recycled.
      const daemon = this._startDaemon()
      if (!daemon.success) {
        appendDaemonLog(
          `workspace remove: daemon restart failed — ${daemon.message}`,
        )
        warning = warning || daemon.message
      }
    } else {
      this.signalReload()
    }
    this._statusCache = { value: {}, at: 0 }
    this._agentsCache = { value: [], at: 0 }
    return {
      success: true,
      unpaired: !!pairing,
      deleted: !!opts.deleteRemote,
      warning,
    }
  }

  /** Names of this device's agents bound to any of `refs` (slug and/or id). */
  /**
   * Re-file agents under a workspace, skipping any that no longer exist. Uses
   * the connector's own `config.updateAgent` for the same reason
   * `setAgentWorkingDir` does: it is the core's serializer, and rewriting
   * daemon.yaml from here would risk diverging from it.
   */
  private _rebindAgents(names: string[], ref: string | null): void {
    if (!ref || !names.length) return
    const config = (this._connector as { config?: unknown } | null)?.config as
      | { updateAgent?: (name: string, updates: unknown) => unknown }
      | undefined
    if (!config?.updateAgent) return
    const existing = new Set(
      (this.getAgents() as Array<{ name?: string }>).map((a) => a.name),
    )
    for (const name of names) {
      if (!existing.has(name)) continue
      try {
        config.updateAgent(name, { network: ref })
      } catch {
        // One agent that refuses to be re-filed is not a reason to fail a
        // pairing that has already succeeded.
      }
    }
    this._agentsCache = { value: [], at: 0 }
  }

  private _agentsOnWorkspace(refs: Array<string | null>): string[] {
    const keys = new Set(refs.filter((r): r is string => !!r))
    return (this.getAgents() as Array<{ name?: string; network?: string }>)
      .filter((a) => !!a.network && keys.has(a.network))
      .map((a) => a.name)
      .filter((n): n is string => !!n)
  }

  /**
   * Drop the local network entry and unbind every agent that pointed at it.
   *
   * The core's `removeNetwork` finds the entry by slug OR id but clears
   * `agent.network` only where it equals the key it was called with, so a
   * removal by one key leaves agents bound by the other — and since the daemon
   * now resolves credentials from the pairing first, such an agent would keep
   * joining the very workspace we were asked to remove. Both keys are cleared.
   */
  private _removeNetworkAndUnbind(
    slug: string | null,
    id: string | null,
  ): boolean {
    const key = slug || id
    if (!key) return false
    const config = this._connector!.config as {
      removeNetwork: (slug: string) => boolean
      load: () => { agents?: Array<Record<string, unknown>> }
      save: (cfg: unknown) => void
    }
    const removed = config.removeNetwork.call(config, key)
    const keys = new Set([slug, id].filter((k): k is string => !!k))
    try {
      const cfg = config.load()
      let dirty = false
      for (const agent of cfg.agents || []) {
        if (typeof agent.network === "string" && keys.has(agent.network)) {
          delete agent.network
          dirty = true
        }
      }
      if (dirty) config.save(cfg)
    } catch {
      // The entry itself is gone either way; a binding left behind surfaces as
      // "workspace credentials missing" rather than a silent join.
    }
    return removed
  }

  /**
   * One DELETE against the workspace API, classified into the three outcomes a
   * removal cares about: gone (or already gone) → null; server unreachable → a
   * warning, because being offline must not block a local removal; refused →
   * throw, because a server that says no means the row is still there.
   */
  private async _deleteFromWorkspaceApi(
    url: string,
    token: string,
    /** Statuses that mean "already gone", not "refused". 404 always does. */
    gone: readonly number[] = [],
  ): Promise<string | null> {
    let res: Response
    try {
      res = await fetch(url, {
        method: "DELETE",
        headers: { "X-Workspace-Token": token },
      })
    } catch (err) {
      return `server unreachable — ${(err as Error).message}`
    }
    if (res.ok || res.status === 404 || gone.includes(res.status)) return null
    const body = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(body?.message || `HTTP ${res.status}`)
  }

  /**
   * Rename the workspace ON THE SERVER — every member sees the new name. This
   * is the deliberate, opt-in half of the rename dialog; its default only
   * writes a local alias (settings `workspace-aliases:<id>`).
   *
   * Talks to /v1/workspaces/{id} directly rather than through the connector:
   * the core exposes no rename, and going direct keeps this working with the
   * core version already installed instead of gating on a core release.
   */
  async renameWorkspace(
    workspaceId: string,
    name: string,
  ): Promise<{ id: string; slug: string; name: string }> {
    const trimmed = (name || "").trim()
    if (!trimmed) throw new Error("WORKSPACE_NAME_EMPTY: enter a name")
    this._ensureConnector()

    const ws = this._resolveChatWorkspace(workspaceId)
    if (!ws) throw new Error("WORKSPACE_NOT_FOUND: no such workspace locally")
    // The workspace token IS the credential the API checks. A network saved
    // without one (slug-only link) can be shown, but not renamed.
    if (!ws.token)
      throw new Error(
        "WORKSPACE_NO_TOKEN: this workspace has no saved token, so it can only be renamed on the web",
      )
    const client = this._getWorkspaceClient() as unknown as {
      endpoint?: string
    } | null
    const endpoint =
      ws.endpoint || client?.endpoint || this.configuredWorkspaceEndpoint()
    if (!endpoint)
      throw new Error("WORKSPACE_NO_ENDPOINT: unknown API endpoint")

    const res = await fetch(`${endpoint}/v1/workspaces/${ws.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Token": ws.token,
      },
      body: JSON.stringify({ name: trimmed }),
    })
    const body = (await res.json().catch(() => null)) as {
      message?: string
      data?: { name?: string }
    } | null
    if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`)
    const saved = body?.data?.name || trimmed

    // Mirror it into the local network record, or the list would keep showing
    // the old name until something else re-registered the workspace.
    // addNetwork is insert-only, so this is a read-modify-write.
    try {
      const config = this._connector!.config as {
        load: () => { networks?: Array<Record<string, unknown>> }
        save: (cfg: unknown) => void
      }
      const cfg = config.load()
      const entry = (cfg.networks || []).find(
        (n) => n.id === ws.id || n.slug === ws.slug,
      )
      if (entry) {
        entry.name = saved
        config.save(cfg)
        this.signalReload()
      }
    } catch {
      // The server is the source of truth; a stale local label is cosmetic.
    }

    return { id: ws.id, slug: ws.slug, name: saved }
  }

  // ─── Node pairing (connect this device) ───────────────────────
  //
  // The device itself joins the workspace, with or without any agent: the
  // workspace shows it under Connect Agent → Nodes and drives agent install /
  // configure / start on it remotely. All the user provides is the pairing code
  // shown there.

  /** This device's workspace registrations, read from ~/.openagents/node.json. */
  getNodeStatus(): NodeStatus {
    // node.json carries the name we saw at pairing time; the network list is
    // the fresher source when a workspace was later renamed.
    let networks: Array<Record<string, unknown>> = []
    try {
      networks = this.getNetworks() as Array<Record<string, unknown>>
    } catch {}
    const freshName = (p: NodePairing): string | null => {
      const match = networks.find(
        (n) =>
          (p.workspace_slug && n.slug === p.workspace_slug) ||
          (p.workspace_id && n.id === p.workspace_id),
      )
      return match?.name ? String(match.name) : p.workspace_name || null
    }

    const workspaces: NodeConnection[] = listPairings()
      .filter((p) => p.node_id && p.workspace_id && p.token)
      .map((p) => ({
        nodeId: p.node_id!,
        workspaceId: p.workspace_id!,
        workspaceSlug: p.workspace_slug || null,
        workspaceName: freshName(p),
        endpoint: p.endpoint || null,
      }))

    // The singular fields describe the most recent pairing, which is what the
    // pairing flows ("connected to X") and any pre-multi-pairing caller read.
    const first = workspaces[0] || null
    return {
      connected: workspaces.length > 0,
      nodeId: first?.nodeId || null,
      workspaceId: first?.workspaceId || null,
      workspaceSlug: first?.workspaceSlug || null,
      workspaceName: first?.workspaceName || null,
      endpoint: first?.endpoint || null,
      hostname: os.hostname(),
      deviceType: inferDeviceType(),
      workspaces,
      // Read from disk every time rather than kept in memory: a revocation
      // outlives the session that noticed it, and the UI's whole answer for
      // this device ("removed by the workspace", not "erroring") hangs on it.
      revoked: listRevocations().flatMap((r) =>
        r.workspace_id
          ? [
              {
                workspaceId: r.workspace_id,
                workspaceSlug: r.workspace_slug || null,
                workspaceName: r.workspace_name || null,
                agents: r.agents || [],
              },
            ]
          : [],
      ),
    }
  }

  /**
   * Same status, but checked against each workspace first.
   *
   * Unpairing happens on the OTHER side: an owner deletes the device from the
   * workspace's node list and nothing tells this machine — the daemon's
   * heartbeat swallows the error, node.json keeps its record, and the launcher
   * goes on claiming a membership that no longer exists. Asking each workspace
   * who its nodes are is the only way to find out, so it happens here (at most
   * once a minute, since the workspaces page polls) and any pairing its own
   * workspace has forgotten is dropped locally. Every pairing is checked
   * independently: one workspace being down says nothing about the others.
   */
  async refreshNodeStatus(force = false): Promise<NodeStatus> {
    const pairings = listPairings().filter((p) => p.node_id && p.token)
    if (!pairings.length) return this.getNodeStatus()

    const now = Date.now()
    if (!force && now - this._nodeVerifiedAt < 60_000)
      return this.getNodeStatus()
    this._nodeVerifiedAt = now

    await Promise.all(pairings.map((p) => this._verifyPairing(p)))
    return this.getNodeStatus()
  }

  /**
   * Drop one pairing if its workspace no longer lists this node. Never throws:
   * a workspace we cannot reach keeps its pairing untouched.
   */
  private async _verifyPairing(pairing: NodePairing): Promise<void> {
    const endpoint = pairing.endpoint || this.configuredWorkspaceEndpoint()
    const network = pairing.workspace_slug || pairing.workspace_id
    if (!endpoint || !network) return

    try {
      const res = await fetch(
        `${endpoint}/v1/nodes?network=${encodeURIComponent(network)}`,
        { headers: { "X-Workspace-Token": pairing.token! } },
      )
      // Only a successful listing is evidence. A network failure or a rejected
      // token says nothing about whether the node row still exists, and
      // dropping the pairing on those would unpair people whose wifi blinked.
      if (!res.ok) return
      const body = (await res.json().catch(() => null)) as {
        data?: Array<{ nodeId?: string }>
      } | null
      const nodes = body?.data
      if (!Array.isArray(nodes)) return

      if (!nodes.some((n) => String(n.nodeId) === String(pairing.node_id))) {
        // The workspace let this device go, so the device stops claiming it —
        // all of it. Leaving the local network entry and the agent bindings
        // behind left a workspace on screen that this machine is not in, with
        // agents still filed under it: nothing to open, nothing to run, and no
        // honest state to render. What survives is the revocation record: it
        // says why the workspace went, and carries the bindings back if the
        // user joins it again.
        const refs = [
          pairing.workspace_slug || null,
          pairing.workspace_id || null,
        ]
        let bound: string[] = []
        try {
          this._ensureConnector()
          bound = this._agentsOnWorkspace(refs)
        } catch {
          // No core loaded — the bindings live in its config, so they are not
          // ours to read or clear right now. The pairing still goes.
        }
        if (pairing.workspace_id) revokePairing(pairing.workspace_id, bound)
        else clearPairing(pairing.workspace_id)
        try {
          this._removeNetworkAndUnbind(refs[0], refs[1])
          this._agentsCache = { value: [], at: 0 }
        } catch {}
      }
    } catch {
      // Offline — keep what we have.
    }
  }

  /**
   * Redeem a pairing code: register this device as a node, persist the returned
   * workspace token, and bring the daemon up so the node reports in.
   */
  async connectNode(
    code: string,
    opts: { name?: string; deviceType?: string } = {},
  ): Promise<NodeStatus & { warning: string | null }> {
    this._ensureConnector()
    const normalized = normalizePairingCode(code)
    if (normalized.length !== PAIRING_CODE_LENGTH)
      throw new Error(
        "PAIRING_CODE_INVALID_FORMAT: a pairing code is 8 characters (XXXX-XXXX)",
      )

    const redeem = this._connector!.redeemNodePairingCode as
      | ((code: string, info: DeviceInfo) => Promise<Record<string, string>>)
      | undefined
    if (typeof redeem !== "function")
      throw new Error(
        "PAIRING_UNSUPPORTED_CORE: this launcher's agent core cannot connect a device — update the launcher",
      )

    const info = gatherDeviceInfo(app.getVersion())
    if (opts.name?.trim()) info.name = opts.name.trim()
    if (opts.deviceType?.trim()) info.deviceType = opts.deviceType.trim()

    const res = await redeem.call(this._connector, normalized, info)
    const endpoint =
      (this._connector!.workspace as { endpoint?: string } | undefined)
        ?.endpoint ||
      this.configuredWorkspaceEndpoint() ||
      undefined

    // Read before recordPairing settles the revocation: if this workspace once
    // removed the device, these are the agents that were filed under it.
    const orphaned =
      listRevocations().find((r) => r.workspace_id === res.workspaceId)
        ?.agents || []

    // Additive: each workspace issues its own node row for this device, and the
    // daemon heartbeats every pairing, so connecting here does NOT take the
    // device away from the workspaces it already belongs to.
    recordPairing(info.nodeKey, {
      node_id: res.nodeId,
      workspace_id: res.workspaceId,
      workspace_slug: res.workspaceSlug,
      workspace_name: res.workspaceName,
      endpoint,
      token: res.token,
    })

    // Register the workspace locally too, so agents created on this device —
    // here or remotely from the workspace — can bind to it by slug. addNetwork
    // is insert-only, so an already-known workspace also needs its token
    // refreshed: the redeem may well have handed us a rotated one.
    const config = this._connector!.config as Record<string, unknown>
    const addNetwork = config.addNetwork as (opts: unknown) => void
    addNetwork.call(config, {
      id: res.workspaceId,
      slug: res.workspaceSlug,
      name: res.workspaceName,
      endpoint,
      token: res.token,
    })
    this._updateNetworkCredentials(res.workspaceId, res.workspaceSlug, {
      endpoint,
      token: res.token,
    })
    // Joining the same workspace again puts its agents back where they were,
    // so a removal on the workspace's side is not a re-setup on this one.
    this._rebindAgents(orphaned, res.workspaceSlug || res.workspaceId)

    // The node heartbeat — and with it remote agent management — lives in the
    // daemon. A running daemon re-reads node.json every tick, but one left over
    // from a core that predates connect-a-node has no heartbeat loop at all, so
    // recycle it rather than reuse it (_startDaemon stops first, then spawns).
    // Pairing already succeeded at this point: a daemon that refuses to start
    // is a warning, not a failure.
    let warning: string | null = null
    const daemon = this._startDaemon()
    if (!daemon.success) {
      appendDaemonLog(`node pairing: daemon start failed — ${daemon.message}`)
      warning = daemon.message
    }
    this._statusCache = { value: {}, at: 0 }
    this._nodeVerifiedAt = Date.now()
    // A successful (re-)pair supersedes any recorded revocation; recordPairing
    // has already cleared it on disk.

    return { ...this.getNodeStatus(), warning }
  }

  /**
   * Refresh a saved workspace's endpoint/token in place.
   *
   * `config.addNetwork` returns early when the workspace is already known, so
   * re-pairing an existing workspace would otherwise keep an old (possibly
   * rotated) token. Read-modify-write, like renameWorkspace.
   */
  private _updateNetworkCredentials(
    workspaceId: string | undefined,
    slug: string | undefined,
    creds: { endpoint?: string; token?: string },
  ): void {
    if (!creds.token) return
    try {
      const config = this._connector!.config as {
        load: () => { networks?: Array<Record<string, unknown>> }
        save: (cfg: unknown) => void
      }
      const cfg = config.load()
      const entry = (cfg.networks || []).find(
        (n) => n.id === workspaceId || n.slug === slug,
      )
      if (!entry) return
      if (entry.token === creds.token && entry.endpoint === creds.endpoint)
        return
      entry.token = creds.token
      if (creds.endpoint) entry.endpoint = creds.endpoint
      config.save(cfg)
    } catch {
      // The pairing itself already succeeded; a stale local token only means
      // the next agent bind uses the old one, which the user can re-run.
    }
  }

  // ─── Onboarding ───────────────────────────────────────────────
  //
  // The onboarding flow used to drive provisioning from the renderer with three
  // separate IPC calls (createWorkspace → addAgent → connectWorkspace) and
  // swallowed errors. That was the source of the "Agent 'x-1' not found" toast:
  // the picker offered agents the loaded core couldn't run, addAgent threw
  // "not supported", the renderer ate the error, and the follow-up bind failed
  // because the agent was never persisted. The two methods below replace that
  // with a runnable-only picker and a single atomic, verified provisioning step.

  /**
   * Agents to offer in onboarding. Returns ONLY types the loaded core can
   * actually run (intersection with ADAPTER_MAP) and resolves each agent's auth
   * requirements from the bundled registry first (authoritative), then the live
   * catalog. Returns [] when the core hasn't finished installing yet so the
   * renderer keeps polling instead of rendering a wrong empty/again state.
   */
  async getOnboardingAgents(): Promise<OnboardingAgent[]> {
    const supported = this.getSupportedAgentTypes()
    if (supported.length === 0) return []

    let catalog: Array<Record<string, unknown>> = []
    try {
      catalog = (await this.getCatalog(false)) as Array<Record<string, unknown>>
    } catch {
      // Marketplace metadata is optional — we can still build from the bundle.
    }
    const catalogByName = new Map(
      catalog.map((c) => [c.name as string, c] as const),
    )
    const bundled = Array.isArray(BUNDLED_REGISTRY)
      ? (BUNDLED_REGISTRY as Array<Record<string, unknown>>)
      : []
    const bundledByName = new Map(
      bundled.map((b) => [b.name as string, b] as const),
    )

    const result: OnboardingAgent[] = supported
      .filter((type) => CORE_AGENTS.includes(type))
      .map((type) => {
        const cat = catalogByName.get(type)
        const reg = bundledByName.get(type)
        const regEnv = (reg?.env_config as Array<Record<string, unknown>>) || []
        const catEnv = (cat?.env_config as Array<Record<string, unknown>>) || []
        const checkReady = (reg?.check_ready || cat?.check_ready || {}) as {
          login_command?: string
          not_ready_message?: string
          prefer_login?: boolean
        }
        // Launcher-side override: agents that should authenticate with a
        // key/base-URL entered in onboarding rather than an external terminal
        // login. Forces "env" mode and hides the login command, without touching
        // the shared registry. `required` is cleared for dual-login agents so the
        // key stays optional when the user signs in via the CLI instead. See
        // LAUNCHER_AUTH_OVERRIDES / launcherAuthFields.
        const override = launcherAuthFields(type)
        // Hosted-login agents (e.g. Cursor) sign in through their own service —
        // no key fields, drive the CLI's login instead. See HOSTED_LOGIN_AGENTS.
        const hostedLogin = HOSTED_LOGIN_AGENTS[type]
        // Dual-auth agents (Claude) keep their API-key fields AND offer a CLI
        // login. See DUAL_LOGIN_AGENTS.
        const dualLogin = DUAL_LOGIN_AGENTS[type]
        // Key-optional-login agents (e.g. Gemini) keep their OPTIONAL key fields
        // AND their CLI login, so the override fields stay but the login_command
        // is preserved (not dropped like pure key-only override agents).
        const keyOptionalLogin = KEY_OPTIONAL_LOGIN_AGENTS.has(type)
        // Hosted-login agents keep their declared key as an OPTIONAL alternative
        // rather than having it hidden — see _optionalWhenLoginExists. Hermes
        // declares none, so it still comes out login-only.
        const envFields = hostedLogin
          ? (regEnv.length > 0 ? regEnv : catEnv).map((f) => ({
              ...f,
              required: false,
            }))
          : override || (regEnv.length > 0 ? regEnv : catEnv)
        const loginCommand = hostedLogin
          ? hostedLogin.loginCommand
          : dualLogin
            ? dualLogin.loginCommand
            : override
              ? keyOptionalLogin
                ? checkReady.login_command || null
                : null
              : checkReady.login_command || null
        // `prefer_login` keeps an agent on the CLI-login path as PRIMARY even when
        // it also exposes (optional) env fields. Without it, any env field would
        // force "env" mode. Dual-auth agents (Claude) and key-optional-login agents
        // (Gemini) always prefer login — the CLI sign-in is the smoother first-run
        // path, the key offered as an optional backup.
        // Hosted-login agents are here too now that they expose their optional
        // key: the browser sign-in stays PRIMARY, and without this the mere
        // presence of an env field would flip them to "env" mode and demand a key
        // from someone who only ever wanted to sign in.
        const preferLogin =
          (!!checkReady.prefer_login ||
            !!dualLogin ||
            !!hostedLogin ||
            keyOptionalLogin) &&
          !!loginCommand
        const authMode: OnboardingAgent["authMode"] = preferLogin
          ? "login"
          : envFields.length > 0
            ? "env"
            : loginCommand
              ? "login"
              : "none"
        return {
          name: type,
          label: (cat?.label as string) || (reg?.label as string) || type,
          description:
            (cat?.description as string) || (reg?.description as string) || "",
          featured: !!(cat?.featured ?? reg?.featured),
          order: (cat?.order as number) ?? (reg?.order as number) ?? 99,
          installed: !!cat?.installed,
          authMode,
          loginCommand,
          envFields,
          docsUrl:
            (cat?.homepage as string) ||
            (cat?.docs as string) ||
            (reg?.homepage as string) ||
            null,
          notReadyMessage: checkReady.not_ready_message || null,
        }
      })

    result.sort((a, b) => {
      if ((b.featured ? 1 : 0) !== (a.featured ? 1 : 0))
        return (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
      return a.order - b.order
    })
    return result
  }

  /**
   * Atomically provision the onboarding agent. Ordering and verification live
   * here in the main process so failures surface as precise errors instead of
   * a misleading "not found" downstream:
   *   1. validate the type is runnable
   *   2. ensure the agent instance exists in daemon.yaml (idempotent) + verify
   *
   * It no longer creates a workspace: workspaces are created on the web and
   * reach this device by pairing, so onboarding pairs first and then binds the
   * new agent to the paired workspace by slug (see connectWorkspace).
   */
  async provisionFirstAgent(opts: {
    agentType: string
    agentName: string
    path?: string | null
  }): Promise<{ agentName: string; warning: string | null }> {
    this._ensureConnector()
    const type = (opts.agentType || "").trim()
    const name = (opts.agentName || "").trim()
    if (!type) throw new Error("No agent type was selected")
    if (!name) throw new Error("Missing agent name")

    const supported = this.getSupportedAgentTypes()
    if (supported.length > 0 && !supported.includes(type)) {
      throw new Error(
        `Agent type '${type}' isn't supported by the installed runtime. ` +
          `Update the Launcher and try again.`,
      )
    }

    // 1 + 2. Ensure the agent exists, idempotently, then verify it persisted.
    const listAgents = this._connector!.listAgents as () => Array<{
      name: string
    }>
    const agentExists = (): boolean =>
      (listAgents.call(this._connector) || []).some((a) => a.name === name)

    // The chosen working directory becomes the agent's spawn cwd. It must exist
    // before the daemon starts the agent (a missing cwd makes spawn fail). The
    // folder picker returns existing dirs, but a prefilled default may not exist
    // yet, so create it here. Only set on first registration — re-calls (e.g.
    // the workspace step reusing this method) keep the path chosen earlier.
    const agentPath = (opts.path || "").trim()
    if (agentPath) {
      try {
        fs.mkdirSync(agentPath, { recursive: true })
      } catch (e) {
        throw new Error(
          `Could not create the agent folder '${agentPath}': ${
            (e as Error).message
          }`,
        )
      }
    }

    if (!agentExists()) {
      const addAgent = this._connector!.addAgent as (o: unknown) => void
      addAgent.call(this._connector, {
        name,
        type,
        role: "worker",
        ...(agentPath ? { path: agentPath } : {}),
      })
      this._agentsCache = { value: [], at: 0 }
    }
    if (!agentExists()) {
      throw new Error(
        `Failed to register agent '${name}' — the runtime did not persist it.`,
      )
    }

    this.signalReload()
    return { agentName: name, warning: null }
  }

  async checkAgentType(agentType: string): Promise<unknown> {
    return this._install.checkAgentType(agentType)
  }

  async installAgentType(agentType: string): Promise<unknown> {
    return this._install.installAgentType(agentType)
  }

  async installAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    return this._install.installAgentTypeStreaming(agentType, onData)
  }

  async uninstallAgentType(agentType: string): Promise<unknown> {
    return this._install.uninstallAgentType(agentType)
  }

  async uninstallAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    return this._install.uninstallAgentTypeStreaming(agentType, onData)
  }

  getInstalledVersion(agentType: string): string | null {
    return this._install.getInstalledVersion(agentType)
  }

  private _getRegistryEntry(agentType: string): Record<string, unknown> | null {
    return this._install.getRegistryEntry(agentType)
  }

  async updateAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    return this._install.updateAgentTypeStreaming(agentType, onData)
  }

  getInstalledHistory(): Record<string, InstalledAgentRecord> {
    return this._install.getInstalledHistory()
  }

  listInstalledAgents(): InstalledAgentRecord[] {
    return this._install.listInstalledAgents()
  }

  async rollbackAgentType(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    return this._install.rollbackAgentType(agentType, onData)
  }

  async checkAgentUpdates(
    options: { force?: boolean } = {},
  ): Promise<
    Array<{ name: string; current: string | null; latest: string | null }>
  > {
    return this._install.checkAgentUpdates(options)
  }

  async getAgentChangelog(agentType: string): Promise<{
    versions: Array<{ version: string; date?: string }>
    homepage?: string
    latest?: string | null
    error?: string
  }> {
    return this._install.getAgentChangelog(agentType)
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
    return clearDaemonLogsInRange(DAEMON_LOG_FILE, start, end)
  }

  healthCheck(type: string): unknown {
    // Hosted-login agents (e.g. Cursor, Hermes): answer from the CLI's own
    // sign-in state (cached probe) rather than the core's check_ready. The
    // Configure dialog gets a guaranteed-fresh read via refreshHostedLogin().
    if (HOSTED_LOGIN_AGENTS[type]) return this._health.hostedLoginHealth(type)
    const healthCheck = this._connector!.healthCheck as (
      type: string,
    ) => unknown
    const core = healthCheck.call(this._connector, type)
    // Dual-auth agents (Claude): fold the CLI sign-in state into the core
    // (API-key) health so onboarding/Configure can show "✓ logged in" and treat
    // a subscription login (no key) as ready. Adds an explicit `logged_in` flag
    // the renderer reads to distinguish "signed in via CLI" from "has API key".
    if (DUAL_LOGIN_AGENTS[type]) return this._health.dualLoginHealth(type, core)
    return core
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
    return readDaemonState(this._getLiveDaemonPid())
  }

  private _getLiveDaemonPid(): number | null {
    return getLiveDaemonPid(this._connector, () => {
      this._statusCache = { value: {}, at: 0 }
    })
  }

  private _startDaemon(): { success: boolean; pid?: number; message: string } {
    return startDaemon(this._connector)
  }

  // ─────────────────────────────────────────────────────────
  // Stage 3.1 — Workspace chat (send / get / poll messages)
  // Mirrors the legacy launcher's pattern: chat lives on AgentManager
  // and is invoked from the main process via IPC.
  // ─────────────────────────────────────────────────────────

  private _getWorkspaceClient(): WorkspaceChatClient | null {
    if (!this._connector) return null
    const ws = this._connector.workspace as Record<string, unknown> | undefined
    if (!ws) return null
    return ws as unknown as WorkspaceChatClient
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
    return this._chat.sendMessage(input)
  }

  async getChatMessages(
    workspaceId: string,
    channelName?: string,
    limit = 100,
  ): Promise<ChatMessage[]> {
    return this._chat.getMessages(workspaceId, channelName, limit)
  }

  async getWorkspaceMessages(
    workspaceId: string,
    limit = 200,
  ): Promise<ChatMessage[]> {
    return this._chat.getWorkspaceMessages(workspaceId, limit)
  }

  async listChatParticipants(
    workspaceId: string,
  ): Promise<Array<{ agentName: string; role: string; status: string }>> {
    return this._chat.listParticipants(workspaceId)
  }

  startChatPolling(
    workspaceId: string,
    channelName?: string,
  ): { key: string } | null {
    return this._chat.startPolling(workspaceId, channelName)
  }

  stopChatPolling(workspaceId: string, channelName?: string): void {
    this._chat.stopPolling(workspaceId, channelName)
  }

  setChatForeground(foreground: boolean): void {
    this._chat.setForeground(foreground)
  }

  stopAllChatPolling(): void {
    this._chat.stopAllPolling()
  }

  listChatSessions(workspaceId?: string): ChatSessionMeta[] {
    return this._chat.listSessions(workspaceId)
  }

  loadChatSession(
    workspaceId: string,
    channelName: string,
  ): ChatSessionMeta | null {
    return this._chat.loadSession(workspaceId, channelName)
  }

  deleteChatSession(workspaceId: string, channelName: string): boolean {
    return this._chat.deleteSession(workspaceId, channelName)
  }

  clearChatSessions(workspaceId?: string): number {
    return this._chat.clearSessions(workspaceId)
  }

  createChatSession(workspaceId: string): ChatSessionMeta {
    return this._chat.createSession(workspaceId)
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
    return this._chat.uploadFile(workspaceId, filename, contentBase64, opts)
  }

  async listChatFiles(
    workspaceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown> {
    return this._chat.listFiles(workspaceId, opts)
  }

  async readChatFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; contentBase64?: string; error?: string }> {
    return this._chat.readFile(workspaceId, fileId)
  }

  async deleteChatFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return this._chat.deleteFile(workspaceId, fileId)
  }
}
