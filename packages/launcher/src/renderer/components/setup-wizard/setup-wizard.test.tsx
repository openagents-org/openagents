import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import SetupWizard from "./index"
import type { CatalogEntry } from "../../types"

type Api = Record<string, ReturnType<typeof vi.fn>>

const ENTRY: CatalogEntry = {
  name: "codebuddy",
  label: "CodeBuddy Code",
  installed: true,
  install: { binary: "codebuddy" },
}

const FIELDS = [
  { name: "CODEBUDDY_API_KEY", description: "API key.", password: true },
  { name: "CODEBUDDY_AUTH_TOKEN", description: "Platform token." },
  { name: "CODEBUDDY_BASE_URL", description: "Enterprise deployment." },
]

function installApi(overrides: Partial<Api> = {}): Api {
  const api: Api = {
    getNodeStatus: vi.fn().mockResolvedValue({ workspaces: [] }),
    getEnvFields: vi.fn().mockResolvedValue(FIELDS),
    // What the tester had typed: a model gateway, in the field that takes
    // another CodeBuddy deployment.
    getAgentEnv: vi
      .fn()
      .mockResolvedValue({
        CODEBUDDY_BASE_URL: "https://gateway.example.com/v1",
      }),
    saveAgentEnv: vi.fn().mockResolvedValue(undefined),
    testLLM: vi.fn().mockResolvedValue({ success: true }),
    refreshLogin: vi.fn().mockResolvedValue({ logged_in: false }),
    onCliLoginEvent: vi.fn().mockReturnValue(() => {}),
    cancelCliLogin: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  ;(window as unknown as { api: Api }).api = api
  return api
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom has no layout, so nothing scrolls — the call itself is what the
  // component under test makes.
  Element.prototype.scrollIntoView = vi.fn()
})

/**
 * A refusal the user cannot see is a button that just stops working. These
 * cover the long-form case the wizard is actually used in: a dozen env fields,
 * a scrolling body, and the field at fault behind "Advanced".
 */
describe("SetupWizard verification failure", () => {
  it("reports the refusal outside the scrolling form", async () => {
    const api = installApi()
    render(
      <SetupWizard entry={ENTRY} open onClose={vi.fn()} showToast={vi.fn()} />,
    )
    await screen.findByLabelText(/CODEBUDDY_API_KEY/)

    await userEvent.click(
      screen.getByRole("button", { name: /Save & create agent/ }),
    )

    // Not saved, and said so where the button is — the alert is a sibling of
    // the footer, not a paragraph somewhere down the form.
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/model API endpoint/)
    expect(api.saveAgentEnv).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument()
  })

  it("reveals the field at fault, which is hidden behind Advanced", async () => {
    installApi()
    render(
      <SetupWizard entry={ENTRY} open onClose={vi.fn()} showToast={vi.fn()} />,
    )
    await screen.findByLabelText(/CODEBUDDY_API_KEY/)
    // A platform endpoint is not on screen until asked for.
    expect(
      screen.queryByLabelText(/CODEBUDDY_BASE_URL/),
    ).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("button", { name: /Save & create agent/ }),
    )

    expect(
      await screen.findByLabelText(/CODEBUDDY_BASE_URL/),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled(),
    )
    // And a way back to it, for when the user has scrolled off again.
    expect(
      screen.getByRole("button", { name: /Go to CODEBUDDY_BASE_URL/ }),
    ).toBeInTheDocument()
  })
})

describe("SetupWizard sign-in path", () => {
  it("won't continue an OpenCode sign-in without the model it cannot run without", async () => {
    const showToast = vi.fn()
    const api = installApi({
      getEnvFields: vi.fn().mockResolvedValue([
        { name: "LLM_API_KEY", description: "API key", password: true },
        { name: "LLM_MODEL", description: "Model", required: true },
      ]),
      getAgentEnv: vi.fn().mockResolvedValue({}),
    })
    const entry: CatalogEntry = {
      name: "opencode",
      label: "OpenCode",
      installed: true,
      install: { binary: "opencode" },
      check_ready: { login_command: "opencode auth login" },
    }
    render(
      <SetupWizard entry={entry} open onClose={vi.fn()} showToast={showToast} />,
    )
    // The sign-in tab's own model field, once the fields have loaded.
    await screen.findByLabelText(/LLM_MODEL/)

    await userEvent.click(
      screen.getByRole("button", { name: /Save & create agent/ }),
    )

    expect(showToast).toHaveBeenCalledWith("LLM_MODEL is required", "warning")
    expect(api.saveAgentEnv).not.toHaveBeenCalled()
  })
})
