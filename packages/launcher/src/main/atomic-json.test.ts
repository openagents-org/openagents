import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { writeJsonAtomic } from "./atomic-json"

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-atomic-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("writeJsonAtomic", () => {
  it("writes readable JSON and creates missing directories", () => {
    const file = path.join(dir, "nested", "settings.json")

    writeJsonAtomic(file, { theme: "dark", n: 1 })

    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({
      theme: "dark",
      n: 1,
    })
  })

  it("replaces an existing file without leaving a temp behind", () => {
    const file = path.join(dir, "settings.json")
    writeJsonAtomic(file, { v: 1 })

    writeJsonAtomic(file, { v: 2 })

    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ v: 2 })
    expect(fs.readdirSync(dir)).toEqual(["settings.json"])
  })

  it("keeps the previous file intact when the new value can't be serialised", () => {
    const file = path.join(dir, "settings.json")
    writeJsonAtomic(file, { keep: "me" })
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => writeJsonAtomic(file, circular)).toThrow()

    // The whole point: a failed write must not damage what was already there.
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ keep: "me" })
    expect(fs.readdirSync(dir)).toEqual(["settings.json"])
  })

  it("applies the requested mode, so credentials stay owner-only", () => {
    const file = path.join(dir, "credentials.json")

    writeJsonAtomic(file, { wrappedKey: "x" }, { mode: 0o600 })

    // Windows does not model POSIX permission bits.
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    }
  })
})
