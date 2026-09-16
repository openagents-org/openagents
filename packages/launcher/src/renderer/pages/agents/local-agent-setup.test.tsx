import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

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

function setup(type: string, saved: Record<string, string> = {}) {
  api = {
    getEnvFields: vi.fn().mockResolvedValue(FIELDS[type]),
    getAgentEnv: vi.fn().mockResolvedValue(saved),
    getAgentInstanceEnv: vi.fn().mockResolvedValue({}),
    healthCheck: vi.fn().mockResolvedValue({ installed: true, ready: false }),
    refreshLogin: vi.fn().mockResolvedValue({ installed: true, ready: false }),
    testLLM: vi.fn().mockResolvedValue({ success: true }),
    onCliLoginEvent: vi.fn().mockReturnValue(() => {}),
    listModels: vi.fn().mockResolvedValue([]),
  }
  ;(window as unknown as { api: Api }).api = api
  const onChange = vi.fn<(config: LocalConfiguration | null) => void>()
  render(
    <LocalConfigurationFields
      type={type}
      catalog={[{ name: type } as CatalogEntry]}
      onChange={onChange}
      onChanged={() => {}}
      onBusy={() => {}}
    />,
  )
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
