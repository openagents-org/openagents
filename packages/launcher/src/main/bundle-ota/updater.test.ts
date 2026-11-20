// @vitest-environment node
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildRelease } from "../../../scripts/pack-workspace-bundle.mjs"
import { readBundleInfo, type BundleInfo } from "./manifest"
import { BundleStore } from "./store"
import { WorkspaceBundleUpdater, type BundlePages } from "./updater"

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
const KEY = publicKey.export({ type: "spki", format: "der" }).toString("base64")
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const FEED = "https://feed.test/desktop/latest.json"

let tmp: string
let feedDir: string
let builtin: { dir: string; info: BundleInfo | null }
/** Whether the default feed is on — off is what switching to a self-hosted endpoint does. */
let feedOn = true

function makeBundle(dir: string, info: Partial<BundleInfo> & { committedAt: number }): string {
  const full: BundleInfo = { schema: 1, version: `v${info.committedAt}`, commit: "abc", minHostApi: 1, ...info }
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true })
  fs.writeFileSync(path.join(dir, "index.html"), `<html>${full.version}</html>`)
  fs.writeFileSync(path.join(dir, "assets", "app.js"), "export {}")
  fs.writeFileSync(path.join(dir, "bundle-info.json"), JSON.stringify(full))
  return dir
}

/** Publish a build to the fake feed, the way CI does. */
function publish(info: Partial<BundleInfo> & { committedAt: number }): void {
  const dir = makeBundle(path.join(tmp, "src", String(info.committedAt)), info)
  buildRelease({ dir, out: feedDir, privateKeyPem: PEM })
}

function pages(open = true) {
  return {
    hasPages: () => open,
    announce: vi.fn<BundlePages["announce"]>(),
    reloadAll: vi.fn<BundlePages["reloadAll"]>(),
  } satisfies BundlePages
}

