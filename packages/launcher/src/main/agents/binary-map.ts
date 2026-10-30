import { DUAL_LOGIN_AGENTS, HOSTED_LOGIN_AGENTS } from "./auth-specs"

/** The binary token of a command string: "claude auth login" → "claude". */
export function firstToken(cmd: unknown): string {
  return typeof cmd === "string" ? cmd.trim().split(/\s+/)[0] || "" : ""
}

/**
 * Every CLI binary name we know, mapped to the agent type that owns it.
 *
 * Derived from the registry — `install.binary`, its `binary_aliases`, and the
 * leading token of `check_ready.login_command` — plus the launcher's own login
 * specs, whose command can differ from the registry's (Claude is `claude auth
 * login` here and `claude login` there).
 *
 * This replaced a hand-written six-entry object. That object covered
 * cursor/hermes/claude/amp/gemini and silently did nothing for everything else,
 * codex included — which is how `codex login` reached a Windows terminal as a
 * bare command and died with "'codex' is not recognized", even though the
 * launcher had the CLI's absolute path in hand at that exact moment. Deriving
 * the map means an agent added to the registry is covered the day it lands.
 *
 * `install.binary` is registered for every entry BEFORE any alias or login
 * token, so a name that is one agent's binary and another's alias resolves to
 * the agent that owns it outright.
 */
export function buildBinaryTypeMap(
  entries: Array<Record<string, unknown>>,
): Map<string, string> {
  const map = new Map<string, string>()
  const add = (name: unknown, type: string): void => {
    const key = String(name || "")
      .trim()
      .toLowerCase()
    if (key && !map.has(key)) map.set(key, type)
  }
  const installOf = (entry: Record<string, unknown>): Record<string, unknown> =>
    (entry.install || {}) as Record<string, unknown>

  for (const entry of entries) {
    const type = typeof entry.name === "string" ? entry.name : ""
    if (type) add(installOf(entry).binary || type, type)
  }
  for (const entry of entries) {
    const type = typeof entry.name === "string" ? entry.name : ""
    if (!type) continue
    const aliases = installOf(entry).binary_aliases
    for (const alias of Array.isArray(aliases) ? aliases : []) add(alias, type)
    const checkReady = (entry.check_ready || {}) as Record<string, unknown>
    add(firstToken(checkReady.login_command), type)
  }
  for (const [type, spec] of [
    ...Object.entries(HOSTED_LOGIN_AGENTS),
    ...Object.entries(DUAL_LOGIN_AGENTS),
  ])
    add(firstToken(spec.loginCommand), type)
  return map
}
