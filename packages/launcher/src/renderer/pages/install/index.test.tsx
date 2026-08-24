import React from "react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import Install from "./index"
import { useInstallStore } from "../../store/install"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
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
    // All three platform keys, as the real registry writes them: the channel
    // selector only appears for agents that resolve to an npm package, and
    // which key it reads depends on the OS the test happens to run on.
    install: {
      binary: "codex",
      requires: ["nodejs"],
      macos: "npm install -g @openai/codex",
      linux: "npm install -g @openai/codex",
      windows: "npm install -g @openai/codex",
    },
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
    getNodeStatus: vi.fn().mockResolvedValue({
      connected: false,
      workspaceSlug: null,
      workspaceName: null,
      workspaces: [],
      revoked: [],
    }),
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
    onCliLoginEvent: vi.fn(() => () => {}),
    startCliLogin: vi.fn().mockResolvedValue({ mode: "in-app" }),
    submitCliLoginCode: vi.fn().mockResolvedValue(undefined),
    cancelCliLogin: vi.fn().mockResolvedValue(undefined),
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
  // Both outlive the page, so a deep-link left over from one case would decide
  // where the next one opens.
  useUiStore.setState({ installFocusAgent: null, installListSignal: 0 })
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

  it("jumps straight to the agent when exactly one update is pending", async () => {
    // The feedback that prompted this: the counter said "1 update" but not
    // WHICH, so finding it meant scrolling the whole catalog.
    render(<Install showToast={showToast} />)
    await screen.findByTestId("agent-card-codex")

    await userEvent.click(await screen.findByTestId("stats-filter-updatable"))

    // Landed on claude's detail page, not a one-row filtered list.
    expect(
      await screen.findByRole("heading", { name: "Claude Code CLI" }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId("agent-card-codex")).not.toBeInTheDocument()
  })

  it("filters down to the installed agents and back", async () => {
    render(<Install showToast={showToast} />)
    await screen.findByTestId("agent-card-codex")

    const installedCounter = await screen.findByTestId("stats-filter-installed")
    await userEvent.click(installedCounter)

    // Only the agent with an installed record survives.
    await waitFor(() =>
      expect(screen.queryByTestId("agent-card-openclaw")).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId("agent-card-codex")).toBeInTheDocument()
    expect(installedCounter).toHaveAttribute("aria-pressed", "true")

    // Clicking the active counter again clears it.
    await userEvent.click(installedCounter)
    expect(await screen.findByTestId("agent-card-openclaw")).toBeInTheDocument()
    expect(installedCounter).toHaveAttribute("aria-pressed", "false")
  })

  it("does not offer a filter for a counter that counts nothing", async () => {
    installApi({ checkAgentUpdates: vi.fn().mockResolvedValue([]) })
    render(<Install showToast={showToast} />)
    await screen.findByTestId("agent-card-codex")

    expect(await screen.findByTestId("stats-filter-updatable")).toBeDisabled()
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

describe("deep links", () => {
  it("opens the requested agent and consumes the request", async () => {
    useUiStore.setState({ installFocusAgent: "codex" })
    render(<Install showToast={showToast} />)

    expect(
      await screen.findByRole("heading", { name: "OpenAI Codex CLI" }),
    ).toBeInTheDocument()
    // Cleared, so a later visit through the sidebar lands on the list.
    expect(useUiStore.getState().installFocusAgent).toBeNull()
  })

  // The reported bug. `installListSignal` is a counter in a store that outlives
  // this page, so after the user has clicked the sidebar's Install item even
  // once it is non-zero forever. Both effects run on mount, and the list one
  // runs second — so every notification deep-link from the dashboard landed on
  // the marketplace list instead of on the agent it named.
  it("still opens the agent when the list signal is already non-zero", async () => {
    useUiStore.setState({ installFocusAgent: "codex", installListSignal: 3 })
    render(<Install showToast={showToast} />)

    expect(
      await screen.findByRole("heading", { name: "OpenAI Codex CLI" }),
    ).toBeInTheDocument()
  })

  it("returns to the list when the signal is bumped while open", async () => {
    useUiStore.setState({ installFocusAgent: "codex", installListSignal: 3 })
    render(<Install showToast={showToast} />)
    await screen.findByRole("heading", { name: "OpenAI Codex CLI" })

    // What clicking the sidebar's Install item does.
    await act(async () => useUiStore.getState().goToInstallList())

    expect(await screen.findByTestId("agent-card-openclaw")).toBeInTheDocument()
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
    const cliTab = within(dialog).getByRole("tab", { name: /Account sign-in/ })
    expect(cliTab).toHaveAttribute("data-state", "active")
    expect(within(dialog).getByText("claude login")).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole("tab", { name: /API key/ }))
    expect(await within(dialog).findByLabelText(/ANTHROPIC_API_KEY/)).toBeInTheDocument()
  })
})
