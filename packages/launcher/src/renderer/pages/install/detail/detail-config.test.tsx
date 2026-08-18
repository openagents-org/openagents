import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

import { DetailConfig } from "./detail-config"

type Api = Record<string, ReturnType<typeof vi.fn>>

/**
 * The marketplace page is where the install happens, so its auth card mounts
 * BEFORE the CLI exists. These cover the two ways its verdict used to get
 * stuck: probing a CLI that isn't there yet, and never looking again once it
 * is.
 */
function installApi(overrides: Partial<Api> = {}): Api {
  const api: Api = {
    refreshLogin: vi.fn().mockResolvedValue({ logged_in: true, ready: true }),
    // useCliLogin registers a listener on mount and unsubscribes on unmount.
    onCliLoginEvent: vi.fn().mockReturnValue(() => {}),
    cancelCliLogin: vi.fn().mockResolvedValue(undefined),
    saveAgentEnv: vi.fn().mockResolvedValue(undefined),
    testLLM: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  }
  ;(window as unknown as { api: Api }).api = api
  return api
}

const props = {
  agentName: "codex",
  fields: [],
  values: {},
  onChange: vi.fn(),
  loginCommand: "codex login",
  showToast: vi.fn(),
}

beforeEach(() => vi.clearAllMocks())

describe("DetailConfig sign-in card", () => {
  it("does not probe a CLI that is not installed yet", async () => {
    const api = installApi()
    render(<DetailConfig {...props} installed={false} />)
    await screen.findByText("Not signed in")
    expect(api.refreshLogin).not.toHaveBeenCalled()
  })

  it("probes once the install finishes, instead of keeping the old verdict", async () => {
    const api = installApi()
    const { rerender } = render(<DetailConfig {...props} installed={false} />)
    await screen.findByText("Not signed in")

    rerender(<DetailConfig {...props} installed={true} />)
    await waitFor(() => expect(api.refreshLogin).toHaveBeenCalledWith("codex"))
    expect(await screen.findByText("Signed in")).toBeInTheDocument()
  })

  it("re-reads the sign-in when the setup wizard closes", async () => {
    const api = installApi({
      refreshLogin: vi
        .fn()
        .mockResolvedValue({ logged_in: false, ready: false }),
    })
    const { rerender } = render(
      <DetailConfig {...props} installed={true} authRefresh={0} />,
    )
    await waitFor(() => expect(api.refreshLogin).toHaveBeenCalledTimes(1))

    // The wizard's terminal login reports nothing back, so the close is the
    // only signal this card gets.
    api.refreshLogin.mockResolvedValue({ logged_in: true, ready: true })
    rerender(<DetailConfig {...props} installed={true} authRefresh={1} />)
    await waitFor(() => expect(api.refreshLogin).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("Signed in")).toBeInTheDocument()
  })
})
