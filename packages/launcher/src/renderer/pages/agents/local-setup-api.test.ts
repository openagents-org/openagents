import { describe, it, expect, vi } from "vitest"
import { createLocalSetupApi, type LocalConfiguration } from "./local-setup-api"

function fixture() {
  const api = {
    getCatalog: vi.fn().mockResolvedValue([{ name: "claude", installed: true }]),
    getSupportedAgentTypes: vi.fn().mockResolvedValue(["claude"]),
    listAgents: vi.fn().mockResolvedValue([]),
    installAgentTypeStreaming: vi.fn().mockResolvedValue({ success: true }),
    listPaths: vi.fn().mockResolvedValue({ home: "/home/review" }),
    addAgent: vi.fn().mockResolvedValue({ success: true }),
    saveAgentInstanceEnv: vi.fn().mockResolvedValue({ success: true }),
    setAgentWorkingDir: vi.fn().mockResolvedValue({ success: true }),
  }
  const config: LocalConfiguration = { type: "claude", fields: [], values: { ANTHROPIC_API_KEY: "test-key" }, initial: {} }
  const backend = createLocalSetupApi(api as unknown as Window["api"], () => config)
  return { api, config, backend }
}

describe("shared agent setup local backend", () => {
  it("reuses installed software and creates a configured local agent without an account", async () => {
    const { api, backend } = fixture()
    await backend.enqueueNodeCommand("this-computer", "create_agent", { name: "helper", type: "claude" })
    expect(api.installAgentTypeStreaming).not.toHaveBeenCalled()
    expect(api.addAgent).toHaveBeenCalledExactlyOnceWith({ name: "helper", type: "claude", path: "/home/review", env: { ANTHROPIC_API_KEY: "test-key" } })
  })
  it("does not reinstall or overwrite an existing agent", async () => {
    const { api, backend } = fixture()
    api.listAgents.mockResolvedValue([{ name: "helper", type: "claude" }])
    await expect(backend.enqueueNodeCommand("this-computer", "create_agent", { name: "helper", type: "claude" })).rejects.toThrow("already exists")
    expect(api.addAgent).not.toHaveBeenCalled()
    expect(api.installAgentTypeStreaming).not.toHaveBeenCalled()
  })
  it("stops before creation if installation fails, and allows a retry", async () => {
    const { api, backend } = fixture()
    api.getCatalog.mockResolvedValue([{ name: "claude", installed: false }])
    api.installAgentTypeStreaming.mockResolvedValueOnce({ success: false, error: "Installation failed" })
    const args = { name: "helper", type: "claude" }
    await expect(backend.enqueueNodeCommand("this-computer", "create_agent", args)).rejects.toThrow("Installation failed")
    expect(api.addAgent).not.toHaveBeenCalled()
    await backend.enqueueNodeCommand("this-computer", "create_agent", args)
    expect(api.addAgent).toHaveBeenCalledTimes(1)
  })
  it("keeps saved credentials when changing the model and folder", async () => {
    const { api, config, backend } = fixture()
    config.name = "helper"
    config.initial = { ANTHROPIC_API_KEY: "saved-secret", ANTHROPIC_MODEL: "old" }
    config.values = { ...config.initial, ANTHROPIC_MODEL: "new" }
    api.listAgents.mockResolvedValue([{ name: "helper", type: "claude", path: "/old" }])
    await backend.enqueueNodeCommand("this-computer", "configure_agent", { name: "helper", type: "claude", workingDir: "/project" })
    expect(api.saveAgentInstanceEnv).toHaveBeenCalledExactlyOnceWith("helper", { ANTHROPIC_MODEL: "new" })
    expect(api.setAgentWorkingDir).toHaveBeenCalledExactlyOnceWith("helper", "/project")
    expect(api.addAgent).not.toHaveBeenCalled()
  })
  it("makes no writes when existing settings are saved unchanged", async () => {
    const { api, config, backend } = fixture()
    config.name = "helper"; config.initial = { ...config.values }
    api.listAgents.mockResolvedValue([{ name: "helper", type: "claude", path: "/project" }])
    await backend.enqueueNodeCommand("this-computer", "configure_agent", { name: "helper", type: "claude", workingDir: "/project" })
    expect(api.saveAgentInstanceEnv).not.toHaveBeenCalled()
    expect(api.setAgentWorkingDir).not.toHaveBeenCalled()
  })
  it("refuses values the form has blocked, before touching the agent", async () => {
    const { api, config, backend } = fixture()
    config.blocked = "That looks like a model API endpoint"
    await expect(backend.enqueueNodeCommand("this-computer", "create_agent", { name: "helper", type: "claude" })).rejects.toThrow("model API endpoint")
    expect(api.listAgents).not.toHaveBeenCalled()
    expect(api.addAgent).not.toHaveBeenCalled()
  })
  it("rejects stale configuration for another type or instance", async () => {
    const { api, backend } = fixture()
    await expect(backend.enqueueNodeCommand("this-computer", "configure_agent", { name: "another", type: "codex" })).rejects.toThrow("configuration")
    expect(api.listAgents).not.toHaveBeenCalled()
  })
  it("prevents concurrent duplicate submissions", async () => {
    const { api, backend } = fixture()
    let release!: () => void
    api.addAgent.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const first = backend.enqueueNodeCommand("this-computer", "create_agent", { name: "helper", type: "claude" })
    await vi.waitFor(() => expect(api.addAgent).toHaveBeenCalledTimes(1))
    await expect(backend.enqueueNodeCommand("this-computer", "create_agent", { name: "helper", type: "claude" })).rejects.toThrow("already being saved")
    release(); await first
  })
})

