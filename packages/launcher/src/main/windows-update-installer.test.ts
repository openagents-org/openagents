import { describe, it, expect, vi } from "vitest"
import { EventEmitter } from "events"
import type { spawn as spawnType } from "child_process"

import {
  encodedInstallerHandoffCommand,
  hasNonAsciiPathSegment,
  launchWindowsUpdateInstaller,
} from "./windows-update-installer"

const INSTALLER = "C:\\ProgramData\\OpenAgents\\updater-cache\\pending\\update.exe"

function fakeSpawn(
  outcome: { exit?: number; error?: NodeJS.ErrnoException },
): {
  spawn: typeof spawnType
  calls: Array<{
    command: string
    args: string[]
    options: Parameters<typeof spawnType>[2]
  }>
} {
  const calls: Array<{
    command: string
    args: string[]
    options: Parameters<typeof spawnType>[2]
  }> = []
  const spawn = vi.fn((command: string, args: string[], options: Parameters<typeof spawnType>[2]) => {
    calls.push({ command, args, options })
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = (): void => {}
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

describe("encodedInstallerHandoffCommand", () => {
  it("waits for the app, starts NSIS, and keeps /D last", () => {
    const decoded = Buffer.from(
      encodedInstallerHandoffCommand(),
      "base64",
    ).toString("utf16le")
    expect(decoded).toContain("Get-Process -Id $parentPid")
    expect(decoded).toContain("Start-Process -FilePath $installer")
    expect(decoded).toContain('$installerArgs += "/D=$installDir"')
    expect(decoded.indexOf("--force-run")).toBeLessThan(decoded.indexOf("/D="))
    expect(decoded).not.toContain("C:\\")
  })
})

describe("launchWindowsUpdateInstaller", () => {
  it("starts a detached handoff and passes Unicode-safe values via env", async () => {
    const { spawn, calls } = fakeSpawn({})
    const installDirectory = "D:\\应用\\OpenAgents"
    const result = await launchWindowsUpdateInstaller(
      INSTALLER,
      { parentPid: 4321, installDirectory },
      () => {},
      spawn,
      5,
    )
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe("powershell.exe")
    expect(calls[0].args).toContain("-EncodedCommand")
    expect(calls[0].options).toMatchObject({ detached: true, windowsHide: true })
    expect(calls[0].options?.env).toMatchObject({
      OPENAGENTS_UPDATE_INSTALLER: INSTALLER,
      OPENAGENTS_UPDATE_DIRECTORY: installDirectory,
      OPENAGENTS_UPDATE_PARENT_PID: "4321",
    })
  })

  it("keeps the app open when the handoff exits before shutdown", async () => {
    const { spawn } = fakeSpawn({ exit: 1 })
    const result = await launchWindowsUpdateInstaller(
      INSTALLER,
      { parentPid: 4321 },
      () => {},
      spawn,
      5,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("code 1")
  })

  it("reports a PowerShell launch failure", async () => {
    const missing: NodeJS.ErrnoException = new Error("spawn ENOENT")
    missing.code = "ENOENT"
    const { spawn } = fakeSpawn({ error: missing })
    const result = await launchWindowsUpdateInstaller(
      INSTALLER,
      { parentPid: 4321 },
      () => {},
      spawn,
      5,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("ENOENT")
  })
})
