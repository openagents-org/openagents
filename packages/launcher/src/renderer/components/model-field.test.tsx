import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ModelField } from "./model-field"

type Api = Record<string, ReturnType<typeof vi.fn>>

// cmdk measures its list on mount; jsdom ships no ResizeObserver.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
// …and no scrollIntoView, which cmdk calls to reveal the highlighted item.
Element.prototype.scrollIntoView ??= function scrollIntoView(): void {}

/**
 * The list is an offer, never a constraint. A relay that doesn't publish
 * `/models`, a private deployment name, a model newer than whatever the CLI
 * cached — all of those have to remain typeable, or the picker becomes a
 * narrower field than the plain text box it replaced.
 */
function installApi(models: Array<{ id: string }> = []): Api {
  const api: Api = {
    listModels: vi.fn().mockResolvedValue({ models, source: "api" }),
  }
  ;(window as unknown as { api: Api }).api = api
  return api
}

beforeEach(() => vi.clearAllMocks())

describe("ModelField", () => {
  it("keeps an id that is in no list", async () => {
    installApi([{ id: "gpt-5.6-sol" }])
    const onChange = vi.fn()
    render(
      <ModelField
        id="m"
        agentType="codex"
        value=""
        env={{}}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByRole("textbox"), "my-private-deploy")
    // Controlled input: every keystroke is reported, the last one carries the
    // final character — nothing filters or rewrites it.
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("y")
    expect(onChange.mock.calls[0][0]).toBe("m")
  })

  it("does not fetch a list until the picker is opened", async () => {
    const api = installApi([{ id: "gpt-5.6-sol" }])
    render(
      <ModelField
        id="m"
        agentType="codex"
        value="something-custom"
        env={{}}
        onChange={vi.fn()}
      />,
    )
    expect(api.listModels).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox")).toHaveValue("something-custom")
  })

  it("passes the auth path through, and writes a picked id back", async () => {
    const api = installApi([{ id: "gpt-5.6-sol" }])
    const onChange = vi.fn()
    render(
      <ModelField
        id="m"
        agentType="codex"
        value=""
        env={{ OPENAI_API_KEY: "sk-x" }}
        path="key"
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole("button"))
    await waitFor(() =>
      expect(api.listModels).toHaveBeenCalledWith(
        "codex",
        { OPENAI_API_KEY: "sk-x" },
        "key",
      ),
    )
    await userEvent.click(await screen.findByText("gpt-5.6-sol"))
    expect(onChange).toHaveBeenCalledWith("gpt-5.6-sol")
  })
})
