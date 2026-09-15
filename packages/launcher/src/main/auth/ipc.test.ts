import { beforeEach, expect, it, vi } from "vitest"

const fakes = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  accountDeps: null as null | { onChange: (info: unknown) => void },
  bearer: vi.fn(),
  signOut: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  hostSignOut: vi.fn(),
  whenCleared: vi.fn(),
  sendSession: vi.fn(),
  sendNotice: vi.fn(),
  send: vi.fn(),
  isWorkspaceSender: vi.fn(),
  setAppearance: vi.fn(),
  createPairingCode: vi.fn(),
  nodeStatus: vi.fn(),
  connectNode: vi.fn(),
}))
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => fakes.handlers.set(name, handler),
    on: (name: string, handler: (...args: any[]) => any) => fakes.listeners.set(name, handler),
  },
}))
vi.mock("../web-security", () => ({ openExternalSafely: vi.fn() }))
vi.mock("./account", () => ({
  AccountManager: class {
    constructor(deps: { onChange: (info: unknown) => void }) { fakes.accountDeps = deps }
    getAccount() { return { email: "person@example.test" } }
    embeddedSession() { return { token: "renewed", email: "person@example.test", displayName: null, expiresAt: 1 } }
    bearer = fakes.bearer
    signOut = fakes.signOut
    createPairingCode = fakes.createPairingCode
  },
}))
vi.mock("../workspace-host", () => ({
  WorkspaceHost: class {
    show = fakes.show; hide = fakes.hide; isWorkspaceSender = fakes.isWorkspaceSender
    signOut = fakes.hostSignOut; whenCleared = fakes.whenCleared
    sendSession = fakes.sendSession; sendNotice = fakes.sendNotice
    currentSession = () => null
  },
}))
import { registerAccountIpc } from "./ipc"

const status = {
  hostname: "Review laptop", deviceType: "laptop", connected: false,
  nodeId: null, workspaceId: null, workspaceSlug: null, workspaceName: null, endpoint: null,
  workspaces: [], revoked: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  fakes.handlers.clear()
  fakes.listeners.clear()
  fakes.bearer.mockResolvedValue("token")
  fakes.whenCleared.mockResolvedValue(undefined)
  fakes.isWorkspaceSender.mockReturnValue(true)
  fakes.nodeStatus.mockResolvedValue(status)
  fakes.createPairingCode.mockResolvedValue("TEST-CODE")
  registerAccountIpc({
    appearance: () => ({ theme: "system", language: "en" }),
    setAppearance: fakes.setAppearance, endpoint: () => undefined,
    getWindow: () => ({ webContents: { send: fakes.send } }) as never,
    connectNode: fakes.connectNode, nodeStatus: fakes.nodeStatus,
  })
})

const bounds = { x: 0, y: 40, width: 1000, height: 700 }

it("does not cover local tools when an earlier workspace token refresh finishes", async () => {
  let finish!: () => void
  fakes.bearer.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  const opening = fakes.handlers.get("workspace-view:show")!({}, null, bounds)
  fakes.handlers.get("workspace-view:hide")!()
  finish()
  await opening
  expect(fakes.hide).toHaveBeenCalledOnce()
  expect(fakes.show).not.toHaveBeenCalled()
})

it("shows the latest workspace request even if an earlier refresh is slower", async () => {
  let finish!: () => void
  fakes.bearer.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  const earlier = fakes.handlers.get("workspace-view:show")!({}, "earlier", bounds)
  await fakes.handlers.get("workspace-view:show")!({}, "latest", bounds)
  finish()
  await earlier
  expect(fakes.show).toHaveBeenCalledExactlyOnceWith("latest", bounds, null)
})

it("ends the page and wipes its storage however the account ends", () => {
  fakes.accountDeps!.onChange(null)
  expect(fakes.hostSignOut).toHaveBeenCalledOnce()
  expect(fakes.send).toHaveBeenCalledWith("account:changed", null)
})

it("does not show a page for an account that ended while its token was refreshing", async () => {
  let finish!: () => void
  fakes.bearer.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  const opening = fakes.handlers.get("workspace-view:show")!({}, null, bounds)
  fakes.accountDeps!.onChange(null)
  finish()
  await opening
  expect(fakes.show).not.toHaveBeenCalled()
})

it("hands a renewed session to the loaded page", () => {
  fakes.accountDeps!.onChange({ email: "person@example.test" })
  expect(fakes.sendSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ token: "renewed" }))
  expect(fakes.hostSignOut).not.toHaveBeenCalled()
})

it("creates no view until the last sign-out has finished wiping storage", async () => {
  let wiped!: () => void
  fakes.whenCleared.mockReturnValueOnce(new Promise<void>(resolve => { wiped = resolve }))
  const opening = fakes.handlers.get("workspace-view:show")!({}, null, bounds)
  await Promise.resolve(); await Promise.resolve()
  expect(fakes.show).not.toHaveBeenCalled()
  wiped()
  await opening
  expect(fakes.show).toHaveBeenCalledOnce()
})

it("resolves a sign-out only once the page's storage is gone", async () => {
  let wiped!: () => void
  fakes.whenCleared.mockReturnValueOnce(new Promise<void>(resolve => { wiped = resolve }))
  let done = false
  const signingOut = fakes.handlers.get("account:sign-out")!().then(() => { done = true })
  expect(fakes.signOut).toHaveBeenCalledOnce()
  await Promise.resolve()
  expect(done).toBe(false)
  wiped()
  await signingOut
  expect(done).toBe(true)
})

