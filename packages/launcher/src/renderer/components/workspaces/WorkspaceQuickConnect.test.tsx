import React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { WorkspaceQuickConnect } from "./WorkspaceQuickConnect"

vi.mock("../../lib/analytics", () => ({ capture: vi.fn(), group: vi.fn() }))

type Api = Record<string, ReturnType<typeof vi.fn>>

function installApi(overrides: Partial<Api> = {}): Api {
  const api: Api = {
    connectNode: vi.fn().mockResolvedValue({
      connected: true,
      workspaceSlug: "paired-ws",
      workspaceName: "Paired WS",
      warning: null,
    }),
    registerWorkspaceFromToken: vi
      .fn()
      .mockResolvedValue({ slug: "joined-ws", id: "id-1" }),
    openExternal: vi.fn(),
    ...overrides,
  }
  ;(window as unknown as { api: Api }).api = api
  return api
}

const showToast = vi.fn()
const onClose = vi.fn()
const onCreated = vi.fn()

function renderDialog(): void {
  render(
    <WorkspaceQuickConnect
      open
      onClose={onClose}
      onCreated={onCreated}
      showToast={showToast}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe("WorkspaceQuickConnect — pairing-first", () => {
  it("opens on the pair form with no tabs and no create option", () => {
    installApi()
    renderDialog()
    expect(screen.getByLabelText(/pairing code/i)).toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(screen.queryByText(/workspace name/i)).not.toBeInTheDocument()
    // Creation is web-only now; the pair form links out instead.
    expect(screen.getByText(/create one at/i)).toBeInTheDocument()
  })

  it("pairs with a normalized code", async () => {
    const api = installApi()
    renderDialog()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/pairing code/i), "abcd-2345")
    await user.click(screen.getByRole("button", { name: /^join$/i }))

    await waitFor(() => expect(api.connectNode).toHaveBeenCalledWith("ABCD2345"))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onCreated).toHaveBeenCalled()
  })

  it("keeps the manual path working behind the demoted link, with the notice", async () => {
    const api = installApi()
    renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByTestId("qc-manual-toggle"))
    expect(
      screen.getByText(/manual token connection is being retired/i),
    ).toBeInTheDocument()

    await user.type(
      screen.getByLabelText(/workspace url or invitation token/i),
      "https://workspace.openagents.org/team?token=abc",
    )
    await user.click(screen.getByRole("button", { name: /^connect$/i }))

    await waitFor(() =>
      expect(api.registerWorkspaceFromToken).toHaveBeenCalledWith({
        url: "https://workspace.openagents.org/team?token=abc",
        token: "abc",
        slug: "team",
      }),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("hides the retirement notice once dismissed, across reopenings", async () => {
    installApi()
    renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByTestId("qc-manual-toggle"))
    await user.click(screen.getByRole("button", { name: /don't show again/i }))
    expect(
      screen.queryByText(/manual token connection is being retired/i),
    ).not.toBeInTheDocument()
    expect(localStorage.getItem("manual_connect_deprecation_dismissed")).toBe(
      "true",
    )
  })

  it("returns from the manual view via Back", async () => {
    installApi()
    renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByTestId("qc-manual-toggle"))
    await user.click(screen.getByRole("button", { name: /back/i }))
    expect(screen.getByLabelText(/pairing code/i)).toBeInTheDocument()
  })

  it("rejects a short code without calling the API", async () => {
    const api = installApi()
    renderDialog()
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/pairing code/i), "abc")
    // The submit button is disabled for short codes; Enter in the field
    // exercises the validation path instead.
    await user.keyboard("{Enter}")
    expect(await screen.findByText(/8 characters/i)).toBeInTheDocument()
    expect(api.connectNode).not.toHaveBeenCalled()
  })
})
