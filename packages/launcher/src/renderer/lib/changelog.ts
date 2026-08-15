/**
 * Release notes — the "What's new" the launcher shows once after an update.
 *
 * The source of truth is `packages/launcher/changelog/<version>.json`, one file
 * per version (see the README next to them for why, and for the format). They
 * are bundled at build time, so the notes work offline and can never describe a
 * version other than the one the user is running.
 *
 * Not derived from the GitHub Release body: this is a monorepo, and that body
 * is generated from every PR since the last tag — mostly work in other packages
 * that means nothing to someone using the desktop app.
 */
import { compareVersions } from "../../shared/version-compare"

export type ReleaseEntryType = "feature" | "improvement" | "fix"

/** A string in both shipped languages; `localized` picks one. */
export interface Bilingual {
  en: string
  zh: string
}

/**
 * One line of a release. `title` is the change in a few words and carries the
 * emphasis; `description` is the detail, and is optional because some changes
 * genuinely are one line.
 */
export interface ReleaseEntry {
  type: ReleaseEntryType
  title: Bilingual
  description?: Bilingual
}

export interface Release {
  version: string
  date: string
  entries: ReleaseEntry[]
}

const ENTRY_TYPES: ReleaseEntryType[] = ["feature", "improvement", "fix"]

const modules = import.meta.glob("../../../changelog/*.json", { eager: true })

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

/**
 * Anything malformed is dropped rather than thrown: a bad changelog file must
 * never be able to stop the app from starting. CI is what refuses to ship one
 * (`scripts/check-changelog.mjs`), which is the right place to be strict.
 */
function bilingual(raw: unknown): Bilingual | null {
  if (!raw || typeof raw !== "object") return null
  const { en, zh } = raw as Record<string, unknown>
  return isText(en) && isText(zh) ? { en, zh } : null
}

function parseRelease(raw: unknown): Release | null {
  const r = (raw as { default?: unknown })?.default ?? raw
  if (!r || typeof r !== "object") return null
  const { version, date, entries } = r as Record<string, unknown>
  if (!isText(version) || !isText(date) || !Array.isArray(entries)) return null

  const parsed = entries.flatMap((e): ReleaseEntry[] => {
    if (!e || typeof e !== "object") return []
    const { type, title, description } = e as Record<string, unknown>
    const heading = bilingual(title)
    if (!heading) return []
    const kind = ENTRY_TYPES.find((k) => k === type) ?? "improvement"
    return [
      { type: kind, title: heading, description: bilingual(description) ?? undefined },
    ]
  })
  if (parsed.length === 0) return null

  return { version, date, entries: parsed }
}

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

/** Pick the language the user reads; en is the fallback, as in i18next. */
export function localized(text: Bilingual, language: string): string {
  return language.toLowerCase().startsWith("zh") ? text.zh : text.en
}
