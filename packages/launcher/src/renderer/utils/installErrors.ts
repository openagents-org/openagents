const STACK_LINE_RE = /^\s*at\s+|\(.+:\d+:\d+\)|\b[A-Za-z]:\\.*:\d+:\d+/

function firstUsefulLine(message: string): string {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !STACK_LINE_RE.test(line) && !line.startsWith("Command:")) || ""
}

export function installErrorMessage(error: unknown, fallback = "The installer stopped before it could finish."): string {
  let raw =
    error instanceof Error ? error.message
    : typeof error === "string" ? error
    : ""
  const ipcWrapped = raw.match(/Error invoking remote method '[^']+': Error: ([\s\S]+)/)
  if (ipcWrapped) raw = ipcWrapped[1]
  const line = firstUsefulLine(raw)
  if (!line) return fallback
  if (/^Error (occurred in handler|invoking remote method)/i.test(line)) return fallback
  return line
}

export function throwIfInstallFailed(result: unknown): void {
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    (result as { success?: unknown }).success === false
  ) {
    throw new Error(
      typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : "The installer stopped before it could finish.",
    )
  }
}
