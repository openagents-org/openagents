import React from "react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Agents from "./index"
import { useAgentsStore } from "../../store/agents"
import type { Agent } from "../../types"

// Analytics fires network calls (posthog) — stub it out for the jsdom run.
vi.mock("../../lib/analytics", () => ({ capture: vi.fn() }))

type Api = Record<string, ReturnType<typeof vi.fn>>

// A minimal window.api that resolves everything the Agents page touches.
// Individual tests override the pieces they care about.
function installApi(overrides: Partial<Api> = {}): Api {
  const api: Api = {
    listAgents: vi.fn().mockResolvedValue([]),
    agentStatus: vi.fn().mockResolvedValue({}),
    startAgent: vi.fn().mockResolvedValue(undefined),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    removeAgent: vi.fn().mockResolvedValue(undefined),
    addAgent: vi.fn().mockResolvedValue(undefined),
    getCatalog: vi
      .fn()
      .mockResolvedValue([{ name: "claude", label: "Claude", installed: true }]),
    getSupportedAgentTypes: vi.fn().mockResolvedValue(["claude"]),
    // ConfigureDialog: no env fields + no login command => "no config" view.
    getEnvFields: vi.fn().mockResolvedValue([]),
    getAgentEnv: vi.fn().mockResolvedValue({}),
    getAgentInstanceEnv: vi.fn().mockResolvedValue({}),
    saveAgentInstanceEnv: vi.fn().mockResolvedValue(undefined),
    saveAgentEnv: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ ready: false }),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    connectWorkspace: vi.fn().mockResolvedValue(undefined),
    disconnectWorkspace: vi.fn().mockResolvedValue(undefined),
    createWorkspace: vi.fn().mockResolvedValue({ token: "tok-123", slug: "new-ws" }),
    registerWorkspaceFromToken: vi
      .fn()
      .mockResolvedValue({ slug: "joined-ws", id: "id-1" }),
    signalReload: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    // NewAgentDialog prefills the working folder from the OS home dir and lets
    // the user browse for one; agent rows with a CLI can open a terminal.
    listPaths: vi.fn().mockResolvedValue({ home: "/home/test" }),
    selectDirectory: vi.fn().mockResolvedValue(null),
    openAgentTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  ;(window as unknown as { api: Api }).api = api
  return api
}

function makeAgent(partial: Partial<Agent>): Agent {
  return {
    name: "agent-1",
    type: "claude",
    state: "stopped",
    health: null,
    network: null,
    ...partial,
  }
}

const showToast = vi.fn()

beforeEach(() => {
  // Zustand store is module-global; reset it so tests don't leak agents.
  useAgentsStore.setState({ agents: [], pendingAgentActions: new Set() })
  showToast.mockClear()
})

// Drives NewAgentDialog -> ConfigureDialog with a deterministic agent name and
// returns once the "no configuration required" Close button is visible.
async function createAndReachConfigure(
  user: ReturnType<typeof userEvent.setup>,
  name = "my-new-agent",
): Promise<void> {
  await user.click(screen.getByRole("button", { name: /new agent/i }))
  const nameInput = await screen.findByLabelText(/agent name/i)
  await user.clear(nameInput)
  await user.type(nameInput, name)
  await user.click(screen.getByRole("button", { name: /^create$/i }))
  // ConfigureDialog: "no configuration required" view with a Close button.
  await screen.findByText(/no configuration required/i)
}

describe("Agents page — new agent connect flow", () => {
  it("opens the Connect Workspace dialog after a new agent is configured", async () => {
    installApi()
    const user = userEvent.setup()
    render(<Agents showToast={showToast} />)

    await createAndReachConfigure(user, "my-new-agent")
    await user.click(screen.getByRole("button", { name: /^close$/i }))

    // The connect dialog for this specific agent should now be visible.
    await waitFor(() =>
      expect(
        screen.getByText(/connect 'my-new-agent' to workspace/i),
      ).toBeInTheDocument(),
    )
  })

  it("lets the user skip the connect step", async () => {
    installApi()
    const user = userEvent.setup()
    render(<Agents showToast={showToast} />)

    await createAndReachConfigure(user)
    await user.click(screen.getByRole("button", { name: /^close$/i }))
    await screen.findByText(/to workspace/i)

    // Cancel out of the connect dialog — no connection attempted.
    await user.click(screen.getByRole("button", { name: /^cancel$/i }))

    await waitFor(() =>
      expect(screen.queryByText(/to workspace/i)).not.toBeInTheDocument(),
    )
    expect(
      (window as unknown as { api: Api }).api.connectWorkspace,
    ).not.toHaveBeenCalled()
  })
})

describe("Agents page — Connect vs Open Workspace gating", () => {
  it("unconnected agents show Connect, not Open Workspace", async () => {
    installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "lonely", network: null })]),
    })
    render(<Agents showToast={showToast} />)

    await screen.findByText("lonely")
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /open workspace/i }),
    ).not.toBeInTheDocument()
  })

  it("connected agents show Open Workspace, not Connect", async () => {
    installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "joined", network: "team-x" })]),
    })
    render(<Agents showToast={showToast} />)

    await screen.findByText("joined")
    expect(
      screen.getByRole("button", { name: /open workspace/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^connect$/i }),
    ).not.toBeInTheDocument()
  })
})

