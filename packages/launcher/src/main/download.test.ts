import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as crypto from "crypto"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { EventEmitter } from "events"
import { Readable } from "stream"

// Scripted fake origins. Each host behaves the way a real mirror can misbehave
// — slow headers, a trickle of bytes, a truncated body, corrupt content — so
// the racing/watchdog/resume logic is exercised without touching the network.
interface Script {
  headerDelayMs?: number
  /** Bytes served by this host (defaults to the shared payload). */
  body?: Buffer
  /** Pace the body at this rate; omitted means "as fast as possible". */
  rateBytesPerSec?: number
  /** Serve this many bytes at full speed before the rate limit kicks in. */
  fastPrefixBytes?: number
  /** End the stream early after this many bytes, like a dropped connection. */
  cutAfterBytes?: number
  /** Fail the request before any response arrives. */
  failOpen?: string
  status?: number
  supportsRange?: boolean
}

const fake = vi.hoisted(() => ({
  scripts: new Map<string, Script>(),
  /** [host, rangeStartOrZero] for every request that reached an origin. */
  hits: [] as Array<[string, number]>,
}))

vi.mock("electron", () => ({
  net: { request: (opts: { url: string }) => makeFakeRequest(opts.url) },
}))

import {
  downloadToFile,
  fetchTextRacing,
  fetchJsonRacing,
  fastestBase,
  TUNABLES,
} from "./download"

function pacedStream(payload: Buffer, script: Script): Readable {
  const chunkSize = 4096
  const intervalMs = script.rateBytesPerSec
    ? Math.max(1, Math.round((chunkSize / script.rateBytesPerSec) * 1000))
    : 1
  let sent = 0
  const stream = new Readable({ read() {} })
  if (script.fastPrefixBytes) {
    sent = Math.min(payload.length, script.fastPrefixBytes)
    stream.push(payload.subarray(0, sent))
  }
  const timer = setInterval(() => {
    if (stream.destroyed) {
      clearInterval(timer)
      return
    }
    if (script.cutAfterBytes != null && sent >= script.cutAfterBytes) {
      clearInterval(timer)
      stream.push(null) // premature EOF — content-length is never reached
      return
    }
    const end = Math.min(payload.length, sent + chunkSize)
    stream.push(payload.subarray(sent, end))
    sent = end
    if (sent >= payload.length) {
      clearInterval(timer)
      stream.push(null)
    }
  }, intervalMs)
  stream.on("close", () => clearInterval(timer))
  return stream
}

function makeFakeRequest(url: string): EventEmitter & {
  setHeader: (k: string, v: string) => void
  end: () => void
  abort: () => void
} {
  const host = new URL(url).host
  const script = fake.scripts.get(host) || {}
  const headers: Record<string, string> = {}
  let aborted = false
  let live: Readable | null = null

  const req = Object.assign(new EventEmitter(), {
    setHeader: (k: string, v: string) => {
      headers[k] = v
    },
    abort: () => {
      aborted = true
      live?.destroy()
    },
    end: () => {
      setTimeout(() => {
        if (aborted) return
        if (script.failOpen) {
          req.emit("error", new Error(script.failOpen))
          return
        }
        const body = script.body ?? Buffer.alloc(0)
        const rangeStart = parseInt(
          /bytes=(\d+)-/.exec(headers.Range || "")?.[1] || "0",
          10,
        )
        fake.hits.push([host, rangeStart])
        const ranged = rangeStart > 0 && script.supportsRange !== false
        const payload = ranged ? body.subarray(rangeStart) : body
        live = pacedStream(payload, script)
        const res = Object.assign(live, {
          statusCode: script.status ?? (ranged ? 206 : 200),
          headers: ranged
            ? {
                "content-length": String(payload.length),
                "content-range": `bytes ${rangeStart}-${body.length - 1}/${body.length}`,
              }
            : { "content-length": String(body.length) },
        })
        req.emit("response", res)
      }, script.headerDelayMs ?? 1)
    },
  })
  return req
}

const PAYLOAD = crypto.randomBytes(200_000)
const PAYLOAD_SHA = crypto
  .createHash("sha256")
  .update(PAYLOAD)
  .digest("hex")

let tmpDir: string
let dest: string
const original = { ...TUNABLES }

beforeEach(() => {
  fake.scripts.clear()
  fake.hits.length = 0
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-dl-"))
  dest = path.join(tmpDir, "artifact.bin")
  // Compress every timing knob so the suite runs in milliseconds.
  Object.assign(TUNABLES, {
    headerTimeoutMs: 400,
    staggerMs: 25,
    watchdogTickMs: 10,
    watchdogWindowMs: 60,
    minBytesPerSec: 100_000,
    progressThrottleMs: 0,
    textTimeoutMs: 400,
  })
})

