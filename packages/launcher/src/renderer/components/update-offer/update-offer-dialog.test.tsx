import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { UpdaterState } from "../../types"
import { UpdateOfferDialog } from "./update-offer-dialog"

type Api = Record<string, ReturnType<typeof vi.fn>>

const AVAILABLE: UpdaterState = {
  status: "available",
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  percent: 0,
  bytesPerSecond: 0,
  releaseNotes: null,
  error: null,
  supported: true,
  downloadUrl: "https://example.com",
  installFailedVersion: null,
  autoDownload: false,
  pendingRelease: {
    version: "1.1.0",
    date: "2026-09-21",
    entries: [
      {
        type: "improvement",
        title: { en: "Quieter notifications", zh: "更安静的通知" },
      },
    ],
  },
}

let api: Api
let updaterEvent: ((state: UpdaterState) => void) | null = null

function mockApi(state: UpdaterState): void {
  updaterEvent = null
  api = {
    getUpdaterState: vi.fn().mockResolvedValue(state),
    onUpdaterEvent: vi.fn((cb: (state: UpdaterState) => void) => {
      updaterEvent = cb
      return () => {}
    }),
    downloadLauncherUpdate: vi.fn().mockResolvedValue(state),
    installLauncherUpdate: vi.fn().mockResolvedValue(true),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
  }
  ;(window as unknown as { api: Api }).api = api
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe("UpdateOfferDialog", () => {
  beforeEach(() => {
    mockApi(AVAILABLE)
  })

  it("offers each new version, and downloads only once accepted", async () => {
    const user = userEvent.setup()
    render(<UpdateOfferDialog />)

    await screen.findByText("Version 1.1.0 is available")
    // The question is "do you want this update?", so it has to say what the
    // update is — the notes main fetched for that exact version.
    expect(screen.getByText("Quieter notifications")).toBeTruthy()
    expect(api.downloadLauncherUpdate).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(api.downloadLauncherUpdate).toHaveBeenCalled())
    // Accepting must not silently flip the preference it was asked under.
    expect(api.setSetting).not.toHaveBeenCalled()
  })

  it("stays out of the way when downloads are automatic", async () => {
    mockApi({ ...AVAILABLE, autoDownload: true })
    render(<UpdateOfferDialog />)

    await settle()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("still asks when the release published no notes", async () => {
    mockApi({ ...AVAILABLE, pendingRelease: null })
    render(<UpdateOfferDialog />)

    await screen.findByText("Version 1.1.0 is available")
    expect(
      screen.getByText("Release notes for this version aren't available."),
    ).toBeTruthy()
  })

  it("waits for release notes before showing a new-version prompt", async () => {
    mockApi({ ...AVAILABLE, pendingRelease: null, pendingReleaseLoading: true })
    render(<UpdateOfferDialog />)

    await settle()
    expect(screen.queryByRole("dialog")).toBeNull()
    await act(async () => updaterEvent?.({ ...AVAILABLE, pendingReleaseLoading: false }))
    expect(screen.getByText("Quieter notifications")).toBeTruthy()
  })

  it("says nothing until an update is actually found", async () => {
    mockApi({ ...AVAILABLE, status: "idle", latestVersion: null })
    render(<UpdateOfferDialog />)

    await settle()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
