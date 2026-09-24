import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { CatalogEntry, EnvField } from "@renderer/types"
import type { LocalConfiguration } from "./local-setup-api"
import { LocalConfigurationFields } from "./local-agent-setup"

type Api = Record<string, ReturnType<typeof vi.fn>>

const FIELDS: Record<string, EnvField[]> = {
  opencode: [
    { name: "LLM_API_KEY", required: true, password: true },
    { name: "LLM_BASE_URL" },
  ] as EnvField[],
  codebuddy: [
    { name: "CODEBUDDY_API_KEY", required: true, password: true },
    { name: "CODEBUDDY_BASE_URL" },
  ] as EnvField[],
}

let api: Api

const captured: { loginEvent?: (ev: { agentType: string; phase: string }) => void } = {}
let rendered: { onChange: ReturnType<typeof vi.fn<(config: LocalConfiguration | null) => void>> }

function setup(type: string, saved: Record<string, string> = {}, entry: Partial<CatalogEntry> = { name: type }) {
  api = {
    getEnvFields: vi.fn().mockResolvedValue(FIELDS[type]),
    getAgentEnv: vi.fn().mockResolvedValue(saved),
    getAgentInstanceEnv: vi.fn().mockResolvedValue({}),
    healthCheck: vi.fn().mockResolvedValue({ installed: true, ready: false }),
    refreshLogin: vi.fn().mockResolvedValue({ installed: true, ready: false }),
    testLLM: vi.fn().mockResolvedValue({ success: true }),
    onCliLoginEvent: vi.fn((cb) => { captured.loginEvent = cb; return () => {} }),
    clearLoginKey: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue([]),
  }
  ;(window as unknown as { api: Api }).api = api
  const onChange = vi.fn<(config: LocalConfiguration | null) => void>()
  render(
    <LocalConfigurationFields
      type={type}
      catalog={[entry as CatalogEntry]}
      onChange={onChange}
      onChanged={() => {}}
      onBusy={() => {}}
    />,
  )
  rendered = { onChange }
  return { onChange }
}

describe("LocalConfigurationFields — API key form", () => {
  beforeEach(() => vi.clearAllMocks())

  it("offers to import an existing key and to test the connection", async () => {
    setup("opencode")
    expect(await screen.findByText(/Already set up a key in another tool/)).toBeInTheDocument()
    expect(screen.getByText("Verify API settings")).toBeInTheDocument()
    expect(screen.getByText(/Check the key, endpoint, and model/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument()
  })

  it("explains how an unprobeable agent is verified instead of offering a test", async () => {
    setup("codebuddy")
    expect(await screen.findByText(/isn.t tested here/)).toBeInTheDocument()
    expect(screen.getByText(/signs in against Tencent/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Test connection" })).not.toBeInTheDocument()
  })

  it("blocks saving a model-gateway URL into a vendor-platform agent", async () => {
    const { onChange } = setup("codebuddy", { CODEBUDDY_API_KEY: "k", CODEBUDDY_BASE_URL: "https://api.openai.com/v1" })
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]?.blocked).toMatch(/model API endpoint/))
  })
})

describe("LocalConfigurationFields — sign-in confirmed after switching tabs", () => {
  it("keeps the key tab and the key typed while the sign-in was being checked", async () => {
    let fire: (ev: { agentType: string; phase: string }) => void = () => {}
    let finishRefresh: (health: unknown) => void = () => {}
    setup("opencode", {}, { name: "opencode", installed: true, check_ready: { login_command: "opencode auth login" } })
    await screen.findByTestId("auth-tab-cli")
    const onChange = rendered.onChange
    fire = captured.loginEvent!
    api.refreshLogin.mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve }))

    const user = userEvent.setup()
    fire({ agentType: "opencode", phase: "success" })
    await user.click(screen.getByTestId("auth-tab-key"))
    await user.type(document.querySelector<HTMLInputElement>("[id$='-LLM_API_KEY']")!, "sk-typed")
    finishRefresh({ installed: true, ready: true })

    await waitFor(() => expect(api.getAgentEnv).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0]
      expect(last?.authTab).toBe("key")
      expect(last?.values.LLM_API_KEY).toBe("sk-typed")
    })
  })
})

