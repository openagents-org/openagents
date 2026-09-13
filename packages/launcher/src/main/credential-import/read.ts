/**
 * Reading other tools' config files, defensively.
 *
 * None of these files are ours. Their shape is whatever the installed version
 * of that tool writes, so every accessor here answers "nothing" rather than
 * throwing when a value is missing or has changed type.
 */
import fs from "node:fs"

/** What a reader needs to know about this machine. */
export interface ReadContext {
  home: string
  /** Process + login-shell env: config-dir overrides and key references. */
  env: Record<string, string | undefined>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/** A string value, trimmed, or "" for anything else. */
export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/** A nested record by path, or {} when any step is missing. */
export function dig(
  value: unknown,
  ...keys: string[]
): Record<string, unknown> {
  let at = value
  for (const key of keys) at = isRecord(at) ? at[key] : undefined
  return isRecord(at) ? at : {}
}

/** The string-valued entries of a record. */
export function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(isRecord(value) ? value : {}))
    if (typeof v === "string") out[k] = v
  return out
}

export function compact<T>(items: Array<T | null | undefined>): T[] {
  return items.filter((item): item is T => item != null)
}

/** A file's text, or null when it is missing or unreadable. */
export function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8")
  } catch {
    return null
  }
}

/**
 * A JSON config, tolerating what hand-edited ones carry — `//` and block
 * comments, trailing commas (OpenCode's `opencode.jsonc`). Null for a missing
 * or unparseable file: a config we cannot read offers nothing.
 */
export function readJson(file: string): unknown {
  const text = readText(file)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    try {
      return JSON.parse(stripJsonNoise(text))
    } catch {
      return null
    }
  }
}

/** Comments and trailing commas out, string literals left alone. */
function stripJsonNoise(text: string): string {
  let out = ""
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === "\\") out += text[++i] ?? ""
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end < 0 ? text.length : end + 1
    } else {
      out += ch
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

/**
 * A config value that may name an environment variable instead of holding the
 * key: OpenCode's `{env:VAR}`, or a bare `VAR_NAME` (OpenClaw, Pi). Resolved
 * against the environment; empty when that variable is unset.
 */
export function resolveEnvRef(
  value: unknown,
  env: Record<string, string | undefined>,
): string {
  const v = str(value)
  const ref =
    /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(v)?.[1] ??
    (/^[A-Z][A-Z0-9_]*$/.test(v) ? v : null)
  return ref ? str(env[ref]) : v
}
