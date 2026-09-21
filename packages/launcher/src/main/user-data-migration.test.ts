import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { migrateLegacyUserData } from "./user-data-migration"

const LEGACY = "OpenAgents Launcher"
const NEXT = "OpenAgents"

let base: string

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "oa-migration-"))
})

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

function seedLegacy(files: Record<string, string>): void {
  const dir = path.join(base, LEGACY)
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body)
  }
}

describe("migrateLegacyUserData", () => {
  it("moves the legacy profile to the new name", () => {
    seedLegacy({ "settings.json": '{"a":1}', "connections.json": "[]" })

    expect(migrateLegacyUserData(base, LEGACY, NEXT)).toBe("renamed")
    expect(fs.existsSync(path.join(base, LEGACY))).toBe(false)
    expect(
      fs.readFileSync(path.join(base, NEXT, "settings.json"), "utf-8"),
    ).toBe('{"a":1}')
    expect(fs.existsSync(path.join(base, NEXT, "connections.json"))).toBe(true)
  })

  it("does nothing when there is no legacy profile", () => {
    expect(migrateLegacyUserData(base, LEGACY, NEXT)).toBe("skipped")
    expect(fs.existsSync(path.join(base, NEXT))).toBe(false)
  })

  it("never overwrites an existing new-name profile", () => {
    seedLegacy({ "settings.json": "old" })
    fs.mkdirSync(path.join(base, NEXT))
    fs.writeFileSync(path.join(base, NEXT, "settings.json"), "new")

    expect(migrateLegacyUserData(base, LEGACY, NEXT)).toBe("skipped")
    expect(
      fs.readFileSync(path.join(base, NEXT, "settings.json"), "utf-8"),
    ).toBe("new")
  })

  it("is a no-op on the second run", () => {
    seedLegacy({ "settings.json": "{}" })
    expect(migrateLegacyUserData(base, LEGACY, NEXT)).toBe("renamed")
    expect(migrateLegacyUserData(base, LEGACY, NEXT)).toBe("skipped")
  })
})
