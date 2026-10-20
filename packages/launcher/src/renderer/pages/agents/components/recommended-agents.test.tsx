import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { RecommendedAgents } from "./recommended-agents"
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
  it("shows two of the four at a time, stepping one by hand", async () => {
    const user = userEvent.setup()
    render(<RecommendedAgents catalog={CATALOG} onInstall={vi.fn()} onMore={vi.fn()} />)

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

  it("offers Install now only for a type that is not installed", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    const onMore = vi.fn()
    render(<RecommendedAgents catalog={CATALOG} onInstall={onInstall} onMore={onMore} />)

    // Claude is installed: its card shows the state, not the button.
    const claude = screen.getByTestId("recommended-claude")
    expect(within(claude).queryByRole("button", { name: /install now/i })).not.toBeInTheDocument()
    expect(within(claude).getByText(/installed/i)).toBeInTheDocument()

    const codex = screen.getByTestId("recommended-codex")
    await user.click(within(codex).getByRole("button", { name: /install now/i }))
    expect(onInstall).toHaveBeenCalledWith("codex")

    await user.click(screen.getByRole("button", { name: /browse and connect more agents/i }))
    expect(onMore).toHaveBeenCalled()
  })
})
