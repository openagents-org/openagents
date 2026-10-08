import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { tailLogs } from "./daemon-logs"

let dir: string
let logFile: string

const lineOf = (i: number, agent = "alpha") => `[10:00:00] ${agent}: line ${i}`
const write = (lines: string[]) =>
  fs.writeFileSync(logFile, lines.map((l) => `${l}\n`).join(""))
const append = (text: string) => fs.appendFileSync(logFile, text)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-daemon-logs-"))
  logFile = path.join(dir, "daemon.log")
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("tailLogs", () => {
  it("returns the last lines and the offset to resume from", () => {
    write(Array.from({ length: 10 }, (_, i) => lineOf(i)))
    const tail = tailLogs(logFile, { count: 3, offset: 0 })
    expect(tail.lines).toEqual([lineOf(7), lineOf(8), lineOf(9)])
    expect(tail.size).toBe(fs.statSync(logFile).size)
    expect(tail.reset).toBe(false)
  })

  it("returns nothing when nothing was appended", () => {
    write([lineOf(0), lineOf(1)])
    const first = tailLogs(logFile, { count: 2000, offset: 0 })
    const again = tailLogs(logFile, { count: 2000, offset: first.size })
    expect(again).toEqual({ lines: [], size: first.size, reset: false })
  })

  it("returns only what was appended since the offset", () => {
    write([lineOf(0)])
    const first = tailLogs(logFile, { count: 2000, offset: 0 })
    append(`${lineOf(1)}\n${lineOf(2)}\n`)
    const next = tailLogs(logFile, { count: 2000, offset: first.size })
    expect(next.lines).toEqual([lineOf(1), lineOf(2)])
    expect(next.size).toBe(fs.statSync(logFile).size)
  })

  it("leaves a half-written line for the next read", () => {
    write([lineOf(0)])
    const first = tailLogs(logFile, { count: 2000, offset: 0 })
    append(`${lineOf(1)}\n[10:00:01] alpha: hal`)
    const next = tailLogs(logFile, { count: 2000, offset: first.size })
    expect(next.lines).toEqual([lineOf(1)])
    append("f done\n")
    const rest = tailLogs(logFile, { count: 2000, offset: next.size })
    expect(rest.lines).toEqual(["[10:00:01] alpha: half done"])
  })

  it("starts over when the file shrank", () => {
    write(Array.from({ length: 5 }, (_, i) => lineOf(i)))
    const first = tailLogs(logFile, { count: 2000, offset: 0 })
    write([lineOf(9)])
    const next = tailLogs(logFile, { count: 2000, offset: first.size })
    expect(next.lines).toEqual([lineOf(9)])
    expect(next.reset).toBe(true)
  })

  it("filters by agent, keeping daemon lines", () => {
    write([lineOf(0, "alpha"), lineOf(1, "beta"), "[10:00:00] Daemon started", lineOf(2, "beta")])
    const tail = tailLogs(logFile, { agent: "alpha", count: 2000, offset: 0 })
    expect(tail.lines).toEqual([lineOf(0, "alpha"), "[10:00:00] Daemon started"])
  })

  it("stitches lines across read chunks without reading the whole file", () => {
    // ~2.4 MB: many 64 KB chunks, and lines that straddle chunk boundaries.
    const lines = Array.from({ length: 30_000 }, (_, i) => `${lineOf(i)} ${"x".repeat(i % 97)}`)
    write(lines)
    const readSync = vi.spyOn(fs, "readSync")
    const tail = tailLogs(logFile, { count: 2000, offset: 0 })
    expect(tail.lines).toEqual(lines.slice(-2000))
    expect(readSync).toHaveBeenCalled()
    const bytesRead = readSync.mock.calls.reduce((n, call) => n + ((call as unknown[])[3] as number), 0)
    expect(bytesRead).toBeLessThan(fs.statSync(logFile).size / 4)
  })

  it("treats a missing file as empty", () => {
    expect(tailLogs(logFile, { count: 10, offset: 0 })).toEqual({ lines: [], size: 0, reset: false })
  })
})
