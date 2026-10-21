import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { RecommendedAgents } from "./recommended-agents"
import { useInstallStore } from "@renderer/store/install"
import type { CatalogEntry } from "@renderer/types"

const entry = (name: string, extra: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({ name, label: name.toUpperCase(), description: "", tags: [], installed: false, ...extra }) as CatalogEntry

const CATALOG = [
  entry("gemini"),
  entry("hermes"),
  entry("opencode"),
  entry("claude", { installed: true }),
  entry("codex"),
]

describe("RecommendedAgents", () => {
  afterEach(() => useInstallStore.setState({ updates: [] }))

  it("shows two of the four at a time, stepping one by hand", async () => {
    const user = userEvent.setup()
    render(<RecommendedAgents catalog={CATALOG} onInstall={vi.fn()} onUpdate={vi.fn()} onMore={vi.fn()} />)

    // Codex and Claude lead; Gemini is not one of the four.
    expect(screen.getByTestId("recommended-codex")).toBeInTheDocument()
    expect(screen.getByTestId("recommended-claude")).toBeInTheDocument()
    expect(screen.queryByTestId("recommended-opencode")).not.toBeInTheDocument()
    expect(screen.queryByTestId("recommended-gemini")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.queryByTestId("recommended-codex")).not.toBeInTheDocument()
    expect(screen.getByTestId("recommended-claude")).toBeInTheDocument()
    expect(screen.getByTestId("recommended-opencode")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByTestId("recommended-hermes")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("opens the setup form from every card, installed or not", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const onMore = vi.fn()
    render(<RecommendedAgents catalog={CATALOG} onInstall={onInstall} onUpdate={vi.fn()} onMore={onMore} />)

    // Claude is installed: another agent of it can still be added.
    const claude = screen.getByTestId("recommended-claude")
    expect(within(claude).getByText(/installed/i)).toBeInTheDocument()
    await user.click(within(claude).getByRole("button", { name: /add agent/i }))
    expect(onInstall).toHaveBeenCalledWith("claude")

    const codex = screen.getByTestId("recommended-codex")
    await user.click(within(codex).getByRole("button", { name: /install now/i }))
    expect(onInstall).toHaveBeenCalledWith("codex")

    await user.click(screen.getByRole("button", { name: /browse and connect more agents/i }))
    expect(onMore).toHaveBeenCalled()
  })

  it("sends a pending update to the type's marketplace page", async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    useInstallStore.setState({ updates: [{ name: "claude", current: "1.0.0", latest: "1.1.0" }] as never })
    render(<RecommendedAgents catalog={CATALOG} onInstall={vi.fn()} onUpdate={onUpdate} onMore={vi.fn()} />)

    await user.click(screen.getByTestId("recommended-update-claude"))
    expect(onUpdate).toHaveBeenCalledWith("claude")
  })
})