afterEach(() => {
  Object.assign(TUNABLES, original)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const url = (host: string): string => `https://${host}/artifact.bin`

describe("downloadToFile", () => {
  it("uses whichever candidate answers first, not the preferred one", async () => {
    fake.scripts.set("slow.test", { headerDelayMs: 300, body: PAYLOAD })
    fake.scripts.set("fast.test", { headerDelayMs: 5, body: PAYLOAD })

    const res = await downloadToFile([url("slow.test"), url("fast.test")], dest)

    expect(res.url).toBe(url("fast.test"))
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true)
  })

  it("skips a candidate that fails and still completes", async () => {
    fake.scripts.set("dead.test", { failOpen: "ECONNREFUSED" })
    fake.scripts.set("ok.test", { headerDelayMs: 5, body: PAYLOAD })

    const res = await downloadToFile([url("dead.test"), url("ok.test")], dest)

    expect(res.url).toBe(url("ok.test"))
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true)
  })

  it("abandons a slow source mid-transfer and resumes from another mirror", async () => {
    // 20 KB/s — the exact "connected but crawling" case the old 60s no-data
    // timeout could never detect.
    fake.scripts.set("crawl.test", {
      headerDelayMs: 1,
      body: PAYLOAD,
      fastPrefixBytes: 50_000,
      rateBytesPerSec: 20_000,
    })
    fake.scripts.set("mirror.test", { headerDelayMs: 200, body: PAYLOAD })

    const res = await downloadToFile(
      [url("crawl.test"), url("mirror.test")],
      dest,
    )

    expect(res.switches).toBeGreaterThan(0)
    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true)
    // The takeover must be a resume, not a restart from zero.
    const resumed = fake.hits.filter(([h, start]) => h === "mirror.test" && start > 0)
    expect(resumed.length).toBeGreaterThan(0)
  })

  it("recovers when a connection drops before the body is complete", async () => {
    fake.scripts.set("flaky.test", {
      headerDelayMs: 1,
      body: PAYLOAD,
      cutAfterBytes: 60_000,
    })
    fake.scripts.set("good.test", { headerDelayMs: 150, body: PAYLOAD })

    await downloadToFile([url("flaky.test"), url("good.test")], dest)

    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true)
  })

  it("refetches from another source when the checksum does not match", async () => {
    fake.scripts.set("corrupt.test", {
      headerDelayMs: 1,
      body: Buffer.alloc(PAYLOAD.length, 7),
    })
    fake.scripts.set("clean.test", { headerDelayMs: 120, body: PAYLOAD })

    await downloadToFile([url("corrupt.test"), url("clean.test")], dest, {
      expectedSha: PAYLOAD_SHA,
    })

    expect(fs.readFileSync(dest).equals(PAYLOAD)).toBe(true)
  })

  it("rejects content that fails npm integrity everywhere", async () => {
    fake.scripts.set("bad.test", {
      headerDelayMs: 1,
      body: Buffer.alloc(1000, 3),
    })

    await expect(
      downloadToFile([url("bad.test")], dest, {
        expectedIntegrity: `sha512-${crypto.createHash("sha512").update(PAYLOAD).digest("base64")}`,
      }),
    ).rejects.toThrow(/integrity/)
    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
  })

  it("fails loudly instead of installing an empty file", async () => {
    // An origin that answers 200 with nothing — a CDN edge serving a stub.
    fake.scripts.set("hollow.test", { headerDelayMs: 1, body: Buffer.alloc(0) })

    await expect(downloadToFile([url("hollow.test")], dest)).rejects.toThrow(
      /empty response/,
    )
    expect(fs.existsSync(dest)).toBe(false)
  })

  it("gives up cleanly when no candidate can be reached", async () => {
    fake.scripts.set("gone.test", { failOpen: "ENOTFOUND" })

    await expect(downloadToFile([url("gone.test")], dest)).rejects.toThrow()
    expect(fs.existsSync(dest)).toBe(false)
  })

  it("reports progress with a byte count that reaches the full size", async () => {
    fake.scripts.set("ok.test", { headerDelayMs: 1, body: PAYLOAD })
    const seen: number[] = []

    await downloadToFile([url("ok.test")], dest, {
      onProgress: (pct) => seen.push(pct),
    })

    expect(seen.at(-1)).toBe(100)
  })
})

describe("fetchTextRacing", () => {
  it("returns the body of the fastest origin", async () => {
    fake.scripts.set("slow.test", {
      headerDelayMs: 250,
      body: Buffer.from("from-slow"),
    })
    fake.scripts.set("fast.test", {
      headerDelayMs: 2,
      body: Buffer.from("from-fast"),
    })

    const text = await fetchTextRacing([url("slow.test"), url("fast.test")])

    expect(text).toBe("from-fast")
  })

  it("returns null instead of hanging when nothing answers", async () => {
    fake.scripts.set("dead.test", { failOpen: "ENOTFOUND" })

    expect(await fetchTextRacing([url("dead.test")])).toBeNull()
  })

  it("parses JSON metadata", async () => {
    fake.scripts.set("reg.test", {
      headerDelayMs: 1,
      body: Buffer.from(JSON.stringify({ version: "1.2.3" })),
    })

    const meta = await fetchJsonRacing<{ version: string }>([url("reg.test")])

    expect(meta?.version).toBe("1.2.3")
  })
})

describe("fastestBase", () => {
  it("picks the origin that answers first, not the listed one", async () => {
    fake.scripts.set("official.test", {
      headerDelayMs: 300,
      body: Buffer.from("{}"),
    })
    fake.scripts.set("mirror.test", {
      headerDelayMs: 5,
      body: Buffer.from("{}"),
    })

    const winner = await fastestBase(
      ["https://official.test", "https://mirror.test"],
      "pkg/latest",
    )

    expect(winner).toBe("https://mirror.test")
  })

  it("returns null when nothing answers in time, leaving npm untouched", async () => {
    fake.scripts.set("a.test", { headerDelayMs: 5_000, body: Buffer.from("{}") })
    fake.scripts.set("b.test", { headerDelayMs: 5_000, body: Buffer.from("{}") })

    const winner = await fastestBase(
      ["https://a.test", "https://b.test"],
      "pkg/latest",
      { timeoutMs: 80 },
    )

    expect(winner).toBeNull()
  })

  it("skips the probe entirely when there is only one candidate", async () => {
    const winner = await fastestBase(["https://only.test"], "pkg/latest")

    expect(winner).toBe("https://only.test")
    expect(fake.hits).toHaveLength(0)
  })
})
