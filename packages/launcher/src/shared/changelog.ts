/**
 * The shape of a release's notes, and the parser for one.
 *
 * Lives in shared/ because both ends need it now: the renderer bundles
 * `changelog/*.json` at build time to tell the user what the version they just
 * installed brought (see renderer/lib/changelog.ts), and main fetches the notes
 * for a version that is *not installed yet* off the update feed, so a user can
 * read what an update contains before agreeing to it (see main/release-notes.ts).
 *
 * Both are the same file format, so they are the same parser.
 */

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

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function bilingual(raw: unknown): Bilingual | null {
  if (!raw || typeof raw !== "object") return null
  const { en, zh } = raw as Record<string, unknown>
  return isText(en) && isText(zh) ? { en, zh } : null
}

/**
 * Anything malformed is dropped rather than thrown: a bad changelog file must
 * never be able to stop the app from starting, and notes fetched off the
 * network must never be trusted to be well-formed at all. CI is what refuses to
 * ship a broken one (`scripts/check-changelog.mjs`), which is the right place
 * to be strict.
 */
export function parseRelease(raw: unknown): Release | null {
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
      {
        type: kind,
        title: heading,
        description: bilingual(description) ?? undefined,
      },
    ]
  })
  if (parsed.length === 0) return null

  return { version, date, entries: parsed }
}

/** Pick the language the user reads; en is the fallback, as in i18next. */
export function localized(text: Bilingual, language: string): string {
  return language.toLowerCase().startsWith("zh") ? text.zh : text.en
}
