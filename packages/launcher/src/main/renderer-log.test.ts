import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import {
  appendRendererLog,
  attachRendererLogging,
  type LoggableWebContents,
} from "./renderer-log"

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "oa-rlog-"))
  file = path.join(dir, "renderer.log")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** Minimal event-emitter standing in for a WebContents. */
function fakeContents(): LoggableWebContents & {
  emit: (event: string, ...args: unknown[]) => void
} {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, listener)
    },
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.(...args)
    },
  } as never
}

describe("appendRendererLog", () => {
  it("creates the directory and appends timestamped lines", () => {
    const nested = path.join(dir, "deep", "renderer.log")
    appendRendererLog("hello", nested)
    appendRendererLog("world", nested)
    const lines = fs.readFileSync(nested, "utf-8").trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*hello$/)
    expect(lines[1]).toMatch(/world$/)
  })

  it("rotates to .old past the size cap instead of growing forever", () => {
    fs.writeFileSync(file, "x".repeat(2 * 1024 * 1024))
    appendRendererLog("after rotation", file)
    expect(fs.existsSync(`${file}.old`)).toBe(true)
    expect(fs.readFileSync(file, "utf-8")).toMatch(/after rotation/)
    expect(fs.statSync(file).size).toBeLessThan(1024)
  })
})

describe("attachRendererLogging", () => {
  it("records console messages with level and trimmed source (legacy positional args)", () => {
    const wc = fakeContents()
    attachRendererLogging(wc, file)
    wc.emit(
      "console-message",
      null,
      3,
      "boom: undefined is not a function",
      42,
      "app://bundle/assets/index-abc123.js",
    )
    const out = fs.readFileSync(file, "utf-8")
    expect(out).toMatch(/\[error\] index-abc123\.js:42 boom/)
    expect(out).not.toMatch(/app:\/\/bundle\/assets/)
  })

  it("records console messages from the Electron >= 32 event-object shape", () => {
    const wc = fakeContents()
    attachRendererLogging(wc, file)
    wc.emit("console-message", {
      message: "modern boom",
      level: "error",
      lineNumber: 7,
      sourceId: "app://bundle/assets/index-def456.js",
    })
    const out = fs.readFileSync(file, "utf-8")
    expect(out).toMatch(/\[error\] index-def456\.js:7 modern boom/)
  })

  it("records renderer crashes and load failures", () => {
    const wc = fakeContents()
    attachRendererLogging(wc, file)
    wc.emit("render-process-gone", null, { reason: "crashed", exitCode: 5 })
    wc.emit("did-fail-load", null, -105, "ERR_NAME_NOT_RESOLVED", "app://x")
    const out = fs.readFileSync(file, "utf-8")
    expect(out).toMatch(/\[crash\] renderer gone: crashed \(exit 5\)/)
    expect(out).toMatch(/\[load-error\] -105 ERR_NAME_NOT_RESOLVED app:\/\/x/)
  })
})
