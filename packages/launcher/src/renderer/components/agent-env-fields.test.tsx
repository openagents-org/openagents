import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AgentEnvFields } from "./agent-env-fields"

// cmdk measures its list on mount; jsdom ships no ResizeObserver.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

describe("AgentEnvFields — the model list follows what the form shows", () => {
  it("lists models from a base URL the user left at its default", async () => {
    // The bug: an untouched KIMI_BASE_URL displayed Moonshot's endpoint but
    // never reached the list request, which then asked api.openai.com.
    const listModels = vi.fn().mockResolvedValue({ models: [], source: "none" })
    ;(window as unknown as { api: unknown }).api = { listModels }
    render(
      <AgentEnvFields
        agentType="kimi"
        fields={[
          { name: "KIMI_API_KEY", description: "Key", password: true },
          {
            name: "KIMI_BASE_URL",
            description: "Base URL",
            default: "https://api.moonshot.ai/v1",
          },
          { name: "KIMI_MODEL", description: "Model" },
        ]}
        values={{ KIMI_API_KEY: "sk-kimi" }}
        onChange={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: /model/i }))
    await waitFor(() => expect(listModels).toHaveBeenCalled())
    expect(listModels.mock.calls[0][1]).toMatchObject({
      KIMI_API_KEY: "sk-kimi",
      KIMI_BASE_URL: "https://api.moonshot.ai/v1",
    })
  })

  it("lets a value the user typed win over the default", async () => {
    const listModels = vi.fn().mockResolvedValue({ models: [], source: "none" })
    ;(window as unknown as { api: unknown }).api = { listModels }
    render(
      <AgentEnvFields
        agentType="kimi"
        fields={[
          { name: "KIMI_API_KEY", description: "Key", password: true },
          {
            name: "KIMI_BASE_URL",
            description: "Base URL",
            default: "https://api.moonshot.ai/v1",
          },
          { name: "KIMI_MODEL", description: "Model" },
        ]}
        values={{ KIMI_API_KEY: "sk-kimi", KIMI_BASE_URL: "https://relay.example.com/v1" }}
        onChange={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: /model/i }))
    await waitFor(() => expect(listModels).toHaveBeenCalled())
    expect(listModels.mock.calls[0][1].KIMI_BASE_URL).toBe(
      "https://relay.example.com/v1",
    )
  })
})
