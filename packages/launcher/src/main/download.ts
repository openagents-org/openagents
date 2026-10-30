// ── Startup downloader ──
//
// Everything the first launch needs (Node runtime, npm, the agent-launcher
// core) is fetched by this module. It exists because "the origin is slow" —
// not "the origin is down" — is the dominant failure mode in mainland China,
// and the previous implementation could only react to hard failures:
//
//   1. Candidate racing. Mirrors are tried CONCURRENTLY (staggered, so the
//      preferred origin keeps a head start) and the first one to answer wins;
//      the losers are aborted. A wrong region guess no longer costs anything,
//      because whichever origin is actually reachable answers first.
//   2. Slow-transfer watchdog. A connection that stays under the minimum
//      rate for a full window is abandoned mid-download and the next candidate takes
//      over — resuming from the bytes already on disk via a Range request. The
//      old code only had a 60s no-data timeout, which a steady 50 KB/s trickle
//      never trips, so it would spend 15 minutes pulling a 50 MB tarball.
//   3. Chromium transport. Requests go through Electron's `net`, which honours
//      the proxy the user configured in Settings (and the OS proxy). Node's
//      https module ignores both, so a user behind a corporate/VPN proxy was
//      effectively downloading direct — usually meaning "not at all". A direct
//      Node https pass is kept as a fallback for when a misconfigured proxy
//      breaks every candidate.
import { net } from "electron"
import * as crypto from "crypto"
import * as fs from "fs"
import { pipeline } from "stream/promises"
import type { Readable } from "stream"

export type ProgressFn = (pct: number, detail: string) => void
type LogFn = (msg: string) => void

/** Timing knobs, in one place so tests can compress them. */
export const TUNABLES = {
  // A candidate that hasn't sent response headers by now is considered dead.
  // Kept well under the old 60s so a black-holed origin can't stall the splash.
  headerTimeoutMs: 12_000,
  // How long the preferred candidate runs alone before the next one joins in.
  staggerMs: 600,
  watchdogTickMs: 2_000,
  // Judge speed over a window long enough to ride out a stall, short enough
  // that a genuinely slow origin is dropped early.
  watchdogWindowMs: 10_000,
  minBytesPerSec: 160 * 1024,
  // Cap the mirror hopping: past this we ride out whatever source we have
  // rather than restarting forever on a uniformly slow network.
  maxSwitches: 4,
  textTimeoutMs: 8_000,
  // Splash repaint interval. The previous code ran executeJavaScript() for
  // every chunk — thousands of IPC round-trips competing with the download.
  progressThrottleMs: 200,
}