function updater(opts: { feed?: string | null; hostApi?: number; download?: (url: string, dest: string, sha: string) => Promise<void> } = {}) {
  const local = (url: string) => path.join(feedDir, new URL(url).pathname.replace(/^\/desktop\//, ""))
  return new WorkspaceBundleUpdater({
    store: new BundleStore(path.join(tmp, "userData", "workspace-bundles")),
    builtin,
    feedUrl: () => (opts.feed === undefined ? (feedOn ? FEED : null) : opts.feed),
    keys: [KEY],
    autoUpdate: () => true,
    hostApi: opts.hostApi ?? 1,
    fetchText: async (url) => (fs.existsSync(local(url)) ? fs.readFileSync(local(url), "utf-8") : null),
    download: opts.download ?? (async (url, dest, sha) => {
      fs.copyFileSync(local(url), dest)
      const actual = crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex")
      if (actual !== sha) throw new Error("sha mismatch")
    }),
    bootTimeoutMs: 1000,
  })
}

beforeEach(() => {
  feedOn = true
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oa-ota-"))
  feedDir = path.join(tmp, "feed")
  const dir = makeBundle(path.join(tmp, "builtin"), { committedAt: 1000 })
  builtin = { dir, info: readBundleInfo(dir) }
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("workspace bundle updates", () => {
  it("serves a newer build at once when no page is open", async () => {
    publish({ committedAt: 2000 })
    const u = updater()
    u.attach(pages(false))
    await u.check()
    expect(u.served().source).toBe("downloaded")
    expect(fs.readFileSync(path.join(u.served().dir, "index.html"), "utf-8")).toContain("v2000")
  })

  it("offers a refresh to open pages and switches only when it is accepted", async () => {
    publish({ committedAt: 2000 })
    const u = updater()
    const p = pages(true)
    u.attach(p)
    await u.check()
    expect(u.served().source).toBe("builtin")
    expect(p.announce).toHaveBeenCalledWith({ version: "v2000" })
    expect(u.pending()).toEqual({ version: "v2000" })
    expect(u.apply()).toBe(true)
    expect(u.served().source).toBe("downloaded")
    expect(p.announce).toHaveBeenLastCalledWith(null)
    expect(p.reloadAll).toHaveBeenCalledOnce()
  })

  it("is picked up on the next start without asking", async () => {
    publish({ committedAt: 2000 })
    const first = updater()
    first.attach(pages(true))
    await first.check()
    expect(updater().served().info?.version).toBe("v2000")
  })

  it("ignores builds that are not newer, need a newer launcher, or are not signed by a trusted key", async () => {
    publish({ committedAt: 1000 })
    const u = updater()
    u.attach(pages(false))
    await u.check()
    expect(u.served().source).toBe("builtin")

    publish({ committedAt: 3000, minHostApi: 2 })
    await u.check()
    expect(u.served().source).toBe("builtin")
    const newer = updater({ hostApi: 2 })
    newer.attach(pages(false))
    await newer.check()
    expect(newer.served().info?.version).toBe("v3000")
    // Downgrading the launcher leaves that build behind rather than running it.
    expect(updater().served().source).toBe("builtin")

    publish({ committedAt: 4000 })
    const latest = path.join(feedDir, "latest.json")
    const doc = JSON.parse(fs.readFileSync(latest, "utf-8"))
    fs.writeFileSync(latest, JSON.stringify({ ...doc, payload: doc.payload.replace("v4000", "v4001") }))
    const tampered = updater()
    tampered.attach(pages(false))
    await tampered.check()
    expect(tampered.served().source).toBe("builtin")
  })

  it("keeps the built-in bundle when the download is damaged, and tries again later", async () => {
    publish({ committedAt: 2000 })
    const download = vi.fn(async (_url: string, dest: string) => {
      fs.writeFileSync(dest, "garbage")
      throw new Error("sha mismatch")
    })
    const u = updater({ download })
    u.attach(pages(false))
    await u.check()
    expect(u.served().source).toBe("builtin")
    await u.check()
    expect(download).toHaveBeenCalledTimes(2)
  })

  it("rolls back when a download never starts, retries it once on the next launch, then gives up on it", async () => {
    vi.useFakeTimers()
    publish({ committedAt: 2000 })
    const u = updater()
    const p = pages(false)
    u.attach(p)
    await u.check()
    expect(u.served().source).toBe("downloaded")
    u.pageStarted(7)
    await vi.advanceTimersByTimeAsync(1500)
    expect(u.served().source).toBe("builtin")
    expect(p.reloadAll).toHaveBeenCalled()
    // Not fetched again in the same session.
    await u.check()
    expect(u.served().source).toBe("builtin")

    const second = updater()
    second.attach(pages(false))
    expect(second.served().info?.version).toBe("v2000")
    second.pageStarted(8)
    await vi.advanceTimersByTimeAsync(1500)
    expect(second.served().source).toBe("builtin")

    const third = updater()
    third.attach(pages(false))
    expect(third.served().source).toBe("builtin")
    await third.check()
    expect(third.served().source).toBe("builtin")
  })

  it("falls back to the download that was working, not the built-in bundle", async () => {
    vi.useFakeTimers()
    publish({ committedAt: 2000 })
    const u = updater()
    const p = pages(false)
    u.attach(p)
    await u.check()
    u.pageStarted(1)
    u.pageReady(1)

    publish({ committedAt: 3000 })
    await u.check()
    expect(u.served().info?.version).toBe("v3000")
    u.pageStarted(2)
    await vi.advanceTimersByTimeAsync(1500)
    expect(u.served().info?.version).toBe("v2000")

    // And on the next launch, until the newer one has proven itself.
    const next = updater()
    expect(next.served().info?.version).toBe("v3000")
    next.pageStarted(3)
    await vi.advanceTimersByTimeAsync(1500)
    expect(next.served().info?.version).toBe("v2000")
    expect(updater().served().info?.version).toBe("v2000")
  })

  it("only counts a start reported by a page on probation", async () => {
    vi.useFakeTimers()
    publish({ committedAt: 2000 })
    const u = updater()
    u.attach(pages(false))
    await u.check()
    u.pageStarted(7)
    u.pageReady(99)
    await vi.advanceTimersByTimeAsync(1500)
    expect(u.served().source).toBe("builtin")
  })

  it("drops a hosted download at once when the endpoint moves off the feed", async () => {
    publish({ committedAt: 2000 })
    const u = updater()
    const p = pages(false)
    u.attach(p)
    await u.check()
    expect(u.served().source).toBe("downloaded")
    feedOn = false
    u.reconsider()
    expect(u.served().source).toBe("builtin")
    expect(p.reloadAll).toHaveBeenCalled()
  })

  it("withdraws a pending update when the endpoint moves off the feed", async () => {
    publish({ committedAt: 2000 })
    const u = updater()
    const p = pages(true)
    u.attach(p)
    await u.check()
    expect(u.pending()).not.toBeNull()
    feedOn = false
    u.reconsider()
    expect(u.pending()).toBeNull()
    expect(p.announce).toHaveBeenLastCalledWith(null)
    expect(u.apply()).toBe(false)
    expect(u.served().source).toBe("builtin")
  })

  it("keeps a download that reports it started", async () => {
    vi.useFakeTimers()
    publish({ committedAt: 2000 })
    const u = updater()
    u.attach(pages(false))
    await u.check()
    u.pageStarted(7)
    u.pageReady(7)
    await vi.advanceTimersByTimeAsync(5000)
    expect(u.served().source).toBe("downloaded")
  })

  it("does not fault a page that closed before it could report", async () => {
    vi.useFakeTimers()
    publish({ committedAt: 2000 })
    const u = updater()
    u.attach(pages(false))
    await u.check()
    u.pageStarted(7)
    u.pageGone(7)
    await vi.advanceTimersByTimeAsync(5000)
    expect(u.served().source).toBe("downloaded")
  })

  it("lets a launcher with a newer built-in bundle supersede the download, and clears it away", async () => {
    publish({ committedAt: 2000 })
    const u = updater()
    u.attach(pages(false))
    await u.check()
    const downloaded = u.served().dir

    const dir = makeBundle(path.join(tmp, "builtin-next"), { committedAt: 5000 })
    builtin = { dir, info: readBundleInfo(dir) }
    expect(updater().served().source).toBe("builtin")
    expect(fs.existsSync(downloaded)).toBe(false)
  })

  it("serves only the built-in bundle with the feed off, and leaves downloads for later", async () => {
    publish({ committedAt: 2000 })
    const u = updater()
    u.attach(pages(false))
    await u.check()
    const downloaded = u.served().dir

    const off = updater({ feed: null })
    expect(off.served().source).toBe("builtin")
    await off.check()
    expect(fs.existsSync(downloaded)).toBe(true)
    expect(updater().served().source).toBe("downloaded")
  })
})
