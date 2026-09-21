// ── Notes for a version the user hasn't installed yet ──
//
// "There is an update" is not, on its own, something anyone can make a decision
// about. What it changes is — and the launcher had no way to say: the bundled
// `changelog/*.json` only ever describes the running build, and the update feed
// is a `generic` provider (R2), whose latest.yml carries no releaseNotes field
// at all (the GitHub provider's would). So `UpdateInfo.releaseNotes` is always
// null and the offer was a bare version number.
//
// CI now publishes each release's notes file beside the installers as
// `release-notes-<version>.json` — the very same file the app bundles for its
// own version, so nothing has to be written twice and the two render
// identically. This fetches it for the offered version.
//
// Every failure is silent and non-fatal: an update whose notes can't be reached
// (offline, a mirror that predates this, an older release that never published
// one) still offers itself, just without the detail.
import { parseRelease, type Release } from "../shared/changelog"

/** The GitHub Release the same assets are uploaded to, used as a fallback. */
const GITHUB_RELEASE_BASE =
  "https://github.com/openagents-org/openagents/releases/download"

/** Notes are a few KB of JSON; anything slower than this is not worth waiting for. */
const TIMEOUT_MS = 8000

export function releaseNotesFileName(version: string): string {
  return `release-notes-${version.replace(/^v/, "")}.json`
}

/**
 * Where to look, in order: the update feed itself (so a mirror set in Settings
 * serves the notes too, from the same origin the installer comes from), then
 * the GitHub Release the CI upload is canonical in.
 */
export function releaseNotesUrls(version: string, feedBase: string): string[] {
  const file = releaseNotesFileName(version)
  const clean = feedBase.replace(/\/+$/, "")
  const tag = `launcher-v${version.replace(/^v/, "")}`
  return [`${clean}/${file}`, `${GITHUB_RELEASE_BASE}/${tag}/${file}`]
}

async function fetchOne(url: string): Promise<Release | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" })
    if (!res.ok) return null
    return parseRelease(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The notes for `version`, or null when they cannot be had. Only notes that
 * actually describe the version we asked about are returned — a stale file left
 * on a mirror would otherwise tell the user about the wrong release.
 */
export async function fetchReleaseNotes(
  version: string,
  feedBase: string,
  log: (msg: string) => void = () => {},
): Promise<Release | null> {
  const want = version.replace(/^v/, "")
  for (const url of releaseNotesUrls(want, feedBase)) {
    const release = await fetchOne(url)
    if (!release) continue
    if (release.version.replace(/^v/, "") !== want) {
      log(`[updater] ignoring release notes for v${release.version} at ${url}`)
      continue
    }
    log(`[updater] fetched release notes for v${want}`)
    return release
  }
  log(`[updater] no release notes published for v${want}`)
  return null
}
