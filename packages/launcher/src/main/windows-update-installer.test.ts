import { describe, it, expect, vi } from "vitest"
import { EventEmitter } from "events"
import type { spawn as spawnType } from "child_process"

import {
  encodedElevatedHandoffCommand,
  hasNonAsciiPathSegment,
  launchWindowsUpdateInstaller,
} from "./windows-update-installer"

const INSTALLER = "C:\\ProgramData\\OpenAgents\\updater-cache\\pending\\update.exe"

/**
 * Minimal ChildProcess stand-in. `script` decides what the "process" does:
 * stay alive, exit with a code, or fail to spawn at all.
 */
function fakeSpawn(
  script: (call: number) => { exit?: number; error?: NodeJS.ErrnoException },
): {
  spawn: typeof spawnType
  calls: Array<{ command: string; args: string[] }>
} {
  const calls: Array<{ command: string; args: string[] }> = []
  const spawn = vi.fn((command: string, args: string[]) => {
    const call = calls.length
    calls.push({ command, args })
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = (): void => {}
    const outcome = script(call)
    if (outcome.error) queueMicrotask(() => child.emit("error", outcome.error))
    else if (outcome.exit !== undefined)
      queueMicrotask(() => child.emit("exit", outcome.exit))
    return child
  })
  return { spawn: spawn as unknown as typeof spawnType, calls }
}

describe("hasNonAsciiPathSegment", () => {
  it("flags a Chinese Windows profile path", () => {
    expect(
      hasNonAsciiPathSegment("C:\\Users\\张三\\AppData\\Local\\app\\update.exe"),
    ).toBe(true)
    expect(hasNonAsciiPathSegment(INSTALLER)).toBe(false)
  })
})

describe("encodedElevatedHandoffCommand", () => {
  it("encodes the script as UTF-16LE base64 and keeps the path out of it", () => {
    const decoded = Buffer.from(
      encodedElevatedHandoffCommand(),
      "base64",
    ).toString("utf16le")
    expect(decoded).toContain("Start-Process")
    expect(decoded).toContain("-Verb RunAs")
    expect(decoded).toContain("$env:OPENAGENTS_UPDATE_INSTALLER")
    // The installer path travels in the environment block, never the command.
    expect(decoded).not.toContain("C:\\")
  })
})

describe("launchWindowsUpdateInstaller", () => {
  it("reports success once the installer outlives the probe window", async () => {
    const { spawn, calls } = fakeSpawn(() => ({}))
    const result = await launchWindowsUpdateInstaller(INSTALLER, () => {}, spawn, 5)
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe(INSTALLER)
    expect(calls[0].args).toEqual(["--updated", "--force-run"])
  })

  it("treats a clean exit inside the window as a handoff", async () => {
    const { spawn } = fakeSpawn(() => ({ exit: 0 }))
    const result = await launchWindowsUpdateInstaller(INSTALLER, () => {}, spawn, 5)
    expect(result.ok).toBe(true)
  })

  it("escalates through UAC when Windows demands elevation", async () => {
    const elevationError: NodeJS.ErrnoException = new Error("spawn UNKNOWN")
    elevationError.code = "UNKNOWN"
    const { spawn, calls } = fakeSpawn((call) =>
      call === 0 ? { error: elevationError } : { exit: 0 },
    )
    const result = await launchWindowsUpdateInstaller(INSTALLER, () => {}, spawn, 5)
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1].command).toBe("powershell.exe")
    expect(calls[1].args).toContain("-EncodedCommand")
  })

  it("fails — rather than reporting a launch — when the elevated retry is refused", async () => {
    const elevationError: NodeJS.ErrnoException = new Error("spawn EACCES")
    elevationError.code = "EACCES"
    const { spawn } = fakeSpawn((call) =>
      // 1223 is ERROR_CANCELLED: the user dismissed the UAC prompt.
      call === 0 ? { error: elevationError } : { exit: 1223 },
    )
    const result = await launchWindowsUpdateInstaller(INSTALLER, () => {}, spawn, 5)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("1223")
  })

  it("does not retry elevated when the executable is simply missing", async () => {
    const missing: NodeJS.ErrnoException = new Error("spawn ENOENT")
    missing.code = "ENOENT"
    const { spawn, calls } = fakeSpawn(() => ({ error: missing }))
    const result = await launchWindowsUpdateInstaller(INSTALLER, () => {}, spawn, 5)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it("retries elevated when the installer dies on the spot", async () => {
    const { spawn, calls } = fakeSpawn((call) =>
      call === 0 ? { exit: 1 } : { exit: 0 },
    )
    const result = await launchWindowsUpdateInstaller(INSTALLER, () => {}, spawn, 5)
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
  })
})
