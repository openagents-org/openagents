import fs from "fs"
import path from "path"
import { app, safeStorage } from "electron"

/**
 * The signed-in account, as this machine remembers it.
 *
 * Two shapes of credential can end up here and the rest of the app treats them
 * identically — both are the `Authorization: Bearer` value the workspace API
 * accepts as an identity:
 *
 *  - `workspace`: a session JWT minted by POST /v1/auth/session. Long-lived
 *    (30 days) and obtained without ever contacting Google, which is the only
 *    path that works from mainland China. This is the one we ask for.
 *  - `firebase`: a Firebase ID token plus its refresh token, used only where
 *    the backend has no session secret configured. Expires hourly and is
 *    renewed in the background (see firebase-rest.ts).
 */
export interface AccountSession {
  kind: "workspace" | "firebase"
  token: string
  email: string
  displayName: string | null
  /** Unix seconds. */
  expiresAt: number
  /** Firebase only — what the hourly renewal is done with. */
  refreshToken?: string
}

/** What the renderer is told about the account; never the token itself. */
export interface AccountInfo {
  email: string
  displayName: string | null
  expiresAt: number
}

const FILE = "account.json"

interface FileShape {
  version: 1
  /** Cleartext session, or absent when `encrypted` holds it instead. */
  session?: AccountSession
  /** safeStorage-wrapped JSON of the session (OPENAGENTS_USE_KEYCHAIN=1). */
  encrypted?: string
}

function filePath(): string {
  return path.join(app.getPath("userData"), FILE)
}

/**
 * Whether to wrap the session with the OS keychain.
 *
 * Off by default, for the reason spelled out at length in connections-store:
 * safeStorage's keychain ACL is bound to the binary's code signature, so macOS
 * re-prompts after every Electron upgrade and a denied prompt would lock the
 * user out of their own account. A 0600 file next to the workspace token that
 * `~/.openagents/node.json` already keeps in cleartext is the same exposure,
 * and it cannot brick a sign-in.
 */
function useKeychain(): boolean {
  if (process.env.OPENAGENTS_USE_KEYCHAIN !== "1") return false
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function loadSession(): AccountSession | null {
  try {
    const file = filePath()
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as FileShape
    if (parsed.encrypted) {
      const json = safeStorage.decryptString(
        Buffer.from(parsed.encrypted, "base64"),
      )
      return JSON.parse(json) as AccountSession
    }
    return parsed.session ?? null
  } catch (err) {
    // A session we cannot read is a session the user has to establish again —
    // never a reason to fail startup.
    console.error("Failed to read account.json:", (err as Error).message)
    return null
  }
}

export function saveSession(session: AccountSession): void {
  const file = filePath()
  const payload: FileShape = { version: 1 }
  if (useKeychain()) {
    try {
      payload.encrypted = safeStorage
        .encryptString(JSON.stringify(session))
        .toString("base64")
    } catch (err) {
      console.error(
        "safeStorage encrypt failed; storing the session unwrapped:",
        (err as Error).message,
      )
      payload.session = session
    }
  } else {
    payload.session = session
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    /* best effort — Windows has no mode bits */
  }
}

export function clearSession(): void {
  try {
    fs.rmSync(filePath(), { force: true })
  } catch (err) {
    console.error("Failed to clear account.json:", (err as Error).message)
  }
}

export function toAccountInfo(session: AccountSession): AccountInfo {
  return {
    email: session.email,
    displayName: session.displayName,
    expiresAt: session.expiresAt,
  }
}

/** True while the token is still worth sending (one minute of slack). */
export function isFresh(session: AccountSession, now = Date.now()): boolean {
  return session.expiresAt - 60 > now / 1000
}
