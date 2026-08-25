import { EventEmitter } from "events"
import { describe, it, expect, beforeEach, vi } from "vitest"

/**
 * A scripted `net.request`: each call takes the next behaviour off the queue.
 * "silent" is a socket that accepts the request and then never answers — the
 * shape a stalled relay actually takes, and the only way to reach the timeout.
 */
type Behavior =
  | { kind: "ok"; status: number; body: string }
  | { kind: "error"; message: string }
  | { kind: "silent" }

let script: Behavior[] = []
let calls: Array<{ url: string; method: string }> = []

function makeFakeRequest(opts: { url: string; method: string }): EventEmitter {
  calls.push({ url: opts.url, method: opts.method })
  const req = new EventEmitter() as EventEmitter & {
    setHeader: (k: string, v: string) => void
    write: (b: string) => void
    abort: () => void
    end: () => void
  }
  req.setHeader = () => {}
  req.write = () => {}
  req.abort = () => {}
  req.end = () => {
    const next = script.shift() || { kind: "silent" as const }
    if (next.kind === "silent") return
    setTimeout(() => {
      if (next.kind === "error") {
        req.emit("error", new Error(next.message))
        return
      }
      const res = new EventEmitter() as EventEmitter & { statusCode: number }
      res.statusCode = next.status
      req.emit("response", res)
      setTimeout(() => {
        res.emit("data", Buffer.from(next.body, "utf-8"))
        res.emit("end")
      }, 0)
    }, 0)
  }
  return req
}

vi.mock("electron", () => ({
  net: {
    request: (opts: { url: string; method: string }) => makeFakeRequest(opts),
  },
}))

import { httpRequestJson, httpRequestOnce } from "./llm-test"

beforeEach(() => {
  script = []
  calls = []
})

describe("httpRequestJson", () => {
  it("retries once when nothing answered", async () => {
    script = [
      { kind: "error", message: "net::ERR_CONNECTION_RESET" },
      { kind: "ok", status: 200, body: '{"ok":true}' },
    ]
    const r = await httpRequestJson(
      "https://relay.example.com/v1/models",
      "GET",
      {},
      null,
    )
    expect(r.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it("does not retry what the endpoint actually answered", async () => {
    // A 401 is the endpoint's verdict on the key. Asking twice wastes the
    // user's time and tells them nothing new.
    script = [{ kind: "ok", status: 401, body: "invalid key" }]
    const r = await httpRequestJson(
      "https://relay.example.com/v1/models",
      "GET",
      {},
      null,
    )
    expect(r.status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it("gives up after the retry rather than looping", async () => {
    script = [
      { kind: "error", message: "socket hang up" },
      { kind: "error", message: "socket hang up" },
    ]
    await expect(
      httpRequestJson("https://relay.example.com/v1/models", "GET", {}, null),
    ).rejects.toThrow(/socket hang up/)
    expect(calls).toHaveLength(2)
  })

  it("does not retry a URL that was never valid", async () => {
    await expect(httpRequestJson("not-a-url", "GET", {}, null)).rejects.toThrow(
      /Invalid URL/,
    )
    expect(calls).toHaveLength(0)
  })
})

describe("httpRequestOnce timeouts", () => {
  beforeEach(() => vi.useFakeTimers())

  it("waits longer on a POST than on a GET", async () => {
    // A GET lists models; a POST is a real completion a cold relay can sit on.
    script = [{ kind: "silent" }, { kind: "silent" }]

    const get = httpRequestOnce(
      "https://relay.example.com/v1/models",
      "GET",
      {},
      null,
    )
    const post = httpRequestOnce(
      "https://relay.example.com/v1/chat/completions",
      "POST",
      {},
      "{}",
    )
    const settled = { get: false, post: false }
    get.catch(() => (settled.get = true))
    post.catch(() => (settled.post = true))

    await vi.advanceTimersByTimeAsync(20_000)
    expect(settled).toEqual({ get: true, post: false })

    await vi.advanceTimersByTimeAsync(25_000)
    expect(settled).toEqual({ get: true, post: true })

    vi.useRealTimers()
  })
})
