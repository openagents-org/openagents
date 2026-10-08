import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  finishCarryOver,
  upgradeNodejs,
  type NodeUpgradeDeps,
} from "./node-upgrade"

/**
 * The prefix being replaced is not just a runtime: the core library and any
 * legacy shared-prefix agents live in its node_modules. An upgrade that
 * loses them leaves the launcher without its core, so every case here checks
 * what survived as much as what changed.
 */
describe("upgradeNodejs", () => {
  let root: string
  let nodejs: string

  const write = (rel: string, body = ""): void => {
    const p = path.join(nodejs, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body)
  }
  const read = (rel: string): string =>
    fs.readFileSync(path.join(nodejs, rel), "utf-8")

  /** A fake runtime: a version file in place of a node binary. */
  const deps = (over: Partial<NodeUpgradeDeps> = {}): NodeUpgradeDeps => ({
    download: async (dir) => {
      fs.mkdirSync(path.join(dir, "node_modules", "npm"), { recursive: true })
      fs.writeFileSync(path.join(dir, "VERSION"), "v24.21.0")
      fs.writeFileSync(path.join(dir, "node_modules", "npm", "VERSION"), "11")
    },
    probe: (dir) => {
      try {
        return fs.readFileSync(path.join(dir, "VERSION"), "utf-8")
      } catch {
        return null
      }
    },
    outdated: (v) => v !== "v24.21.0",
    stopRunning: vi.fn(async () => {}),
    log: () => {},
    ...over,
  })

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "node-upgrade-"))
    nodejs = path.join(root, "nodejs")
    write("VERSION", "v22.22.3")
    write("node_modules/npm/VERSION", "10")
    write("node_modules/@openagents-org/agent-launcher/package.json", "core")
    write("node_modules/.bin/claude", "shim")
    write("package.json", "prefix")
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it("swaps in the new runtime and keeps the core and legacy agents", async () => {
    const d = deps()
    expect(await upgradeNodejs(nodejs, () => {}, d)).toBe("v24.21.0")

    expect(read("VERSION")).toBe("v24.21.0")
    // The new runtime's own npm wins over the old one.
    expect(read("node_modules/npm/VERSION")).toBe("11")
    expect(
      read("node_modules/@openagents-org/agent-launcher/package.json"),
    ).toBe("core")
    expect(read("node_modules/.bin/claude")).toBe("shim")
    expect(read("package.json")).toBe("prefix")
    expect(d.stopRunning).toHaveBeenCalled()
    expect(fs.existsSync(`${nodejs}.old`)).toBe(false)
    expect(fs.existsSync(`${nodejs}.next`)).toBe(false)
  })

  it("keeps the old runtime when the download fails", async () => {
    const d = deps({
      download: async () => {
        throw new Error("ECONNRESET")
      },
    })
    expect(await upgradeNodejs(nodejs, () => {}, d)).toBeNull()
    expect(read("VERSION")).toBe("v22.22.3")
    expect(
      read("node_modules/@openagents-org/agent-launcher/package.json"),
    ).toBe("core")
    expect(d.stopRunning).not.toHaveBeenCalled()
  })

  it("keeps the old runtime when the new one does not run", async () => {
    const d = deps({ probe: () => null })
    expect(await upgradeNodejs(nodejs, () => {}, d)).toBeNull()
    expect(read("VERSION")).toBe("v22.22.3")
    expect(fs.existsSync(`${nodejs}.next`)).toBe(false)
    expect(d.stopRunning).not.toHaveBeenCalled()
  })

  // What a Windows machine does while a node.exe inside is still running.
  const lockRenamesOf = (dir: string) => {
    const real = fs.renameSync
    return vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (from === dir)
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" })
      return real(from, to)
    })
  }

  it("keeps the old runtime in place when it is locked", async () => {
    const spy = lockRenamesOf(nodejs)
    try {
      expect(await upgradeNodejs(nodejs, () => {}, deps())).toBeNull()
    } finally {
      spy.mockRestore()
    }
    expect(read("VERSION")).toBe("v22.22.3")
    expect(
      read("node_modules/@openagents-org/agent-launcher/package.json"),
    ).toBe("core")
    expect(fs.existsSync(`${nodejs}.next`)).toBe(false)
    expect(fs.existsSync(`${nodejs}.old`)).toBe(false)
  })

  it("puts the old runtime back when the new one cannot be moved in", async () => {
    const spy = lockRenamesOf(`${nodejs}.next`)
    try {
      expect(await upgradeNodejs(nodejs, () => {}, deps())).toBeNull()
    } finally {
      spy.mockRestore()
    }
    expect(read("VERSION")).toBe("v22.22.3")
    expect(
      read("node_modules/@openagents-org/agent-launcher/package.json"),
    ).toBe("core")
    expect(fs.existsSync(`${nodejs}.old`)).toBe(false)
  })

  it("keeps the retired runtime when part of it cannot be carried over", async () => {
    const spy = lockRenamesOf(
      path.join(`${nodejs}.old`, "node_modules", "@openagents-org"),
    )
    try {
      expect(await upgradeNodejs(nodejs, () => {}, deps())).toBe("v24.21.0")
    } finally {
      spy.mockRestore()
    }
    // Not deleted with the core still inside; the next launch finishes it.
    expect(fs.existsSync(`${nodejs}.old`)).toBe(true)
    finishCarryOver(nodejs, () => {})
    expect(
      read("node_modules/@openagents-org/agent-launcher/package.json"),
    ).toBe("core")
    expect(fs.existsSync(`${nodejs}.old`)).toBe(false)
  })

  it("discards a stale staging directory from an interrupted attempt", async () => {
    fs.mkdirSync(`${nodejs}.next/junk`, { recursive: true })
    expect(await upgradeNodejs(nodejs, () => {}, deps())).toBe("v24.21.0")
    expect(fs.existsSync(path.join(nodejs, "junk"))).toBe(false)
  })
})

describe("finishCarryOver", () => {
  let root: string
  let nodejs: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "node-carry-"))
    nodejs = path.join(root, "nodejs")
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it("moves what a previous upgrade left behind, then drops the old runtime", () => {
    fs.mkdirSync(path.join(nodejs, "node_modules", "npm"), { recursive: true })
    fs.mkdirSync(
      path.join(`${nodejs}.old`, "node_modules", "@openagents-org"),
      {
        recursive: true,
      },
    )
    fs.mkdirSync(path.join(`${nodejs}.old`, "node_modules", "npm"))
    finishCarryOver(nodejs, () => {})
    expect(
      fs.existsSync(path.join(nodejs, "node_modules", "@openagents-org")),
    ).toBe(true)
    expect(fs.existsSync(`${nodejs}.old`)).toBe(false)
  })

  it("does nothing while there is no runtime to move into", () => {
    fs.mkdirSync(path.join(`${nodejs}.old`, "node_modules"), {
      recursive: true,
    })
    finishCarryOver(nodejs, () => {})
    expect(fs.existsSync(`${nodejs}.old`)).toBe(true)
  })
})
