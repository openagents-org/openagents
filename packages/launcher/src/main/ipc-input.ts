/**
 * Input checks for the IPC surface.
 *
 * There are ~120 `ipcMain.handle` entries and none of them validated what the
 * renderer sent — every handler trusted its arguments to be the type the
 * signature claimed. Today that holds: the renderer only ever loads local
 * content behind contextIsolation. But "the renderer is trustworthy" is the
 * single assumption keeping paths and shell commands honest, and it is not
 * written down anywhere or enforced at the boundary.
 *
 * These are deliberately thin. The goal is that a malformed argument fails at
 * the edge with a clear message instead of reaching `mkdirSync` or a terminal,
 * not to re-type the whole API.
 */

/** Characters that end an argument early and start something else. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function fail(field: string, why: string): never {
  throw new Error(`Invalid ${field}: ${why}`)
}

export function asString(
  value: unknown,
  field: string,
  opts: { max?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") fail(field, `expected a string`)
  const text = value as string
  if (!opts.allowEmpty && !text.trim()) fail(field, "must not be empty")
  const max = opts.max ?? 4096
  if (text.length > max) fail(field, `longer than ${max} characters`)
  return text
}

/**
 * A filesystem path from the renderer. NUL truncates a path inside libuv, and
 * newlines are never legitimate here — both are how a benign-looking string
 * turns into a different path than the one shown to the user.
 */
export function asPath(value: unknown, field: string): string {
  const text = asString(value, field, { max: 4096 }).trim()
  if (CONTROL_CHARS.test(text)) fail(field, "contains control characters")
  return text
}

/**
 * A command handed to a terminal. Running one is the point of the API, so this
 * cannot restrict *which* command — but a newline in a `cmd /K "…"` string is a
 * second command the caller never asked for, and that it can reject.
 */
export function asShellCommand(value: unknown, field: string): string {
  const text = asString(value, field, { max: 2048 })
  if (CONTROL_CHARS.test(text)) fail(field, "contains control characters")
  return text
}

/** An agent / workspace name. Free-form (people use spaces and Chinese), so
 *  this only rejects what can't be a name: control characters and absurd
 *  lengths. */
export function asName(value: unknown, field: string): string {
  const text = asString(value, field, { max: 256 }).trim()
  if (CONTROL_CHARS.test(text)) fail(field, "contains control characters")
  return text
}