describe("local backend: signing in instead of a key", () => {
  const fields = [
    { name: "OPENAI_API_KEY", password: true },
    { name: "OPENAI_BASE_URL" },
    { name: "CODEX_MODEL" },
  ] as LocalConfiguration["fields"]
  const saved = { OPENAI_API_KEY: "sk-old", OPENAI_BASE_URL: "https://relay.example/v1", CODEX_MODEL: "gpt-5.5" }

  it("creates a signed-in agent with the marker and none of the type's saved key", async () => {
    const { api, config, backend } = fixture()
    Object.assign(config, { type: "codex", fields, values: saved, initial: saved, authTab: "cli" })
    api.getCatalog.mockResolvedValue([{ name: "codex", installed: true }])
    api.getSupportedAgentTypes.mockResolvedValue(["codex"])
    await backend.enqueueNodeCommand("this-computer", "create_agent", { name: "codex", type: "codex" })
    expect(api.addAgent).toHaveBeenCalledExactlyOnceWith({ name: "codex", type: "codex", path: "/home/review",
      env: { CODEX_MODEL: "gpt-5.5", OPENAGENTS_AUTH_MODE: "cli_login" } })
  })

  it("switching an agent to sign-in clears its own key; switching back clears the marker", async () => {
    const { api, config, backend } = fixture()
    Object.assign(config, { type: "codex", name: "codex", fields, values: saved, initial: saved, authTab: "cli" })
    api.listAgents.mockResolvedValue([{ name: "codex", type: "codex", path: "/home/review" }])
    await backend.enqueueNodeCommand("this-computer", "configure_agent", { name: "codex", type: "codex" })
    expect(api.saveAgentInstanceEnv).toHaveBeenLastCalledWith("codex",
      { OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENAGENTS_AUTH_MODE: "cli_login" })

    const signedIn = { CODEX_MODEL: "gpt-5.5", OPENAGENTS_AUTH_MODE: "cli_login" }
    Object.assign(config, { values: { ...signedIn, OPENAI_API_KEY: "sk-new" }, initial: signedIn, authTab: "key" })
    await backend.enqueueNodeCommand("this-computer", "configure_agent", { name: "codex", type: "codex" })
    expect(api.saveAgentInstanceEnv).toHaveBeenLastCalledWith("codex", { OPENAI_API_KEY: "sk-new", OPENAGENTS_AUTH_MODE: "" })
  })
})
