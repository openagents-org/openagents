import { beforeEach, expect, it, vi } from "vitest"
import { useAccountStore } from "./account"
import { useUiStore } from "./ui"

vi.mock("../lib/analytics", () => ({ capture: vi.fn() }))

const account = { email: "person@example.test", displayName: "Person", expiresAt: 9999999999 }

beforeEach(() => {
  localStorage.clear()
  useAccountStore.setState({
    account: null, mode: "workspace", authMode: "welcome",
    workspaceTarget: null, workspaceTargetSignal: 0, ready: false,
  })
  window.api = {
    getAccount: vi.fn().mockResolvedValue(account),
    onAccountChanged: vi.fn(),
    onSignInExternal: vi.fn(),
    onSignInFailed: vi.fn(),
    onWorkspaceAction: vi.fn(),
    openWorkspaceHome: vi.fn(),
  } as unknown as typeof window.api
})

it("finishes startup if a hot-reloaded renderer has the previous preload bridge", async () => {
  delete (window.api as Partial<typeof window.api>).onWorkspaceAction
  await useAccountStore.getState().init()
  expect(window.api.getAccount).toHaveBeenCalledOnce()
  expect(useAccountStore.getState()).toMatchObject({ ready: true, account, mode: "workspace" })
})

it("keeps local tools accessible when the account read fails", async () => {
  vi.mocked(window.api.getAccount).mockRejectedValueOnce(new Error("IPC unavailable"))
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  await useAccountStore.getState().init()
  expect(useAccountStore.getState()).toMatchObject({ ready: true, account: null, mode: "workspace", authMode: "welcome" })
  useAccountStore.getState().exitWorkspace()
  expect(useAccountStore.getState().mode).toBe("launcher")
  error.mockRestore()
})

it("routes a shared web request to This Computer and retains it when the session ends", async () => {
  await useAccountStore.getState().init()
  vi.mocked(window.api.onWorkspaceAction).mock.calls[0][0]("computer")
  vi.mocked(window.api.onAccountChanged).mock.calls[0][0](null)
  expect(useAccountStore.getState()).toMatchObject({ mode: "launcher", account: null })
  expect(localStorage.getItem("openagents:last-area")).toBe("launcher")
})

it("reopens This Computer where it was left unless a destination is given", () => {
  useUiStore.getState().setCurrentTab("logs")
  useAccountStore.getState().exitWorkspace()
  expect(useUiStore.getState().currentTab).toBe("logs")
  useAccountStore.getState().exitWorkspace("install")
  expect(useUiStore.getState().currentTab).toBe("install")
})

it("signed out, Workspace starts at Welcome and sign-in can go back to it", () => {
  useAccountStore.getState().openSignIn()
  expect(useAccountStore.getState()).toMatchObject({ mode: "workspace", authMode: "sign-in" })
  useAccountStore.getState().showWelcome()
  expect(useAccountStore.getState()).toMatchObject({ mode: "workspace", authMode: "welcome" })
})

it("opens a requested workspace in the app, once", () => {
  useAccountStore.getState().exitWorkspace()
  useAccountStore.getState().openWorkspace({ slug: "team", token: "device-token" })
  expect(useAccountStore.getState()).toMatchObject({
    mode: "workspace", workspaceTarget: { slug: "team", token: "device-token" }, workspaceTargetSignal: 1,
  })
  useAccountStore.getState().clearWorkspaceTarget()
  expect(useAccountStore.getState().workspaceTarget).toBeNull()
})
