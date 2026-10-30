/**
 * Env assignments out of text a person pasted or a tool wrote: a `.env` file,
 * shell `export K=V`, PowerShell `$env:K = "V"`, cmd `set K=V`, or JSON — flat,
 * or shaped like Claude Code's settings with an `env` block. Values come back as
 * written; nothing here decides what they mean.
 */
import { isRecord, stringRecord } from "./read"

const ASSIGNMENT =
  /^\s*(?:export\s+|set\s+|\$env:)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/i
const JSON_PAIR = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g

export function parseEnvText(text: string): Record<string, string> {
  const json = parseJsonEnv(text)
  if (json) return json
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = ASSIGNMENT.exec(line)
    if (m) {
      env[m[1]] = unquote(m[2])
      continue
    }
    // Lines copied out of the middle of a JSON settings file, which do not
    // parse on their own.
    for (const pair of line.matchAll(JSON_PAIR)) env[pair[1]] = pair[2]
  }
  return env
}

function parseJsonEnv(text: string): Record<string, string> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed)) return null
    return stringRecord(isRecord(parsed.env) ? parsed.env : parsed)
  } catch {
    return null
  }
}

/** `"v"`, `'v'`, or a bare value that may end in a ` # comment`. */
function unquote(raw: string): string {
  const quote = raw[0]
  if (quote === '"' || quote === "'") {
    const end = raw.lastIndexOf(quote)
    if (end > 0) return raw.slice(1, end)
  }
  return raw.replace(/\s+#.*$/, "")
}
