import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs"
import { tmpdir } from "os"
import path from "path"

import {
  adoptDifferentialBaseFile,
  asciiCacheRootCandidates,
  clearInstallAttempt,
  compareVersions,
  purgePendingUpdateCache,
  readInstallAttempt,
  readUpdaterCacheDirName,
  recordInstallAttempt,
  reconcileInstallAttempt,
  redirectUpdaterCacheToAsciiPath,
} from "./updater-cache"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "oa-updater-cache-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("compareVersions", () => {
  it("orders by major.minor.patch", () => {
    expect(compareVersions("0.8.18", "0.8.20")).toBeLessThan(0)
    expect(compareVersions("0.8.20", "0.8.18")).toBeGreaterThan(0)
    expect(compareVersions("0.8.20", "0.8.20")).toBe(0)
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0)
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0)
  })

  it("ignores prerelease suffixes", () => {
    expect(compareVersions("0.8.20-beta.1", "0.8.20")).toBe(0)
  })
})

describe("asciiCacheRootCandidates", () => {
  it("prefers ProgramData and never returns a non-ASCII path", () => {
    const candidates = asciiCacheRootCandidates({
      ProgramData: "C:\\ProgramData",
      SystemDrive: "C:",
    } as NodeJS.ProcessEnv)
    expect(candidates[0]).toBe(
      path.join("C:\\ProgramData", "OpenAgents", "updater-cache"),
    )
    expect(candidates.every((c) => !/[^\x00-\x7f]/.test(c))).toBe(true)
  })

  it("skips a non-ASCII ProgramData but still offers fallbacks", () => {
    const candidates = asciiCacheRootCandidates({
      ProgramData: "C:\\程序数据",
      SystemDrive: "C:",
    } as NodeJS.ProcessEnv)
    expect(candidates.some((c) => c.includes("程序数据"))).toBe(false)
    expect(candidates.length).toBeGreaterThan(0)
  })
})

describe("redirectUpdaterCacheToAsciiPath", () => {
  it("is a no-op off Windows", () => {
    // The suite runs on macOS/Linux in CI; the redirect only applies to the
    // Windows %LOCALAPPDATA% layout.
    if (process.platform === "win32") return
    const updater = { app: { baseCachePath: "/home/张三/.cache" } }
    expect(redirectUpdaterCacheToAsciiPath(updater)).toBeNull()
    expect(updater.app.baseCachePath).toBe("/home/张三/.cache")
  })

  it("tolerates an updater without an app adapter", () => {
    expect(redirectUpdaterCacheToAsciiPath({})).toBeNull()
  })
})

describe("readUpdaterCacheDirName", () => {
  it("reads the scalar out of app-update.yml", () => {
    const cfg = path.join(dir, "app-update.yml")
    writeFileSync(
      cfg,
      "provider: generic\nurl: https://dl.openagents.org/launcher/stable\nupdaterCacheDirName: openagents-launcher-updater\n",
    )
    expect(readUpdaterCacheDirName(cfg)).toBe("openagents-launcher-updater")
  })

  it("reads dev-app-update.yml, which uses a separate cache dir", () => {
    // Unpackaged builds check the same feed but must not share the staging dir
    // with an installed build.
    const cfg = path.join(dir, "dev-app-update.yml")
    writeFileSync(
      cfg,
      "provider: generic\nurl: https://dl.openagents.org/launcher/stable\nupdaterCacheDirName: openagents-launcher-updater-dev\n",
    )
    expect(readUpdaterCacheDirName(cfg)).toBe("openagents-launcher-updater-dev")
  })

  it("strips quotes and returns null when absent", () => {
    const cfg = path.join(dir, "app-update.yml")
    writeFileSync(cfg, 'updaterCacheDirName: "quoted-name"\n')
    expect(readUpdaterCacheDirName(cfg)).toBe("quoted-name")

    writeFileSync(cfg, "provider: generic\n")
    expect(readUpdaterCacheDirName(cfg)).toBeNull()
  })

  it("returns null when the file is missing", () => {
    expect(readUpdaterCacheDirName(path.join(dir, "nope.yml"))).toBeNull()
  })
})

describe("purgePendingUpdateCache", () => {
  it("removes the staged package so the next check re-downloads", () => {
    const pending = path.join(dir, "openagents-launcher-updater", "pending")
    mkdirSync(pending, { recursive: true })
    writeFileSync(path.join(pending, "update-info.json"), "{}")
    writeFileSync(path.join(pending, "setup.exe"), "binary")

    expect(purgePendingUpdateCache(dir, "openagents-launcher-updater")).toBe(true)
    expect(existsSync(pending)).toBe(false)
  })

  it("reports false when there is nothing staged", () => {
    expect(purgePendingUpdateCache(dir, "openagents-launcher-updater")).toBe(false)
  })
})

