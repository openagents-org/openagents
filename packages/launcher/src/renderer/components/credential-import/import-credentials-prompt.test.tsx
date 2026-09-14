import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { ImportCandidate } from "../../../shared/credential-import"
import { ImportCredentialsPrompt } from "./import-credentials-prompt"

type Api = Record<string, ReturnType<typeof vi.fn>>

const FOUND: ImportCandidate = {
  id: "c1",
  protocol: "anthropic",
  vendor: "relay",
  baseUrl: "https://relay.example.com",
  model: "claude-opus-5",
  keyHint: "sk-relay-…0001",
  sources: [{ kind: "cli", ref: "claude" }],
}

const FIELDS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"]

let api: Api

beforeEach(() => {
  api = {
    scanCredentialImports: vi.fn().mockResolvedValue([FOUND]),
    parseCredentialImport: vi.fn().mockResolvedValue([]),
    resolveCredentialImport: vi.fn().mockResolvedValue({
      ANTHROPIC_API_KEY: "sk-relay-000000000001",
      ANTHROPIC_BASE_URL: "https://relay.example.com",
      ANTHROPIC_MODEL: "claude-opus-5",
      CLAUDE_CODE_OAUTH_TOKEN: "",
    }),
  }
  ;(window as unknown as { api: Api }).api = api
})

describe("ImportCredentialsPrompt", () => {
  it("fills in the picked key, and only the fields the form has", async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    render(<ImportCredentialsPrompt agentType="claude" fieldNames={FIELDS} onImport={onImport} />)

    await user.click(screen.getByRole("button", { name: "Import" }))
    // A single offer is picked already.
    expect(await screen.findByRole("radio")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText(/Claude Code config/)).toBeInTheDocument()
    // With keys to pick from, pasting stays folded away.
    expect(screen.queryByLabelText("Paste a configuration")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Fill in" }))
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith({
        ANTHROPIC_API_KEY: "sk-relay-000000000001",
        ANTHROPIC_BASE_URL: "https://relay.example.com",
        ANTHROPIC_MODEL: "claude-opus-5",
      }),
    )
    expect(api.resolveCredentialImport).toHaveBeenCalledWith("claude", "c1")
  })

  it("finds a key in pasted configuration when the scan found none", async () => {
    const user = userEvent.setup()
    api.scanCredentialImports.mockResolvedValue([])
    api.parseCredentialImport.mockResolvedValue([
      { ...FOUND, id: "p1", sources: [{ kind: "paste", ref: "" }] },
    ])
    render(<ImportCredentialsPrompt agentType="claude" fieldNames={FIELDS} onImport={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Import" }))
    expect(await screen.findByText(/No key this agent can use was found on this computer/)).toBeInTheDocument()

    // Nothing to pick from, so the paste box is already open.
    const box = await screen.findByLabelText("Paste a configuration")
    await user.click(box)
    await user.paste("export ANTHROPIC_AUTH_TOKEN=sk-relay-000000000001")
    await user.click(screen.getByRole("button", { name: "Recognize" }))

    expect(await screen.findByRole("radio")).toHaveAttribute("aria-checked", "true")
    // Recognised and folded away, so the key no longer sits on screen.
    expect(screen.queryByLabelText("Paste a configuration")).toBeNull()
  })

  it("offers nothing for an agent only its vendor can issue a key for", () => {
    const { container } = render(
      <ImportCredentialsPrompt agentType="cursor" fieldNames={["CURSOR_API_KEY"]} onImport={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
