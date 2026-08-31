import { createServer, type Server } from "node:net"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  session: {
    defaultSession: {
      resolveProxy: (): Promise<string> => Promise.resolve(resolveProxyResult),
      setProxy: (): Promise<void> => Promise.resolve(),
    },
    fromPartition: () => ({ setProxy: (): Promise<void> => Promise.resolve() }),
  },
}))

let resolveProxyResult = "DIRECT"

import { adoptSystemProxyForChildren, firstProxyUrl } from "./net-config"
import type { Store } from "./store"

const emptyStore = { get: () => undefined } as unknown as Store
const storeWith = (values: Record<string, string>): Store =>
  ({ get: (k: string) => values[k] }) as unknown as Store

const PROXY_KEYS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
]

function clearProxyEnv(): void {
  for (const k of PROXY_KEYS) delete process.env[k]
}

describe("firstProxyUrl", () => {
  it("reads a PAC list and skips DIRECT", () => {
    expect(firstProxyUrl("PROXY 127.0.0.1:7897")).toBe("http://127.0.0.1:7897")
    expect(firstProxyUrl("DIRECT;PROXY 10.0.0.1:8080")).toBe(
      "http://10.0.0.1:8080",
    )
    expect(firstProxyUrl("HTTPS gw.corp:443")).toBe("https://gw.corp:443")
  })

  it("returns null when there is nothing usable", () => {
    expect(firstProxyUrl("DIRECT")).toBeNull()
    expect(firstProxyUrl("")).toBeNull()
    expect(firstProxyUrl("PROXY")).toBeNull()
  })

  it("skips SOCKS, which undici cannot use from HTTPS_PROXY", () => {
    // Exporting one would swap a working direct connection for a broken tunnel.
    expect(firstProxyUrl("SOCKS5 127.0.0.1:7897")).toBeNull()
    expect(firstProxyUrl("SOCKS5 127.0.0.1:7897;PROXY 127.0.0.1:7890")).toBe(
      "http://127.0.0.1:7890",
    )
  })
})

/** A real listener, so the liveness check has something to connect to. */
let live: Server
let livePort = 0
const listening = new Promise<void>((resolve) => {
  live = createServer()
  live.listen(0, "127.0.0.1", () => {
    livePort = (live.address() as { port: number }).port
    resolve()
  })
})
afterAll(() => live?.close())

/** A port nothing is bound to — the "OS names a proxy that died" case. */
const DEAD_PORT = 9

describe("adoptSystemProxyForChildren", () => {
  it("hands the OS proxy to child processes when nothing else is set", async () => {
    await listening
    clearProxyEnv()
    resolveProxyResult = `PROXY 127.0.0.1:${livePort}`
    await adoptSystemProxyForChildren(emptyStore)
    // Electron follows the system proxy on its own; a spawned CLI reads only
    // these. Without them `kimi login` went direct while the browser half of
    // the same sign-in went through the tunnel.
    expect(process.env.HTTPS_PROXY).toBe(`http://127.0.0.1:${livePort}`)
    expect(process.env.https_proxy).toBe(`http://127.0.0.1:${livePort}`)
    expect(process.env.HTTP_PROXY).toBe(`http://127.0.0.1:${livePort}`)
  })

  it("leaves children direct when the OS names a proxy that is not running", async () => {
    // A tunnelling client in TUN mode keeps working after its HTTP listener
    // dies: direct connections still go through, but System Settings still
    // advertises the dead port. Exporting it would trade a working direct
    // connection for ECONNREFUSED in every spawned CLI.
    clearProxyEnv()
    resolveProxyResult = `PROXY 127.0.0.1:${DEAD_PORT}`
    await adoptSystemProxyForChildren(emptyStore)
    expect(process.env.HTTPS_PROXY).toBeUndefined()
    expect(process.env.HTTP_PROXY).toBeUndefined()
  })

  it("never tunnels localhost — the daemon and control server live there", async () => {
    await listening
    clearProxyEnv()
    resolveProxyResult = `PROXY 127.0.0.1:${livePort}`
    await adoptSystemProxyForChildren(emptyStore)
    expect(process.env.NO_PROXY).toContain("127.0.0.1")
    expect(process.env.NO_PROXY).toContain("localhost")
  })

  it("stays out of the way when Settings already specifies a proxy", async () => {
    clearProxyEnv()
    resolveProxyResult = "PROXY 127.0.0.1:7897"
    await adoptSystemProxyForChildren(
      storeWith({ httpsProxy: "http://corp:8080" }),
    )
    expect(process.env.HTTPS_PROXY).toBeUndefined()
  })

  it("sets nothing when the OS reports a direct connection", async () => {
    clearProxyEnv()
    resolveProxyResult = "DIRECT"
    await adoptSystemProxyForChildren(emptyStore)
    expect(process.env.HTTPS_PROXY).toBeUndefined()
    expect(process.env.NO_PROXY).toBeUndefined()
  })
})