describe("adoptDifferentialBaseFile", () => {
  const NAME = "openagents-launcher-updater"
  // The move only ever happens on Windows; pass the platform explicitly so the
  // logic is covered on the macOS/Linux runners too.
  const adopt = (from: string, to: string) =>
    adoptDifferentialBaseFile(from, to, NAME, () => {}, "win32")

  it("moves the installer the NSIS setup left on the old path", () => {
    const oldRoot = path.join(dir, "old")
    const newRoot = path.join(dir, "new")
    mkdirSync(path.join(oldRoot, NAME), { recursive: true })
    writeFileSync(path.join(oldRoot, NAME, "installer.exe"), "v1 setup")

    expect(adopt(oldRoot, newRoot)).toBe(true)
    expect(existsSync(path.join(oldRoot, NAME, "installer.exe"))).toBe(false)
    expect(readFileSync(path.join(newRoot, NAME, "installer.exe"), "utf-8")).toBe(
      "v1 setup",
    )
  })

  it("overwrites the previous base file so it tracks the installed version", () => {
    const oldRoot = path.join(dir, "old")
    const newRoot = path.join(dir, "new")
    mkdirSync(path.join(oldRoot, NAME), { recursive: true })
    mkdirSync(path.join(newRoot, NAME), { recursive: true })
    writeFileSync(path.join(oldRoot, NAME, "installer.exe"), "v2 setup")
    writeFileSync(path.join(newRoot, NAME, "installer.exe"), "v1 setup")

    expect(adopt(oldRoot, newRoot)).toBe(true)
    expect(readFileSync(path.join(newRoot, NAME, "installer.exe"), "utf-8")).toBe(
      "v2 setup",
    )
  })

  it("reads a non-ASCII source path — the only case it ever runs in", () => {
    // The whole reason the cache gets redirected is a Chinese Windows username,
    // so the path this reads from always has non-ASCII segments. Node's fs takes
    // those fine; it is handing them to the Windows shell that breaks.
    const oldRoot = path.join(dir, "用户", "张三", "AppData", "Local")
    const newRoot = path.join(dir, "ProgramData", "OpenAgents", "updater-cache")
    mkdirSync(path.join(oldRoot, NAME), { recursive: true })
    writeFileSync(path.join(oldRoot, NAME, "installer.exe"), "v1 setup")

    expect(adopt(oldRoot, newRoot)).toBe(true)
    expect(readFileSync(path.join(newRoot, NAME, "installer.exe"), "utf-8")).toBe(
      "v1 setup",
    )
  })

  it("reports false when there is nothing to adopt", () => {
    expect(adopt(path.join(dir, "old"), path.join(dir, "new"))).toBe(false)
  })

  it("does nothing when the cache was not redirected", () => {
    mkdirSync(path.join(dir, NAME), { recursive: true })
    writeFileSync(path.join(dir, NAME, "installer.exe"), "v1 setup")
    expect(adopt(dir, dir)).toBe(false)
    expect(existsSync(path.join(dir, NAME, "installer.exe"))).toBe(true)
  })

  it("is a no-op off Windows", () => {
    const oldRoot = path.join(dir, "old")
    mkdirSync(path.join(oldRoot, NAME), { recursive: true })
    writeFileSync(path.join(oldRoot, NAME, "installer.exe"), "v1 setup")
    const noop = () => {}
    expect(
      adoptDifferentialBaseFile(oldRoot, path.join(dir, "new"), NAME, noop, "darwin"),
    ).toBe(false)
    expect(existsSync(path.join(oldRoot, NAME, "installer.exe"))).toBe(true)
  })
})

describe("install attempt bookkeeping", () => {
  it("counts consecutive attempts at the same version", () => {
    recordInstallAttempt(dir, "0.8.20")
    expect(readInstallAttempt(dir)).toEqual({ version: "0.8.20", attempts: 1 })

    recordInstallAttempt(dir, "0.8.20")
    expect(readInstallAttempt(dir)).toEqual({ version: "0.8.20", attempts: 2 })
  })

  it("resets the counter when a different version is attempted", () => {
    recordInstallAttempt(dir, "0.8.19")
    recordInstallAttempt(dir, "0.8.19")
    recordInstallAttempt(dir, "0.8.20")
    expect(readInstallAttempt(dir)).toEqual({ version: "0.8.20", attempts: 1 })
  })

  it("reports success when the app came back up on the attempted version", () => {
    recordInstallAttempt(dir, "0.8.20")
    expect(reconcileInstallAttempt(dir, "0.8.20")).toEqual({
      kind: "succeeded",
      version: "0.8.20",
    })
    // Record consumed, so the next launch has nothing to reconcile.
    expect(reconcileInstallAttempt(dir, "0.8.20")).toEqual({ kind: "none" })
  })

  it("reports success when the app leapfrogged the attempted version", () => {
    recordInstallAttempt(dir, "0.8.19")
    expect(reconcileInstallAttempt(dir, "0.8.21")).toEqual({
      kind: "succeeded",
      version: "0.8.19",
    })
  })

  it("reports failure when the app is still on the old version", () => {
    // The exact reported scenario: 0.8.19 then 0.8.20 staged, neither installed,
    // launcher still reports 0.8.18.
    recordInstallAttempt(dir, "0.8.20")
    expect(reconcileInstallAttempt(dir, "0.8.18")).toEqual({
      kind: "failed",
      version: "0.8.20",
      attempts: 1,
    })
  })

  it("carries the attempt count into the failure so a retry can escalate", () => {
    recordInstallAttempt(dir, "0.8.20")
    recordInstallAttempt(dir, "0.8.20")
    const outcome = reconcileInstallAttempt(dir, "0.8.18")
    expect(outcome).toEqual({ kind: "failed", version: "0.8.20", attempts: 2 })
  })

  it("returns none with no record, and survives a corrupt file", () => {
    expect(reconcileInstallAttempt(dir, "0.8.18")).toEqual({ kind: "none" })

    writeFileSync(path.join(dir, "update-install-attempt.json"), "{ not json")
    expect(readInstallAttempt(dir)).toBeNull()
    expect(reconcileInstallAttempt(dir, "0.8.18")).toEqual({ kind: "none" })

    clearInstallAttempt(dir)
    expect(readInstallAttempt(dir)).toBeNull()
  })
})