describe("ConnectWorkspaceDialog — existing / create / token flows", () => {
  async function openConnectDialog(api: Api): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()
    render(<Agents showToast={showToast} />)
    await screen.findByText("lonely")
    await user.click(screen.getByRole("button", { name: /^connect$/i }))
    await screen.findByText(/connect 'lonely' to workspace/i)
    return user
  }

  it("connects to an existing workspace from the list", async () => {
    const api = installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "lonely", network: null })]),
      listWorkspaces: vi.fn().mockResolvedValue([
        { id: "id-1", slug: "team-a", name: "Team A", endpoint: "", token: "t" },
      ]),
    })
    const user = await openConnectDialog(api)

    await user.click(await screen.findByRole("button", { name: /team a/i }))

    await waitFor(() =>
      expect(api.connectWorkspace).toHaveBeenCalledWith("lonely", "team-a"),
    )
  })

  it("creates a new workspace and connects with its token", async () => {
    const api = installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "lonely", network: null })]),
    })
    const user = await openConnectDialog(api)

    await user.click(screen.getByRole("button", { name: /create new workspace/i }))
    const nameInput = await screen.findByLabelText(/workspace name/i)
    await user.type(nameInput, "fresh-ws")
    // Scope to the dialog's create button (avoid the topbar "New Agent" etc.).
    await user.click(screen.getByRole("button", { name: /^create$/i }))

    await waitFor(() =>
      expect(api.createWorkspace).toHaveBeenCalledWith("fresh-ws"),
    )
    await waitFor(() =>
      expect(api.connectWorkspace).toHaveBeenCalledWith("lonely", "tok-123"),
    )
  })

  it("joins a workspace from a custom URL via token registration", async () => {
    const api = installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "lonely", network: null })]),
    })
    const user = await openConnectDialog(api)

    await user.click(screen.getByRole("button", { name: /join with url or token/i }))
    const tokenInput = await screen.findByLabelText(/paste workspace url or token/i)
    await user.type(tokenInput, "http://localhost:8000/team?token=abc")
    await user.click(screen.getByRole("button", { name: /^join$/i }))

    await waitFor(() =>
      expect(api.registerWorkspaceFromToken).toHaveBeenCalledWith({
        url: "http://localhost:8000/team?token=abc",
      }),
    )
    await waitFor(() =>
      expect(api.connectWorkspace).toHaveBeenCalledWith("lonely", "joined-ws"),
    )
  })

  it("joins a hosted workspace token directly without registration", async () => {
    const api = installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "lonely", network: null })]),
    })
    const user = await openConnectDialog(api)

    await user.click(screen.getByRole("button", { name: /join with url or token/i }))
    const tokenInput = await screen.findByLabelText(/paste workspace url or token/i)
    await user.type(tokenInput, "plain-token-xyz")
    await user.click(screen.getByRole("button", { name: /^join$/i }))

    await waitFor(() =>
      expect(api.connectWorkspace).toHaveBeenCalledWith("lonely", "plain-token-xyz"),
    )
    expect(api.registerWorkspaceFromToken).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Configure dialog — Gemini dual-auth (OAuth login OR API key). Verifies the