interface Opened {
  url: string
  status: number
  stream: Readable
  /** Size of the complete file when known, else 0. */
  total: number
  /** Byte offset this stream starts at (non-zero only for a resumed 206). */
  offset: number
  abort: () => void
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`
}

function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec >= 1e6) return `${(bytesPerSec / 1e6).toFixed(1)} MB/s`
  return `${Math.max(0, Math.round(bytesPerSec / 1e3))} KB/s`
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

/** Full size of the resource behind a 200/206 response, or 0 when unknown. */
function totalFromHeaders(
  status: number,
  headers: Record<string, string | string[] | undefined>,
): number {
  const pick = (name: string): string => {
    const v = headers[name]
    return Array.isArray(v) ? v[0] || "" : v || ""
  }
  if (status === 206) {
    const m = /\/(\d+)\s*$/.exec(pick("content-range"))
    if (m) return parseInt(m[1], 10) || 0
  }
  return parseInt(pick("content-length") || "0", 10) || 0
}

/**
 * Open one candidate. `useNet` picks the transport: Electron's Chromium stack
 * (proxy-aware, the default) or a direct Node https connection (fallback).
 */
function openStream(
  url: string,
  rangeStart: number,
  useNet: boolean,
): Promise<Opened> {
  return new Promise<Opened>((resolve, reject) => {
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      reject(err)
    }
    const succeed = (opened: Opened): void => {
      if (settled) {
        opened.abort()
        return
      }
      settled = true
      resolve(opened)
    }

    if (useNet) {
      const req = net.request({ method: "GET", url, redirect: "follow" })
      if (rangeStart > 0) req.setHeader("Range", `bytes=${rangeStart}-`)
      const abort = (): void => {
        try {
          req.abort()
        } catch {}
      }
      const timer = setTimeout(() => {
        abort()
        fail(new Error(`no response in ${TUNABLES.headerTimeoutMs / 1000}s`))
      }, TUNABLES.headerTimeoutMs)
      req.on("response", (res) => {
        clearTimeout(timer)
        const status = res.statusCode || 0
        if (status !== 200 && status !== 206) {
          abort()
          fail(new Error(`HTTP ${status}`))
          return
        }
        succeed({
          url,
          status,
          stream: res as unknown as Readable,
          total: totalFromHeaders(status, res.headers),
          offset: status === 206 ? rangeStart : 0,
          abort,
        })
      })
      req.on("error", (e: Error) => {
        clearTimeout(timer)
        fail(e)
      })
      req.end()
      return
    }

    const https = require("https") as typeof import("https")
    const open = (target: string, hops: number): void => {
      if (hops > 5) {
        fail(new Error("too many redirects"))
        return
      }
      const headers: Record<string, string> =
        rangeStart > 0 ? { Range: `bytes=${rangeStart}-` } : {}
      const req = https.get(target, { headers }, (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          open(new URL(res.headers.location, target).toString(), hops + 1)
          return
        }
        if (status !== 200 && status !== 206) {
          res.resume()
          req.destroy()
          fail(new Error(`HTTP ${status}`))
          return
        }
        succeed({
          url,
          status,
          stream: res,
          total: totalFromHeaders(status, res.headers),
          offset: status === 206 ? rangeStart : 0,
          abort: () => req.destroy(),
        })
      })
      req.setTimeout(TUNABLES.headerTimeoutMs, () =>
        req.destroy(
          new Error(`no response in ${TUNABLES.headerTimeoutMs / 1000}s`),
        ),
      )
      req.on("error", fail)
    }
    open(url, 0)
  })
}

/**
 * Race the candidates: start the first, and if it hasn't answered within the
 * stagger delay let the next join in, and so on. Resolves with the first stream
 * to produce response headers; every other in-flight request is aborted.
 */
function raceOpen(
  urls: string[],
  rangeStart: number,
  useNet: boolean,
  log: LogFn,
): Promise<Opened> {
  return new Promise<Opened>((resolve, reject) => {
    if (!urls.length) {
      reject(new Error("no download candidates"))
      return
    }
    let winner: Opened | null = null
    let launched = 0
    let pending = 0
    let staggerTimer: NodeJS.Timeout | null = null
    const errors: string[] = []

    const launchNext = (): void => {
      if (winner || launched >= urls.length) return
      const url = urls[launched++]
      pending++
      if (staggerTimer) clearTimeout(staggerTimer)
      if (launched < urls.length)
        staggerTimer = setTimeout(launchNext, TUNABLES.staggerMs)

      openStream(url, rangeStart, useNet).then(
        (opened) => {
          pending--
          if (winner) {
            opened.abort()
            return
          }
          winner = opened
          if (staggerTimer) clearTimeout(staggerTimer)
          resolve(opened)
        },
        (err: Error) => {
          pending--
          errors.push(`${hostOf(url)}: ${err.message}`)
          if (winner) return
          log(`candidate failed (${hostOf(url)}): ${err.message}`)
          // Don't wait out the stagger when a candidate fails outright.
          launchNext()
          if (!pending && launched >= urls.length)
            reject(new Error(errors.join("; ")))
        },
      )
    }
    launchNext()
  })
}

async function digestOfFile(
  filePath: string,
  algo: string,
  encoding: "hex" | "base64",
): Promise<string> {
  const hash = crypto.createHash(algo)
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest(encoding)
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return (await digestOfFile(filePath, "sha256", "hex")).toLowerCase()
}

/**
 * Check a file against an npm-style integrity string ("sha512-<base64>", which
 * may list several space-separated hashes — any one matching is a pass).
 * Returns an error message, or null when it matches / can't be checked.
 */
async function integrityMismatch(
  filePath: string,
  integrity: string,
): Promise<string | null> {
  const entries = integrity.trim().split(/\s+/).filter(Boolean)
  let checked = 0
  for (const entry of entries) {
    const [algo, expected] = entry.split("-")
    if (!algo || !expected || !/^sha(256|384|512)$/.test(algo)) continue
    checked++
    if ((await digestOfFile(filePath, algo, "base64")) === expected) return null
  }
  return checked
    ? `integrity mismatch (expected ${integrity.slice(0, 24)}…)`
    : null
}

export interface DownloadOptions {
  /** Lowercase hex SHA-256 the finished file must match. */
  expectedSha?: string | null
  /** npm-style Subresource Integrity string, e.g. "sha512-<base64>". */
  expectedIntegrity?: string | null
  onProgress?: ProgressFn | null
  log?: LogFn
}

export interface DownloadResult {
  url: string
  bytes: number
  switches: number
}

/**
 * Download `urls` (equivalent copies of one file) to `destPath`, racing the
 * candidates and switching away from any source that turns out to be slow.
 * Writes to `${destPath}.part` and renames on success, so a partial transfer is
 * never visible at the final path.
 */
export async function downloadToFile(
  urls: string[],
  destPath: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const {
    expectedSha = null,
    expectedIntegrity = null,
    onProgress = null,
  } = opts
  const log: LogFn = opts.log || (() => {})
  const tmpPath = `${destPath}.part`
  try {
    fs.unlinkSync(tmpPath)
  } catch {}

  // Sources dropped for being slow or serving bad bytes. Without this the race
  // just picks them again — a fast-responding mirror that then trickles (or
  // hands back a corrupt copy) wins every restart, so the retry does nothing.
  const banned = new Set<string>()
  const liveCandidates = (): string[] => {
    const left = urls.filter((u) => !banned.has(u))
    // Everything has failed at least once: give the whole list another go
    // rather than dead-ending on a network where nothing is fast.
    if (!left.length) {
      banned.clear()
      return [...urls]
    }
    return left
  }

  let useNet = true
  let switches = 0
  let digestRetries = 0

  for (;;) {
    // Resume from what's actually on disk — not from a byte counter, which
    // would over-count anything the aborted writer never flushed.
    const startAt = fileSize(tmpPath)
    let opened: Opened
    try {
      opened = await raceOpen(liveCandidates(), startAt, useNet, log)
    } catch (e) {
      const err = e as Error
      if (useNet) {
        // Every candidate failed through Chromium. A wrong proxy setting looks
        // exactly like this, so try once more straight out of Node.
        log(
          `all candidates failed via proxy/net (${err.message}) — retrying direct`,
        )
        useNet = false
        continue
      }
      throw err
    }

    const resumed = opened.status === 206 && startAt > 0
    const total = opened.total
    let done = resumed ? startAt : 0
    let windowBytes = 0
    let windowStart = Date.now()
    let lastPaint = 0
    let rate = 0
    let abandoned = false

    if (resumed) log(`resuming from ${fmtMB(startAt)} at ${hostOf(opened.url)}`)
    else
      log(
        `downloading from ${hostOf(opened.url)}${total ? ` (${fmtMB(total)})` : ""}`,
      )

    const watchdog = setInterval(() => {
      const elapsed = Date.now() - windowStart
      if (elapsed < TUNABLES.watchdogWindowMs) return
      rate = (windowBytes / elapsed) * 1000
      windowBytes = 0
      windowStart = Date.now()
      if (rate >= TUNABLES.minBytesPerSec || switches >= TUNABLES.maxSwitches)
        return
      // With nothing else to switch to, a slow source still beats no source.
      if (urls.length < 2) return
      abandoned = true
      log(`${hostOf(opened.url)} is slow (${fmtRate(rate)}) — switching source`)
      opened.abort()
    }, TUNABLES.watchdogTickMs)

    opened.stream.on("data", (chunk: Buffer) => {
      done += chunk.length
      windowBytes += chunk.length
      if (!onProgress) return
      const now = Date.now()
      if (now - lastPaint < TUNABLES.progressThrottleMs) return
      lastPaint = now
      const live = (windowBytes / Math.max(1, now - windowStart)) * 1000
      const pct = total ? Math.min(99, Math.round((done / total) * 100)) : 0
      onProgress(
        pct,
        `${fmtMB(done)}${total ? ` / ${fmtMB(total)}` : ""} · ${fmtRate(live)}`,
      )
    })

    let transferErr: Error | null = null
    try {
      await pipeline(
        opened.stream,
        fs.createWriteStream(tmpPath, { flags: resumed ? "a" : "w" }),
      )
    } catch (e) {
      transferErr = e as Error
    } finally {
      clearInterval(watchdog)
    }

    const onDisk = fileSize(tmpPath)
    const short = !transferErr && total > 0 && onDisk < total
    // A "successful" response that delivered nothing is a failure, not a
    // finished download — otherwise an origin answering 200 with an empty body
    // would install a 0-byte node binary and fail much later, unexplained.
    const empty = !transferErr && !short && onDisk === 0
    if (transferErr || short || empty) {
      const why = abandoned
        ? "slow source"
        : short
          ? "connection closed early"
          : empty
            ? "empty response"
            : transferErr?.message || "transfer failed"
      banned.add(opened.url)
      if (switches >= TUNABLES.maxSwitches) throw transferErr || new Error(why)
      switches++
      log(
        `transfer interrupted (${why}) — retry ${switches}/${TUNABLES.maxSwitches}`,
      )
      continue
    }

    let badDigest: string | null = null
    if (expectedSha) {
      const actual = await sha256OfFile(tmpPath)
      if (actual !== expectedSha)
        badDigest = `SHA256 mismatch: expected ${expectedSha.slice(0, 12)}…, got ${actual.slice(0, 12)}…`
    }
    if (!badDigest && expectedIntegrity)
      badDigest = await integrityMismatch(tmpPath, expectedIntegrity)

    if (badDigest) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      if (digestRetries >= Math.min(urls.length, 3)) throw new Error(badDigest)
      // A corrupt (or tampered) mirror copy — start over from another source,
      // and never come back to this one for this file.
      digestRetries++
      banned.add(opened.url)
      log(`${badDigest} from ${hostOf(opened.url)} — refetching`)
      continue
    }

    if (onProgress) onProgress(100, fmtMB(done))
    fs.renameSync(tmpPath, destPath)
    return { url: opened.url, bytes: done, switches }
  }
}

/**
 * Race the candidates for a small text resource (SHASUMS256.txt, npm metadata).
 * Returns null when every candidate fails — callers treat these as best-effort.
 */
export async function fetchTextRacing(
  urls: string[],
  opts: { log?: LogFn; timeoutMs?: number } = {},
): Promise<string | null> {
  const log: LogFn = opts.log || (() => {})
  const timeoutMs = opts.timeoutMs ?? TUNABLES.textTimeoutMs
  for (const useNet of [true, false]) {
    let opened: Opened
    try {
      opened = await raceOpen(urls, 0, useNet, log)
    } catch (e) {
      log(`text fetch failed (${(e as Error).message})`)
      continue
    }
    try {
      return await new Promise<string>((resolve, reject) => {
        let body = ""
        const timer = setTimeout(() => {
          opened.abort()
          reject(new Error("body timeout"))
        }, timeoutMs)
        opened.stream.setEncoding?.("utf-8")
        opened.stream.on("data", (c: string | Buffer) => {
          body += c.toString()
        })
        opened.stream.on("end", () => {
          clearTimeout(timer)
          resolve(body)
        })
        opened.stream.on("error", (err: Error) => {
          clearTimeout(timer)
          reject(err)
        })
      })
    } catch (e) {
      log(
        `text body failed from ${hostOf(opened.url)}: ${(e as Error).message}`,
      )
    }
  }
  return null
}

/**
 * Time-boxed probe: ask every base for the same small resource at once and
 * return whichever answers first.
 *
 * This exists for the one download the racing logic above cannot reach — agent
 * runtimes install through a child `npm` process, which takes a single registry
 * URL and no candidate list. Measuring beats guessing at the user's region:
 * a mainland user on an English-locale machine is invisible to detection but
 * very visible to a 2-second probe.
 */
export async function fastestBase(
  bases: string[],
  relPath: string,
  opts: { timeoutMs?: number; log?: LogFn } = {},
): Promise<string | null> {
  const log: LogFn = opts.log || (() => {})
  const timeoutMs = opts.timeoutMs ?? 2500
  if (bases.length < 2) return bases[0] ?? null

  const started = Date.now()
  // Resolve on the first success rather than Promise.any, which needs a newer
  // lib target than this project compiles against.
  let settle: (base: string | null) => void = () => {}
  const firstSuccess = new Promise<string | null>((resolve) => {
    settle = resolve
  })
  let outstanding = bases.length
  const attempts = bases.map((base) =>
    openStream(`${base}/${relPath}`, 0, true).then(
      (opened) => {
        opened.abort() // headers are all we needed
        settle(base)
      },
      () => {
        if (--outstanding === 0) settle(null)
      },
    ),
  )
  // Register the no-op handlers now: a candidate that fails after the winner is
  // decided would otherwise surface as an unhandled rejection and, in main,
  // that is wired to the crash reporter.
  attempts.forEach((p) => p.catch(() => {}))
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs),
  )
  try {
    const winner = await Promise.race([firstSuccess, timeout])
    if (winner)
      log(`registry probe: ${hostOf(winner)} won in ${Date.now() - started}ms`)
    else log(`registry probe: no origin answered in ${timeoutMs}ms`)
    return winner
  } catch {
    return null
  }
}

/** Same as fetchTextRacing, parsed as JSON. Null on any failure. */
export async function fetchJsonRacing<T>(
  urls: string[],
  opts: { log?: LogFn; timeoutMs?: number } = {},
): Promise<T | null> {
  const text = await fetchTextRacing(urls, opts)
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
