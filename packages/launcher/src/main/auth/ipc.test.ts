import { beforeEach, expect, it, vi } from "vitest"

const fakes = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  bearer: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  isWorkspaceSender: vi.fn(),
  createPairingCode: vi.fn(),
  nodeStatus: vi.fn(),
  connectNode: vi.fn(),
}))
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: any[]) => any) => fakes.handlers.set(name, handler),
    on: vi.fn(),
  },
}))
vi.mock("../web-security", () => ({ openExternalSafely: vi.fn() }))
vi.mock("./account", () => ({
  AccountManager: class {
    getAccount() { return { email: "person@example.test" } }
    bearer = fakes.bearer
    createPairingCode = fakes.createPairingCode
  },
}))
vi.mock("../workspace-host", () => ({
  WorkspaceHost: class { show = fakes.show; hide = fakes.hide; isWorkspaceSender = fakes.isWorkspaceSender },
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
  fakes.isWorkspaceSender.mockReturnValue(true)
  fakes.nodeStatus.mockResolvedValue(status)
  fakes.createPairingCode.mockResolvedValue("TEST-CODE")
  registerAccountIpc({
    appearance: () => ({ theme: "system", language: "en" }),
    setAppearance: vi.fn(), endpoint: () => undefined,
    getWindow: () => null, connectNode: fakes.connectNode, nodeStatus: fakes.nodeStatus,
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
  fakes.bearer.mockResolvedValueOnce("fresh")
  const earlier = fakes.handlers.get("workspace-view:show")!({}, "earlier", bounds)
  await fakes.handlers.get("workspace-view:show")!({}, "latest", bounds)
  finish()
  await earlier
  expect(fakes.show).toHaveBeenCalledExactlyOnceWith("latest", bounds, null)
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