// fix for "Gemini shown as no-config / forced API key": the dialog must surface
// the real auth state (Google sign-in vs API key vs none) and never force a key
// or mislabel an unauthenticated Gemini as "No configuration required".
// ---------------------------------------------------------------------------
describe("Configure dialog — Gemini auth states", () => {
  // Optional (not required) key fields — a Google sign-in needs no key.
  const geminiFields = [
    { name: "GEMINI_API_KEY", description: "Google AI Studio API key", required: false, password: true },
    { name: "GOOGLE_GEMINI_BASE_URL", description: "Base URL", required: false, default: "https://generativelanguage.googleapis.com" },
    { name: "GEMINI_MODEL", description: "Model name", required: false, default: "gemini-2.5-pro" },
  ]
  const geminiCatalog = [
    {
      name: "gemini",
      label: "Gemini CLI",
      installed: true,
      check_ready: {
        login_command: "gemini",
        env_vars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        not_ready_message: "Needs sign-in — run `gemini` to sign in, or set GEMINI_API_KEY.",
        auth_detected_labels: {
          cli_login: "Google account sign-in detected",
          api_key: "API key detected",
        },
      },
    },
  ]

  async function openGeminiConfigure(health: Record<string, unknown>): Promise<Api> {
    const api = installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "gem-1", type: "gemini" })]),
      getCatalog: vi.fn().mockResolvedValue(geminiCatalog),
      getEnvFields: vi.fn().mockResolvedValue(geminiFields),
      refreshLogin: vi.fn().mockResolvedValue(health),
      clearLoginKey: vi.fn().mockResolvedValue(undefined),
      openTerminal: vi.fn().mockResolvedValue(undefined),
    })
    const user = userEvent.setup()
    render(<Agents showToast={showToast} />)
    await screen.findByText("gem-1")
    await user.click(screen.getByRole("button", { name: /configure/i }))
    await screen.findByText(/configure gem-1/i)
    return api
  }

  it("OAuth signed in → 'Google account sign-in detected', no forced API key", async () => {
    await openGeminiConfigure({ ready: true, auth_mode: "cli_login", message: "Ready" })
    expect(
      await screen.findByText(/Google account sign-in detected/i),
    ).toBeInTheDocument()
    // The login command stays available as an option…
    expect(screen.getAllByText(/gemini/).length).toBeGreaterThan(0)
    // …and the agent is NOT mislabeled as needing no configuration.
    expect(screen.queryByText(/no configuration required/i)).not.toBeInTheDocument()
    // The API-key field carries no "required" asterisk (it's optional).
    const keyLabel = screen.getByText(/Google AI Studio API key/i)
    expect(keyLabel.querySelector(".required")).toBeNull()
  })

  it("OAuth ready + empty API key → Save is NOT blocked by a required field", async () => {
    const api = await openGeminiConfigure({
      ready: true,
      auth_mode: "cli_login",
      message: "Ready",
    })
    const user = userEvent.setup()
    // Save with every key field left blank — optional fields must not gate it.
    await user.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() =>
      expect(api.saveAgentInstanceEnv).toHaveBeenCalledWith("gem-1", expect.anything()),
    )
    // No "<field> is required" validation warning was raised.
    expect(showToast).not.toHaveBeenCalledWith(
      expect.stringMatching(/is required/i),
      "warning",
    )
  })

  it("API key configured → 'API key detected', no 'must sign in' demand", async () => {
    await openGeminiConfigure({ ready: true, auth_mode: "api_key", message: "Ready" })
    expect(await screen.findByText(/API key detected/i)).toBeInTheDocument()
    expect(screen.queryByText(/no configuration required/i)).not.toBeInTheDocument()
    // Not the unauthenticated guidance.
    expect(
      screen.queryByText(/run `gemini` to sign in, or set GEMINI_API_KEY/i),
    ).not.toBeInTheDocument()
  })

  it("not authenticated → login guidance, never 'No configuration required'", async () => {
    await openGeminiConfigure({
      ready: false,
      auth_mode: null,
      auth_status: "no_credentials",
      message: "Needs sign-in — run `gemini` to sign in, or set GEMINI_API_KEY.",
    })
    expect(
      await screen.findByText(/run `gemini` to sign in, or set GEMINI_API_KEY/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/no configuration required/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Google account sign-in detected/i)).not.toBeInTheDocument()
  })

  it("service-account file invalid → not ready, surfaces failure, never Ready", async () => {
    await openGeminiConfigure({
      ready: false,
      auth_mode: null,
      auth_status: "no_credentials",
      message: "The configured Google application credentials file could not be accessed.",
    })
    expect(
      await screen.findByText(/credentials file could not be accessed/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Ready —/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no configuration required/i)).not.toBeInTheDocument()
  })
})

// Regression: agents WITHOUT auth_detected_labels are untouched by the Gemini
// banner — a genuinely no-config agent still reads "No configuration required",
// and a plain API-key agent still shows just its key fields.
describe("Configure dialog — other agents unaffected", () => {
  it("no env fields + no login command → still 'No configuration required'", async () => {
    const api = installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "plain-1", type: "claude" })]),
      getCatalog: vi
        .fn()
        .mockResolvedValue([{ name: "claude", label: "Claude", installed: true }]),
      getEnvFields: vi.fn().mockResolvedValue([]),
    })
    const user = userEvent.setup()
    render(<Agents showToast={showToast} />)
    await screen.findByText("plain-1")
    await user.click(screen.getByRole("button", { name: /configure/i }))
    expect(await screen.findByText(/no configuration required/i)).toBeInTheDocument()
    expect(api.refreshLogin).toBeUndefined()
  })

  it("env-only agent (no labels) → key fields, no auth banner", async () => {
    installApi({
      listAgents: vi
        .fn()
        .mockResolvedValue([makeAgent({ name: "kimi-1", type: "kimi" })]),
      getCatalog: vi
        .fn()
        .mockResolvedValue([{ name: "kimi", label: "Kimi", installed: true }]),
      getEnvFields: vi
        .fn()
        .mockResolvedValue([
          { name: "KIMI_API_KEY", description: "Kimi API key", required: true, password: true },
        ]),
    })
    const user = userEvent.setup()
    render(<Agents showToast={showToast} />)
    await screen.findByText("kimi-1")
    await user.click(screen.getByRole("button", { name: /configure/i }))
    expect(await screen.findByText(/Kimi API key/i)).toBeInTheDocument()
    expect(screen.queryByText(/no configuration required/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/sign-in detected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/API key detected/i)).not.toBeInTheDocument()
  })
})
