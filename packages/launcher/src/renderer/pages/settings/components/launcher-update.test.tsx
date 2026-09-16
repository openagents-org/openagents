import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { UpdaterState } from "@renderer/types"
import { LauncherUpdate } from "./launcher-update"

const DOWNLOADED: UpdaterState = {
  status: "downloaded",
  currentVersion: "1.0.2",
  latestVersion: "1.1.0",
  percent: 100,
  bytesPerSecond: 0,
  releaseNotes: null,
  error: null,
  supported: true,
  downloadUrl: "https://example.com/download",
  installFailedVersion: null,
  installDirectory: "C:\\Users\\tester\\AppData\\Local\\Programs\\OpenAgents",
}

describe("LauncherUpdate — Windows install location", () => {
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {
      platform: "win32",
      selectDirectory: vi.fn().mockResolvedValue("D:\\OpenAgents"),
      openExternal: vi.fn(),
    }
  })

  it("lets the user choose another drive before installing", async () => {
    const user = userEvent.setup()
    const onInstall = vi.fn()
    render(
      <LauncherUpdate
        state={DOWNLOADED}
        currentVersion="1.0.2"
        onCheck={() => {}}
        onDownload={() => {}}
        onInstall={onInstall}
      />,
    )

    expect(screen.getByText("Install location")).toBeInTheDocument()
    expect(screen.getByText(DOWNLOADED.installDirectory!)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Browse…" }))
    await waitFor(() => expect(screen.getByText("D:\\OpenAgents")).toBeInTheDocument())
    await user.click(screen.getByRole("button", { name: "Restart & install" }))

    expect(onInstall).toHaveBeenCalledWith("D:\\OpenAgents")
  })
})
