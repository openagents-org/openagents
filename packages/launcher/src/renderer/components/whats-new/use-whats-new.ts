import { useCallback, useEffect, useState } from "react"

import { releaseFor, type Release } from "@renderer/lib/changelog"
import { isUpgradeAvailable } from "../../../shared/version-compare"

/**
 * Last version whose notes the user actually saw.
 *
 * Kept in main's settings.json rather than the renderer's localStorage: which
 * release someone has read is not appearance state, and under the `launcher:`
 * prefix it used to be wiped by "Reset appearance & interface state" — after
 * which the app would replay notes the user had already dismissed.
 */
const SEEN_SETTING = "lastSeenRelease"

/**
 * Where 0.9.9 kept the same marker. Read once, so that build's users are not
 * re-told what it announced. Only ever holds "0.9.9", and only for a profile
 * that ran it — which is exactly what it is used as.
 */
export const LEGACY_SEEN_KEY = "launcher:last-seen-release"

export interface WhatsNewApi {
  open: boolean
  releases: Release[]
  close: () => void
}

function readLegacy(): string | null {
  try {
    return localStorage.getItem(LEGACY_SEEN_KEY)
  } catch {
    return null
  }
}

async function readSeen(): Promise<string | null> {
  const stored = await window.api.getSetting(SEEN_SETTING).catch(() => null)
  if (typeof stored === "string" && stored.trim()) return stored
  return readLegacy()
}

function remember(version: string): void {
  // Failure here costs a duplicate dialog next launch, nothing worse.
  void window.api.setSetting(SEEN_SETTING, version).catch(() => {})
}

/**
 * Whether this launch follows an update — the question the dialog turns on.
 *
 * With a marker it is a version comparison. Without one it comes down to the
 * profile: an existing one belongs to a build too old to have written a marker
 * (≤0.9.9), so this launch is an update; a new one is a fresh install.
 *
 * `null` means the profile could not be asked. Deliberately not folded into
 * `false`: the caller records the running version whenever it decides there is
 * nothing to announce, so treating one failed IPC as "fresh install" would cost
 * that user their notes for good. Unknown is a reason to try again next launch,
 * not to conclude anything.
 */
async function isFirstLaunchAfterUpdate(
  seen: string | null,
  current: string,
): Promise<boolean | null> {
  if (seen) return isUpgradeAvailable(seen, current)
  return window.api.hasRunBefore().catch(() => null)
}

/**
 * Opens the release notes once, on the first launch after an update — and only
 * ever for the version now running. Someone who skipped five versions gets the
 * one they landed on, not five sets of notes in a row; the rest stay in
 * Settings → Updates for anyone who goes looking.
 *
 * A fresh install is told nothing: someone who has never run the app does not
 * need to be told what changed in it. That case is recorded silently, so their
 * *next* update is the first thing they hear about.
 *
 * 0.9.9 could not tell those two apart — it had no record of its own to go on,
 * so everyone who updated into it looked like a fresh install and the feature
 * announced itself to nobody.
 */
export function useWhatsNew(): WhatsNewApi {
  const [open, setOpen] = useState(false)
  const [releases, setReleases] = useState<Release[]>([])
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const current = await window.api.appVersion().catch(() => null)
      if (cancelled || !current) return
      setVersion(current)

      const seen = await readSeen()
      if (cancelled) return

      const updated = await isFirstLaunchAfterUpdate(seen, current)
      if (cancelled) return
      // Could not tell. Leave the marker alone and ask again next launch —
      // recording anything here would answer the question permanently, and in
      // the wrong direction.
      if (updated === null) return

      const release = updated ? releaseFor(current) : null
      // Nothing to say — a fresh install, a downgrade, or a version that
      // shipped without notes. Move the marker anyway so it tracks the running
      // version, and this is not re-evaluated on every launch.
      if (!release) {
        remember(current)
        return
      }
      setReleases([release])
      setOpen(true)
    })()

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