it("ends the account when the owned page asks to sign out, and ignores anyone else", () => {
  fakes.isWorkspaceSender.mockReturnValueOnce(false)
  fakes.listeners.get("workspace-view:sign-out")!({ sender: {} })
  expect(fakes.signOut).not.toHaveBeenCalled()
  fakes.listeners.get("workspace-view:sign-out")!({ sender: {} })
  expect(fakes.signOut).toHaveBeenCalledOnce()
})

it("never takes a session reported by the page", () => {
  expect(fakes.listeners.has("workspace-view:session-changed")).toBe(false)
})

it("repeats only well-formed notices inside the page", () => {
  const notice = fakes.handlers.get("workspace-view:notice")!
  notice({}, { message: "Opened in your browser", type: "script" })
  notice({}, { message: "", type: "info" })
  notice({}, null)
  expect(fakes.sendNotice).not.toHaveBeenCalled()
  notice({}, { message: "Opened in your browser", type: "info" })
  expect(fakes.sendNotice).toHaveBeenCalledExactlyOnceWith({ message: "Opened in your browser", type: "info" })
})

it("checks the computer without generating a pairing code", async () => {
  const info = await fakes.handlers.get("workspace-view:computer-status")!({}, "workspace-a")
  expect(info).toEqual({ hostname: "Review laptop", deviceType: "laptop", nodeId: null, warning: false })
  expect(fakes.createPairingCode).not.toHaveBeenCalled()
  expect(fakes.connectNode).not.toHaveBeenCalled()
})

it("returns only the requested workspace registration and reuses an existing connection", async () => {
  fakes.nodeStatus.mockResolvedValue({ ...status, workspaces: [
    { workspaceId: "workspace-b", nodeId: "node-b", endpoint: "private-b" },
    { workspaceId: "workspace-a", nodeId: "node-a", endpoint: "private-a" },
  ] })
  const info = await fakes.handlers.get("workspace-view:connect-computer")!({}, "workspace-a")
  expect(info).toEqual({ hostname: "Review laptop", deviceType: "laptop", nodeId: "node-a", warning: false })
  expect(fakes.createPairingCode).not.toHaveBeenCalled()
})

it("pairs once for concurrent requests and returns the node id and daemon warning", async () => {
  fakes.connectNode.mockResolvedValue({ ...status, warning: "daemon could not start", workspaces: [{ workspaceId: "workspace-a", nodeId: "this-node" }] })
  const connect = fakes.handlers.get("workspace-view:connect-computer")!
  const [first, second] = await Promise.all([connect({}, "workspace-a"), connect({}, "workspace-a")])
  expect(first).toEqual({ hostname: "Review laptop", deviceType: "laptop", nodeId: "this-node", warning: true })
  expect(second).toEqual(first)
  expect(fakes.createPairingCode).toHaveBeenCalledExactlyOnceWith("workspace-a")
  expect(fakes.connectNode).toHaveBeenCalledExactlyOnceWith("TEST-CODE")
})

it("rejects computer requests from a page outside the owned workspace", async () => {
  fakes.isWorkspaceSender.mockReturnValue(false)
  for (const name of ["workspace-view:computer-status", "workspace-view:connect-computer"]) {
    await expect(fakes.handlers.get(name)!({}, "workspace-a")).rejects.toThrow("Invalid workspace connection request")
  }
  expect(fakes.nodeStatus).not.toHaveBeenCalled()
  expect(fakes.createPairingCode).not.toHaveBeenCalled()
})

it("allows a failed connection to be retried", async () => {
  fakes.createPairingCode.mockRejectedValueOnce(new Error("HTTP 403"))
  const connect = fakes.handlers.get("workspace-view:connect-computer")!
  await expect(connect({}, "workspace-a")).rejects.toThrow("HTTP 403")
  fakes.connectNode.mockResolvedValue({ ...status, warning: null, workspaces: [{ workspaceId: "workspace-a", nodeId: "this-node" }] })
  expect((await connect({}, "workspace-a")).nodeId).toBe("this-node")
})

it("follows theme and language changes only from the owned page", () => {
  const theme = fakes.listeners.get("workspace-view:theme-changed")!
  const locale = fakes.listeners.get("workspace-view:locale-changed")!
  fakes.isWorkspaceSender.mockReturnValue(false)
  theme({ sender: {} }, "dark")
  locale({ sender: {} }, "zh-CN")
  expect(fakes.setAppearance).not.toHaveBeenCalled()
  fakes.isWorkspaceSender.mockReturnValue(true)
  theme({ sender: {} }, "sepia")
  locale({ sender: {} }, null)
  expect(fakes.setAppearance).not.toHaveBeenCalled()
  theme({ sender: {} }, "dark")
  locale({ sender: {} }, "zh-CN")
  expect(fakes.setAppearance).toHaveBeenNthCalledWith(1, { theme: "dark" })
  expect(fakes.setAppearance).toHaveBeenNthCalledWith(2, { language: "zh" })
})

it("hands the page the web origin its shared links must carry", () => {
  const event: { returnValue?: { webUrl?: string } } = {}
  fakes.listeners.get("workspace-view:config")!(event)
  expect(event.returnValue?.webUrl).toBe("https://workspace.openagents.org")
})
