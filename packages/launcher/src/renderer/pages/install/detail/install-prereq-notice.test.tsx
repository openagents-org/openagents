import React from "react"
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import type { PrereqRemedy } from "@renderer/types"

import { InstallPrereqNotice } from "./install-prereq-notice"

/**
 * The remedies are written by the core, which ships no translations, so this
 * card looks its prose up by the keys the core sends and keeps the English as
 * a fallback. The label over the alternative command is what forced that: it
 * was hardcoded to Homebrew, so a Windows user reading the only screen that
 * can unblock their install was told "Or, if you use Homebrew:" above a
 * command Homebrew has never heard of — on a platform Homebrew does not run
 * on at all.
 */
function remedy(over: Partial<PrereqRemedy> = {}): PrereqRemedy {
  return {
    name: "uv",
    action: null,
    summaryKey: "uv",
    summary: "uv is required to install this agent (it is a Python tool).",
    command: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    alternative: "brew install uv",
    alternativeKind: "homebrew",
    ...over,
  }
}

describe("InstallPrereqNotice", () => {
  it("names the tool the alternative command actually uses", () => {
    render(
      <InstallPrereqNotice
        missing={[
          remedy({
            command: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
            alternative: "winget install --id=astral-sh.uv -e",
            alternativeKind: "winget",
          }),
        ]}
      />,
    )

    expect(screen.getByText("Or, with winget:")).toBeTruthy()
    expect(screen.queryByText(/Homebrew/)).toBeNull()
  })

  it("still says Homebrew where Homebrew is what is offered", () => {
    render(<InstallPrereqNotice missing={[remedy()]} />)

    expect(screen.getByText("Or, if you use Homebrew:")).toBeTruthy()
  })

  it("translates the summary through the key rather than printing the core's English", () => {
    render(<InstallPrereqNotice missing={[remedy({ summary: "raw English from the core" })]} />)

    expect(
      screen.getByText("uv is required to install this agent (it is a Python tool)."),
    ).toBeTruthy()
    expect(screen.queryByText("raw English from the core")).toBeNull()
  })

  it("falls back to the core's own wording for a remedy it has no strings for", () => {
    // Both the older core the launcher may still be pinned to (no keys at all)
    // and a newer one that grows a dependency this build has never heard of.
    render(
      <InstallPrereqNotice
        missing={[
          remedy({
            name: "podman",
            summaryKey: undefined,
            summary: "Podman is required to install this agent.",
            command: "brew install podman",
            alternative: "sudo dnf install podman",
            alternativeKind: undefined,
          }),
        ]}
      />,
    )

    expect(screen.getByText("Podman is required to install this agent.")).toBeTruthy()
    expect(screen.getByText("Or:")).toBeTruthy()
  })
})
