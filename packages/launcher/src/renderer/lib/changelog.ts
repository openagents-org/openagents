/**
 * Release notes — the "What's new" the launcher shows once after an update.
 *
 * The source of truth is `packages/launcher/changelog/<version>.json`, one file
 * per version (see the README next to them for why, and for the format). They
 * are bundled at build time, so the notes work offline and can never describe a
 * version other than the one the user is running.
 *
 * The notes for a version that is *not installed yet* — what an offered update
 * would bring — cannot come from here for exactly that reason; main fetches
 * those off the update feed (see main/release-notes.ts). Both use the parser and
 * types in shared/changelog.ts, so the two describe a release identically.
 *
 * Not derived from the GitHub Release body: this is a monorepo, and that body
 * is generated from every PR since the last tag — mostly work in other packages
 * that means nothing to someone using the desktop app.
 */
import { compareVersions } from "../../shared/version-compare"
import { parseRelease, type Release } from "../../shared/changelog"

export {
  localized,
  type Bilingual,
  type Release,
  type ReleaseEntry,
  type ReleaseEntryType,
} from "../../shared/changelog"

const modules = import.meta.glob("../../../changelog/*.json", { eager: true })

/** Every release that has notes, newest first. */
export const RELEASES: Release[] = Object.values(modules)
  .map(parseRelease)
  .filter((r): r is Release => r !== null)
  .sort((a, b) => compareVersions(b.version, a.version) ?? 0)

/**
 * The notes for one version — and the only thing the after-update dialog ever
 * shows. Someone arriving from five versions back is told what the version they
 * are now running brings, not handed five releases at once: the announcement is
 * about the app in front of them. Settings → Updates keeps the whole history
 * for anyone who wants the rest.
 */
export function releaseFor(version: string | null): Release | null {
  if (!version) return null
  const target = version.replace(/^v/, "")
  return RELEASES.find((r) => r.version === target) ?? null
}
