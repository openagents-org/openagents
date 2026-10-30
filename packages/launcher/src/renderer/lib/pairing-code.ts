/**
 * Workspace pairing codes, as the user types them.
 *
 * The workspace prints an 8-character code as XXXX-XXXX (alphabet excludes
 * 0/O/1/I/L). Both places that accept one — onboarding's "connect this device"
 * step and the Workspaces quick-connect dialog — format while typing and
 * normalize before sending, so they share the rules here.
 */

export const PAIRING_CODE_LENGTH = 8

/** Uppercase, drop separators — so a pasted "yaj8-966m" is accepted as typed. */
export function normalizeCode(raw: string): string {
  return (raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PAIRING_CODE_LENGTH)
}

/** Group into fours while typing, matching how the workspace prints the code. */
export function formatCode(raw: string): string {
  const c = normalizeCode(raw)
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c
}

/**
 * Electron wraps a rejected handler as
 * `Error invoking remote method 'node:connect': Error: Invalid pairing code`.
 * Strip both frames so the user reads the workspace's own message.
 */
export function cleanIpcError(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim()
}
