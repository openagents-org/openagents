import { installErrorMessage, throwIfInstallFailed } from "@renderer/utils/installErrors"
import type { AgentSetupApi } from "@/components/agents/agent-setup"
import type { EnvField } from "@renderer/types"
import { envForAuthTab } from "@renderer/lib/agent-auth"

export interface LocalConfiguration {
  type: string
  name?: string
  fields: EnvField[]
  values: Record<string, string>
  initial: Record<string, string>
  /** Why these values cannot be saved (already translated), e.g. a model-gateway URL in a vendor-platform agent. */
  blocked?: string
  /** The auth tab of an agent offering both a CLI sign-in and a key; absent when it offers one. */
  authTab?: "cli" | "key"
}

/** Reports an agent whose create waited on its runtime install, after the form has already closed. */
export interface DeferredCreateEvents {
  onCreated: (name: string) => void
  onFailed: (name: string, message: string) => void
}

// Module-level, not per form: a create that waits on an install outlives the
// form that started it, and reopening the form must not start the same one twice.
const pending = new Set<string>()

/** The local backend stays on the existing launcher IPC surface; no account or network service is needed. */
export function createLocalSetupApi(api: Window["api"], configuration: () => LocalConfiguration | null, deferred?: DeferredCreateEvents): AgentSetupApi {
  return {
    async getAgentCatalogDetail(type) {
      const entry = (await api.getCatalog()).find((item) => item.name === type)
      if (!entry) throw new Error("Agent is no longer available")
      return { name: entry.name, featured: entry.featured, check_ready: entry.check_ready, label: entry.label || entry.name, description: entry.description || "", tags: entry.tags || [],
        builtin: !!entry.builtin, homepage: entry.homepage || "", install_command: "", models: [] }
    },
    async enqueueNodeCommand(_nodeId, action, args) {
      if (action === "detect_runtimes") { await api.getCatalog(true); return {} }
      if (action !== "create_agent" && action !== "configure_agent") throw new Error("Unsupported local action")
      const name = String(args.name || "")
      const type = String(args.type || "")
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Use letters, numbers, dashes, or underscores for the agent name.")
      const config = configuration()
      if (!config || config.type !== type || (action === "configure_agent" && config.name !== name)) throw new Error("Wait for the agent configuration to load.")
      if (config.blocked) throw new Error(config.blocked)
      const missing = config.fields.find((field) => field.required && !(config.values[field.name] || field.default || "").trim())
      if (missing) throw new Error(`${missing.description || missing.name} is required.`)
      if (pending.has(name)) throw new Error("This agent is already being saved.")
      pending.add(name)
      const values = config.authTab ? envForAuthTab(config.authTab, config.fields, config.values) : config.values
      let detached = false
      try {
        const agents = await api.listAgents()
        const existing = agents.find((agent) => agent.name === name)
        if (action === "create_agent") {
          if (existing) throw new Error(`An agent named ${name} already exists. Open it to make changes.`)
          const catalog = await api.getCatalog()
          const entry = catalog.find((item) => item.name === type)
          if (!entry || entry.comingSoon || !(await api.getSupportedAgentTypes()).includes(type)) throw new Error("This agent cannot run on this computer.")
          const add = async (): Promise<void> => {
            const home = (await api.listPaths()).home
            await api.addAgent({ name, type, path: String(args.workingDir || home), env: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")) })
          }
          if (!entry.installed && deferred) {
            // An install can take minutes. It runs in main and the global install
            // banner tracks it, so the form need not hold the user hostage: the
            // agent is added once the runtime lands, wherever they are by then.
            detached = true
            void api.installAgentTypeStreaming(type).then(throwIfInstallFailed).then(add)
              .then(() => deferred.onCreated(name), (err: unknown) => deferred.onFailed(name, installErrorMessage(err)))
              .finally(() => pending.delete(name))
            return { deferred: true }
          }
          if (!entry.installed) throwIfInstallFailed(await api.installAgentTypeStreaming(type))
          await add()
        } else {
          if (!existing || existing.type !== type) throw new Error("This agent has changed. Reopen its settings.")
          const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => (config.initial[key] ?? "") !== value))
          if (Object.keys(changes).length) await api.saveAgentInstanceEnv(name, changes)
          if (args.workingDir && args.workingDir !== existing.path) await api.setAgentWorkingDir(name, String(args.workingDir))
        }
        return {}
      } finally { if (!detached) pending.delete(name) }
    },
    async listNodeCommands() { return [] },
    async listModelAccess() { return [] },
    async probeModelAccess() { throw new Error("Select credentials on this computer.") },
  }
}