describe("LocalConfigurationFields — signing in instead of a key", () => {
  const CODEX: EnvField[] = [
    { name: "OPENAI_API_KEY", password: true },
    { name: "OPENAI_BASE_URL" },
    { name: "CODEX_MODEL" },
  ] as EnvField[]
  const TYPE_ENV = { OPENAI_API_KEY: "sk-old", OPENAI_BASE_URL: "https://relay.example/v1", CODEX_MODEL: "openai-gpt-oss-20b" }

  function open(name: string | undefined, typeEnv: Record<string, string>, instance: Record<string, string> = {}) {
    api = {
      getEnvFields: vi.fn().mockResolvedValue(CODEX),
      getAgentEnv: vi.fn().mockResolvedValue(typeEnv),
      getAgentInstanceEnv: vi.fn().mockResolvedValue(instance),
      refreshLogin: vi.fn().mockResolvedValue({ installed: true, ready: true, logged_in: true }),
      healthCheck: vi.fn().mockResolvedValue({ installed: true, ready: true }),
      onCliLoginEvent: vi.fn(() => () => {}),
      clearLoginKey: vi.fn().mockResolvedValue(undefined),
      listModels: vi.fn().mockResolvedValue([]),
      testLLM: vi.fn(),
    }
    ;(window as unknown as { api: Api }).api = api
    const onChange = vi.fn<(config: LocalConfiguration | null) => void>()
    render(<LocalConfigurationFields type="codex" name={name} onChange={onChange} onChanged={() => {}} onBusy={() => {}}
      catalog={[{ name: "codex", installed: true, check_ready: { login_command: "codex login" } } as CatalogEntry]} />)
    return onChange
  }
  const last = (onChange: ReturnType<typeof open>) => onChange.mock.calls.at(-1)?.[0]

  it("a new agent on the sign-in tab does not take the model saved with the type's key", async () => {
    const onChange = open(undefined, { CODEX_MODEL: "openai-gpt-oss-20b" })
    await screen.findByTestId("auth-tab-cli")
    await waitFor(() => expect(last(onChange)?.authTab).toBe("cli"))
    expect(last(onChange)?.values.CODEX_MODEL).toBe("")
  })

  it("an existing agent without the marker, saved untouched, is saved as before", async () => {
    const onChange = open("codex", { CODEX_MODEL: "openai-gpt-oss-20b" })
    await screen.findByTestId("auth-tab-cli")
    await waitFor(() => expect(last(onChange)).toBeTruthy())
    expect(last(onChange)?.authTab).toBeUndefined()
    expect(last(onChange)?.values.CODEX_MODEL).toBe("openai-gpt-oss-20b")
  })

  it("picking the sign-in tab on that agent is the choice, and drops the type's model", async () => {
    const onChange = open("codex", TYPE_ENV)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId("auth-tab-cli"))
    await waitFor(() => expect(last(onChange)?.authTab).toBe("cli"))
    expect(last(onChange)?.values.CODEX_MODEL).toBe("")

    await user.click(screen.getByTestId("auth-tab-key"))
    await waitFor(() => expect(last(onChange)?.authTab).toBe("key"))
    expect(last(onChange)?.values.CODEX_MODEL).toBe("openai-gpt-oss-20b")
  })

  it("a signed-in agent keeps its own model", async () => {
    const onChange = open("codex", TYPE_ENV, { OPENAGENTS_AUTH_MODE: "cli_login", CODEX_MODEL: "gpt-5.5" })
    await screen.findByTestId("auth-tab-cli")
    await waitFor(() => expect(last(onChange)?.authTab).toBe("cli"))
    expect(last(onChange)?.values.CODEX_MODEL).toBe("gpt-5.5")
  })
})
