import React from "react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import Install from "./index"
import { useInstallStore } from "../../store/install"
import { useAgentsStore } from "../../store/agents"
import type { CatalogEntry } from "../../types"

vi.mock("../../lib/analytics", () => ({ capture: vi.fn() }))

type Api = Record<string, ReturnType<typeof vi.fn>>

const CATALOG: CatalogEntry[] = [
  {
    name: "codex",
    label: "OpenAI Codex CLI",
    description: "OpenAI's coding agent in your terminal.",
    tags: ["coding", "openai", "cli"],
    featured: true,
    installed: true,
    install: { binary: "codex", requires: ["nodejs"], macos: "npm i -g @openai/codex" },
  },
  {
    name: "claude",
    label: "Claude Code CLI",
    description: "Anthropic's official terminal agent.",
    tags: ["coding", "cli"],
    installed: true,
    install: { binary: "claude", requires: ["nodejs"] },
    check_ready: { login_command: "claude login" },
  },
  {
    name: "openclaw",
    label: "OpenClaw",
    description: "Open-source orchestration layer.",
    tags: ["coding", "open-source"],
    installed: false,
    install: { binary: "openclaw", requires: ["nodejs"] },
  },
]

function installApi(overrides: Partial<Api> = {}): Api {
  const api: Api = {
    getCatalog: vi.fn().mockResolvedValue(CATALOG),
    getInstalledAgents: vi
      .fn()
      .mockResolvedValue([{ name: "codex", version: "0.146.0" }]),
    // claude has a newer version published than the one on disk.
    checkAgentUpdates: vi
      .fn()
      .mockResolvedValue([{ name: "claude", current: "2.3.1", latest: "2.4.0" }]),
    listAgents: vi.fn().mockResolvedValue([]),
    getEnvFields: vi.fn().mockResolvedValue([]),
    getAgentEnv: vi.fn().mockResolvedValue({}),
    saveAgentEnv: vi.fn().mockResolvedValue(undefined),
    getAgentChangelog: vi
      .fn()
      .mockResolvedValue({ versions: [{ version: "0.146.0" }], latest: "0.146.0" }),
    healthCheck: vi.fn().mockResolvedValue({ ready: true, version: "0.146.0" }),
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    installAgentTypeStreaming: vi.fn().mockResolvedValue({ success: true }),
    refreshLogin: vi.fn().mockResolvedValue({ logged_in: false, ready: false }),
    openTerminal: vi.fn().mockResolvedValue(undefined),
    testLLM: vi.fn().mockResolvedValue({ success: true, model: "gpt-5" }),
    addAgent: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    ...overrides,
  }
  ;(window as unknown as { api: Api }).api = api
  return api
}

const showToast = vi.fn()

beforeEach(() => {
  useInstallStore.setState({ jobs: {}, installed: [], updates: [] })
  useAgentsStore.setState({ agents: [] })
  localStorage.clear()
  showToast.mockClear()
  installApi()
})

describe("marketplace", () => {
  it("shows catalog counts and one card per agent", async () => {
    render(<Install showToast={showToast} />)

    expect(await screen.findByTestId("agent-card-codex")).toBeInTheDocument()
    expect(screen.getByTestId("agent-card-openclaw")).toBeInTheDocument()

    // 3 available / 1 installed record / 1 pending update.
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument())
    await waitFor(() => {
      const badge = within(screen.getByTestId("agent-card-claude")).getByText(
        "Update available",
      )
      expect(badge).toBeInTheDocument()
    })
  })

  it("spotlights an agent the user does not have, with its icon", async () => {
    render(<Install showToast={showToast} />)

    // codex is the only `featured` entry but it is already installed, so the
    // banner drops to the next preference: something not on the machine.
    const hero = (await screen.findByRole("heading", { name: "OpenClaw" }))
      .closest("section") as HTMLElement
    expect(within(hero).getByRole("img", { name: "openclaw" })).toBeInTheDocument()
    expect(within(hero).getByRole("button", { name: /Install now/ })).toBeInTheDocument()
  })

  it("prefers the translated blurb over the core's own description", async () => {
    render(<Install showToast={showToast} />)

    // The catalog says "Anthropic's official terminal agent."; the agentMeta
    // overlay is what should reach the card.
    const card = await screen.findByTestId("agent-card-claude")
    expect(
      within(card).getByText("Anthropic's official CLI agent for Claude."),
    ).toBeInTheDocument()
  })

  it("offers install for a missing agent and manage for an installed one", async () => {
    render(<Install showToast={showToast} />)

    expect(await screen.findByTestId("install-btn-openclaw")).toBeInTheDocument()
    const installedCard = screen.getByTestId("agent-card-codex")
    expect(within(installedCard).getByRole("button", { name: "Manage" })).toBeInTheDocument()
  })

  it("filters the catalog by search", async () => {
    render(<Install showToast={showToast} />)
    await screen.findByTestId("agent-card-codex")

    await userEvent.type(screen.getByPlaceholderText(/Search agents/), "openclaw")

    await waitFor(() =>
      expect(screen.queryByTestId("agent-card-codex")).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId("agent-card-openclaw")).toBeInTheDocument()
  })

  it("switches to the list view and keeps the same rows", async () => {
    render(<Install showToast={showToast} />)
    await screen.findByTestId("agent-card-codex")

    await userEvent.click(screen.getByRole("radio", { name: /List view/ }))

    // The table renders a header row the grid does not have.
    expect(await screen.findByRole("columnheader", { name: "Runtime" })).toBeInTheDocument()
    expect(screen.getByTestId("agent-card-openclaw")).toBeInTheDocument()
  })

  it("opens the detail page with its action rail", async () => {
    render(<Install showToast={showToast} />)

    await userEvent.click(await screen.findByTestId("agent-card-codex"))

    expect(
      await screen.findByRole("heading", { name: "OpenAI Codex CLI" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Uninstall/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Stable" })).toBeInTheDocument()
    // Right rail facts come from the registry entry, not from a probe.
    expect(screen.getByText("nodejs")).toBeInTheDocument()
  })
})

describe("setup wizard", () => {
  it("switches between CLI login and API key for a dual-auth agent", async () => {
    installApi({
      getEnvFields: vi.fn().mockResolvedValue([
        { name: "ANTHROPIC_API_KEY", password: true, required: true },
      ]),
    })
    render(<Install showToast={showToast} />)

    await userEvent.click(await screen.findByTestId("agent-card-claude"))
    await userEvent.click(await screen.findByRole("button", { name: /Setup wizard/ }))

    // CLI leads: it is the path that needs no secret typed in.
    const dialog = await screen.findByRole("dialog")
    const cliTab = within(dialog).getByRole("tab", { name: /CLI login/ })
    expect(cliTab).toHaveAttribute("data-state", "active")
    expect(within(dialog).getByText("claude login")).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole("tab", { name: /API key/ }))
    expect(await within(dialog).findByLabelText(/ANTHROPIC_API_KEY/)).toBeInTheDocument()
  })
})
