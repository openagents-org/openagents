import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ensureUserBinDirsOnPath } from "./node-runtime"
import { readPathEnv, writePathEnv } from "../env"

/**
 * The failure this closes: OpenWorker's install command IS `uv tool install …`,
 * uv's own installer puts the binary in ~/.local/bin, and a GUI-launched app
 * inherits a shell-less PATH that has never heard of it. The install pre-flight
 * searches ~/.local/bin and passed; the spawn it was guarding then died with
 * "/bin/sh: uv: command not found" and exit 127.
 */
describe("ensureUserBinDirsOnPath", () => {
  const original = readPathEnv()
  let home: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "user-path-"))
  })
  afterEach(() => {
    writePathEnv(original)
    fs.rmSync(home, { recursive: true, force: true })
  })

  const localBin = (): string => path.join(os.homedir(), ".local", "bin")

  it("adds ~/.local/bin when it exists and PATH lacks it", () => {
    if (!fs.existsSync(localBin())) return // nothing to assert on this machine
    writePathEnv("/usr/bin:/bin")
    ensureUserBinDirsOnPath()
    expect(readPathEnv().split(path.delimiter)).toContain(localBin())
  })

  it("appends rather than prepends — the user's own PATH keeps winning", () => {
    if (!fs.existsSync(localBin())) return
    writePathEnv("/usr/bin:/bin")
    ensureUserBinDirsOnPath()
    const parts = readPathEnv().split(path.delimiter)
    expect(parts[0]).toBe("/usr/bin")
    expect(parts.indexOf(localBin())).toBeGreaterThan(parts.indexOf("/bin"))
  })

  it("is idempotent — a second call adds nothing", () => {
    writePathEnv("/usr/bin:/bin")
    ensureUserBinDirsOnPath()
    const once = readPathEnv()
    ensureUserBinDirsOnPath()
    expect(readPathEnv()).toBe(once)
  })

  it("never invents a directory that is not there", () => {
    writePathEnv("/usr/bin:/bin")
    ensureUserBinDirsOnPath()
    for (const dir of readPathEnv().split(path.delimiter)) {
      if (dir === "/usr/bin" || dir === "/bin") continue
      expect(fs.existsSync(dir)).toBe(true)
    }
  })
})
