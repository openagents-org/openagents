import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { WorkspaceSignIn } from "./sign-in"
import { useAccountStore } from "../../store/account"
import i18n from "../../i18n"

vi.mock("../../lib/analytics", () => ({ capture: vi.fn() }))

/** QR sign-in stays hidden until it is turned on for testing. */

beforeEach(async () => {
  await i18n.changeLanguage("en")
  localStorage.removeItem("oa_qr_login")
  useAccountStore.setState({ account: null, mode: "workspace", authMode: "sign-in", error: null, signingIn: false })
  window.api = {
    getCaptchaConfig: vi.fn().mockResolvedValue({ enabled: false, appId: null, scriptUrl: "", surfaces: {} }),
    qrSignInEnabled: vi.fn().mockResolvedValue(false),
    startQrSignIn: vi.fn().mockResolvedValue({ id: "req-0123456789abcdef", qrUrl: "https://workspace.openagents.org/qr-login?id=req-0123456789abcdef", expiresAt: Date.now() + 120_000, pollIntervalMs: 10 }),
    pollQrSignIn: vi.fn().mockResolvedValue("scanned"),
  } as unknown as typeof window.api
})
afterEach(() => localStorage.removeItem("oa_qr_login"))

it("is hidden by default", async () => {
  render(<WorkspaceSignIn />)
  await waitFor(() => expect(window.api.qrSignInEnabled).toHaveBeenCalled())
  expect(screen.queryByTestId("qr-sign-in-open")).toBeNull()
})

it("shows the code when turned on with OPENAGENTS_QR_LOGIN, and follows the scan", async () => {
  vi.mocked(window.api.qrSignInEnabled).mockResolvedValue(true)
  render(<WorkspaceSignIn />)
  fireEvent.click(await screen.findByTestId("qr-sign-in-open"))
  await waitFor(() => expect(window.api.startQrSignIn).toHaveBeenCalled())
  expect(await screen.findByText("Confirm the sign-in on your phone.")).toBeVisible()
  expect(window.api.pollQrSignIn).toHaveBeenCalledWith("req-0123456789abcdef")
})

it("can be turned on from devtools with localStorage", async () => {
  localStorage.setItem("oa_qr_login", "1")
  render(<WorkspaceSignIn />)
  expect(await screen.findByTestId("qr-sign-in-open")).toBeVisible()
})

it("is not offered while creating an account", async () => {
  localStorage.setItem("oa_qr_login", "1")
  render(<WorkspaceSignIn />)
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }))
  expect(screen.queryByTestId("qr-sign-in-open")).toBeNull()
})
