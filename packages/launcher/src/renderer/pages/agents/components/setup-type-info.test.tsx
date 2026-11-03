import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { SetupTypeInfo } from "./setup-type-info"
import { useInstallStore } from "@renderer/store/install"
import type { CatalogEntry } from "@renderer/types"

const CODEX = {
  name: "codex",
  label: "OpenAI Codex CLI",
  installed: true,
  homepage: "https://github.com/openai/codex",
  install: { macos: "npm i -g @openai/codex", linux: "npm i -g @openai/codex", requires: ["nodejs"] },
} as unknown as CatalogEntry

describe("SetupTypeInfo", () => {
  afterEach(() => useInstallStore.setState({ installed: [], updates: [] }))

  it("shows the installed version, where it runs and its links", () => {
    useInstallStore.setState({ installed: [{ name: "codex", version: "0.163.0", installedAt: "" }] })
    render(<SetupTypeInfo entry={CODEX} onOpenType={vi.fn()} />)

    expect(screen.getByText("v0.163.0")).toBeInTheDocument()
    expect(screen.getByText("macOS · Linux")).toBeInTheDocument()
    expect(screen.getByText("nodejs")).toBeInTheDocument()
    expect(screen.getByText("Homepage")).toBeInTheDocument()
    expect(screen.queryByTestId("setup-type-update")).not.toBeInTheDocument()
  })

  it("leads to the type's page for a pending update and for uninstall", async () => {
    useInstallStore.setState({ updates: [{ name: "codex", current: "0.163.0", latest: "0.166.0" }] })
    const onOpenType = vi.fn()
    render(<SetupTypeInfo entry={CODEX} onOpenType={onOpenType} />)

    await userEvent.click(screen.getByRole("button", { name: /Update to v0\.166\.0/ }))
    await userEvent.click(screen.getByTestId("setup-type-manage"))
    expect(onOpenType).toHaveBeenCalledTimes(2)
  })

  it("says a type not on this computer installs when added", () => {
    render(<SetupTypeInfo entry={{ ...CODEX, installed: false }} onOpenType={vi.fn()} />)

    expect(screen.getByText("Not installed — installs when added")).toBeInTheDocument()
    expect(screen.queryByTestId("setup-type-manage")).not.toBeInTheDocument()
  })
})
