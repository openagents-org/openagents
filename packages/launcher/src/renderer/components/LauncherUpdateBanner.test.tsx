import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"

import { useUiStore } from "@renderer/store/ui"
import type { UpdaterState } from "../types"
import { LauncherUpdateBanner } from "./LauncherUpdateBanner"

const BASE: UpdaterState = {
  status: "downloading",
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  percent: 40,
  bytesPerSecond: 0,
  releaseNotes: null,
  error: null,
  supported: true,
  downloadUrl: "https://example.com",
  installFailedVersion: null,
  pendingRelease: null,
  autoDownload: true,
}

function mount(state: UpdaterState): void {
  ;(window as unknown as { api: Record<string, ReturnType<typeof vi.fn>> }).api = {
    getUpdaterState: vi.fn().mockResolvedValue(state),
    onUpdaterEvent: vi.fn().mockReturnValue(() => {}),
    downloadLauncherUpdate: vi.fn().mockResolvedValue(state),
    installLauncherUpdate: vi.fn().mockResolvedValue(true),
  }
  render(<LauncherUpdateBanner />)
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe("LauncherUpdateBanner", () => {
  beforeEach(() => {
    useUiStore.setState({ updateBannerDismissed: null, updatePromptOpen: false })
  })

  it("reports a download that automatic updates started", async () => {
    mount(BASE)
    await settle()
    expect(screen.getByText(/1\.1\.0/)).toBeTruthy()
  })

  it("stays away entirely when automatic downloads are off — the prompt does the asking", async () => {
    mount({ ...BASE, status: "available", autoDownload: false })
    await settle()
    expect(screen.queryByText(/1\.1\.0/)).toBeNull()
  })

  it("keeps quiet behind the prompt", async () => {
    useUiStore.setState({ updatePromptOpen: true })
    mount(BASE)
    await settle()
    expect(screen.queryByText(/1\.1\.0/)).toBeNull()
  })
})
