import { describe, expect, it } from "vitest"

import { pinComSpec } from "./win-console"

/**
 * A ComSpec pointed at PowerShell made every agent CLI's .cmd shim start as
 * `pwsh /c "x.cmd"`, which ran x.cmd again — an endless chain of pwsh
 * processes under the launcher. That only happens on Windows, so the platform
 * and the file check are injected.
 */
describe("pinComSpec", () => {
  const CMD = "C:\\Windows\\System32\\cmd.exe"
  const present = (p: string) => p === CMD

  it("replaces a ComSpec that points at PowerShell", () => {
    const env: NodeJS.ProcessEnv = {
      ComSpec: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      SystemRoot: "C:\\Windows",
    }
    expect(pinComSpec(env, "win32", present)).toBe(true)
    expect(env.ComSpec).toBe(CMD)
  })

  it("leaves a ComSpec that already is cmd.exe alone", () => {
    const env: NodeJS.ProcessEnv = {
      ComSpec: "C:\\WINDOWS\\system32\\cmd.exe",
      SystemRoot: "C:\\WINDOWS",
    }
    expect(pinComSpec(env, "win32", present)).toBe(false)
    expect(env.ComSpec).toBe("C:\\WINDOWS\\system32\\cmd.exe")
  })

  it("fills in a missing ComSpec", () => {
    const env: NodeJS.ProcessEnv = { SystemRoot: "C:\\Windows" }
    expect(pinComSpec(env, "win32", present)).toBe(true)
    expect(env.ComSpec).toBe(CMD)
  })

  it("updates the key in the casing it already has, never adding a second", () => {
    const env: NodeJS.ProcessEnv = { COMSPEC: "pwsh.exe", SYSTEMROOT: "C:\\Windows" }
    pinComSpec(env, "win32", present)
    expect(Object.keys(env).filter((k) => k.toLowerCase() === "comspec")).toEqual([
      "COMSPEC",
    ])
    expect(env.COMSPEC).toBe(CMD)
  })

  it("falls back to a bare cmd.exe when System32 is not where it looked", () => {
    const env: NodeJS.ProcessEnv = { ComSpec: "pwsh.exe", SystemRoot: "D:\\Win" }
    pinComSpec(env, "win32", () => false)
    expect(env.ComSpec).toBe("cmd.exe")
  })

  it("does nothing off Windows", () => {
    const env: NodeJS.ProcessEnv = { ComSpec: "pwsh.exe" }
    expect(pinComSpec(env, "linux", present)).toBe(false)
    expect(env.ComSpec).toBe("pwsh.exe")
  })
})
