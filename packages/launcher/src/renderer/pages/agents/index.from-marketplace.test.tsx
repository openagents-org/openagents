import React from "react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Agents from "./index"
import { useUiStore } from "../../store/ui"

vi.mock("../../lib/analytics", () => ({ capture: vi.fn(), group: vi.fn() }))

// The real form is exercised in local-agent-setup.test.tsx; here only the
// page's wiring matters: an add reports onCreated, then the form goes Back.
vi.mock("./local-agent-setup", () => ({
  LocalAgentSetup: ({ onCreated, onBack }: { onCreated: (n: string) => void; onBack: () => void }) => (
    <div>
      <button onClick={() => { onCreated("fresh"); onBack() }}>stub-add</button>
      <button onClick={onBack}>stub-cancel</button>
    </div>
  ),
}))

const STATUS = { connected: false, workspaceSlug: null, workspaceName: null, workspaces: [], revoked: [] }

beforeEach(() => {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    listAgents: vi.fn().mockResolvedValue([]),
    agentStatus: vi.fn().mockResolvedValue({}),
    getCatalog: vi.fn().mockResolvedValue([{ name: "claude", label: "Claude", installed: true }]),
    getSupportedAgentTypes: vi.fn().mockResolvedValue(["claude"]),
    getInstalledAgents: vi.fn().mockResolvedValue([]),
    checkAgentUpdates: vi.fn().mockResolvedValue([]),
    listWorkspaces: vi.fn().mockResolvedValue([]),
    getNodeStatus: vi.fn().mockResolvedValue(STATUS),
    refreshNodeStatus: vi.fn().mockResolvedValue(STATUS),
    healthCheck: vi.fn().mockResolvedValue({ ready: true }),
    listPaths: vi.fn().mockResolvedValue({ home: "/home/test" }),
    onCliLoginEvent: vi.fn(() => () => {}),
  }
  useUiStore.setState({ currentTab: "install" })
})

async function openFromMarketplace(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  act(() => useUiStore.getState().requestCreate("agent", "claude"))
  render(<Agents showToast={vi.fn()} />)
  await screen.findByText("stub-add")
  return user
}

describe("adding an agent from a marketplace page", () => {
  it("stays on Connect Agents and opens the Connect dialog for the new agent", async () => {
    const user = await openFromMarketplace()
    await user.click(screen.getByText("stub-add"))
    expect(await screen.findByTestId("connect-ws")).toBeInTheDocument()
    expect(useUiStore.getState().currentTab).toBe("dashboard")
  })

  it("Cancel still returns to the marketplace", async () => {
    const user = await openFromMarketplace()
    await user.click(screen.getByText("stub-cancel"))
    await waitFor(() => expect(useUiStore.getState().currentTab).toBe("install"))
    expect(screen.queryByTestId("connect-ws")).toBeNull()
  })
})
