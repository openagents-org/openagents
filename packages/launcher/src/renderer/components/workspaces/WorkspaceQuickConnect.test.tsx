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
})

describe("WorkspaceQuickConnect — pairing only", () => {
  it("offers the pair form and nothing else", () => {
    installApi()
    renderDialog()
    expect(screen.getByLabelText(/pairing code/i)).toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(screen.queryByText(/workspace name/i)).not.toBeInTheDocument()
    // Creation is web-only; the pair form links out instead.
    expect(screen.getByText(/create one at/i)).toBeInTheDocument()
    // The manual link/token path is gone, not demoted.
    expect(screen.queryByTestId("qc-manual-toggle")).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/workspace url or invitation token/i),
    ).not.toBeInTheDocument()
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
