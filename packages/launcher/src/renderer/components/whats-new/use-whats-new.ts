import { useCallback, useEffect, useState } from "react"

import { releasesSince, type Release } from "@renderer/lib/changelog"

/**
 * Last version whose notes the user actually saw. Under the `launcher:` prefix
 * so "Reset appearance & interface state" clears it too — which is the right
 * outcome: a cleared record reads as a fresh install and announces nothing.
 */
export const SEEN_KEY = "launcher:last-seen-release"

export interface WhatsNewApi {
  open: boolean
  releases: Release[]
  close: () => void
}

function read(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

function remember(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    /* Private mode — the dialog just opens again next launch. */
  }
}

/**
 * Opens the release notes once, on the first launch after an update.
 *
 * A fresh install announces nothing: someone who has never seen this app does
 * not need to be told what changed in it. That case is recorded silently, so
 * their *next* update is the first thing they hear about.
 */
export function useWhatsNew(): WhatsNewApi {
  const [open, setOpen] = useState(false)
  const [releases, setReleases] = useState<Release[]>([])
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api
      .appVersion()
      .catch(() => null)
      .then((version) => {
        if (cancelled || !version) return
        setVersion(version)
        const seen = read()
        if (!seen) {
          remember(version)
          return
        }
        const pending = releasesSince(seen, version)
        // Nothing to say — an update with no notes, or a downgrade. Move the
        // marker anyway so it tracks the running version.
        if (pending.length === 0) {
          remember(version)
          return
        }
        setReleases(pending)
        setOpen(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Recorded on close rather than on open: a window closed by a crash before
  // the user read anything should still show the notes next time. The *running*
  // version is what gets stored, not the newest release with notes — otherwise
  // a version that shipped without any would be re-evaluated on every launch.
  const close = useCallback(() => {
    setOpen(false)
    if (version) remember(version)
  }, [version])

  return { open, releases, close }
}
