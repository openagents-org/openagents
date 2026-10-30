import { beforeEach, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { WorkspaceSignIn } from "./sign-in"
import { useAccountStore } from "../../store/account"
import i18n from "../../i18n"

vi.mock("../../lib/analytics", () => ({ capture: vi.fn() }))

beforeEach(async () => {
  await i18n.changeLanguage("en")
  useAccountStore.setState({ account: null, mode: "workspace", authMode: "sign-in", error: null, signingIn: false })
  window.api = {
    signUpWithPassword: vi.fn().mockResolvedValue({ email: "person@example.test", displayName: "Person", expiresAt: 9999999999 }),
    signInWithPassword: vi.fn(),
    getCaptchaConfig: vi.fn().mockResolvedValue({ enabled: false, appId: null, scriptUrl: "", surfaces: {} }),
  } as unknown as typeof window.api
  delete window.TencentCaptcha
})

function fill(id: string, value: string): void {
  fireEvent.change(document.getElementById(id)!, { target: { value } })
}

function openRegistration(): void {
  render(<WorkspaceSignIn />)
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }))
}

it("offers registration beside email sign-in and preserves the email when switching back", () => {
  render(<WorkspaceSignIn />)
  fill("sign-in-email", "person@example.test")
  fill("sign-in-password", "ExistingPassword1!")
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }))
  expect(screen.getByRole("heading", { name: "Create your OpenAgents account" })).toBeVisible()
  expect(document.getElementById("sign-in-email")).toHaveValue("person@example.test")
  expect(document.getElementById("sign-in-password")).toHaveValue("")
  expect(document.getElementById("sign-in-password")).toHaveAttribute("autocomplete", "new-password")
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  expect(screen.getByRole("heading", { name: "Sign in to OpenAgents" })).toBeVisible()
  expect(document.getElementById("sign-in-email")).toHaveValue("person@example.test")
})

it("checks confirmation before creating the account and opens the returned session", async () => {
  openRegistration()
  fill("sign-up-name", "Person")
  fill("sign-in-email", "person@example.test")
  fill("sign-in-password", "NewAccount1!")
  fill("sign-up-confirm", "Different1!")
  fireEvent.click(screen.getByRole("button", { name: "Create account" }))
  expect(screen.getByText("The passwords do not match.")).toBeVisible()
  expect(window.api.signUpWithPassword).not.toHaveBeenCalled()
  fill("sign-up-confirm", "NewAccount1!")
  fireEvent.click(screen.getByRole("button", { name: "Create account" }))
  await waitFor(() => expect(useAccountStore.getState().account?.email).toBe("person@example.test"))
  // fourth argument = captcha pass; none while the service does not require one
  expect(window.api.signUpWithPassword).toHaveBeenCalledExactlyOnceWith("person@example.test", "NewAccount1!", "Person", undefined)
})

it("explains a duplicate email and keeps the sign-in switch available", async () => {
  vi.mocked(window.api.signUpWithPassword).mockRejectedValueOnce(new Error("SIGN_UP_EMAIL_EXISTS"))
  openRegistration()
  fill("sign-in-email", "person@example.test")
  fill("sign-in-password", "NewAccount1!")
  fill("sign-up-confirm", "NewAccount1!")
  fireEvent.click(screen.getByRole("button", { name: "Create account" }))
  expect(await screen.findByText("This email is already registered. Sign in with your existing account.")).toBeVisible()
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled()
})

it("switches to sign-in if the account was created but Workspace could not open", async () => {
  vi.mocked(window.api.signUpWithPassword).mockRejectedValueOnce(new Error("SIGN_UP_SESSION_FAILED"))
  openRegistration()
  fill("sign-in-email", "person@example.test")
  fill("sign-in-password", "NewAccount1!")
  fill("sign-up-confirm", "NewAccount1!")
  fireEvent.click(screen.getByRole("button", { name: "Create account" }))
  expect(await screen.findByText("Your account was created, but Workspace could not open. Please sign in to continue.")).toBeVisible()
  expect(screen.getByRole("heading", { name: "Sign in to OpenAgents" })).toBeVisible()
  expect(document.getElementById("sign-in-email")).toHaveValue("person@example.test")
})

it("submits without a captcha pass while the service does not require one", async () => {
  vi.mocked(window.api.signInWithPassword).mockResolvedValueOnce({ email: "person@example.test", displayName: null, expiresAt: 9999999999 })
  render(<WorkspaceSignIn />)
  fill("sign-in-email", "person@example.test")
  fill("sign-in-password", "ExistingPassword1!")
  fireEvent.click(screen.getByTestId("sign-in-submit"))
  await waitFor(() => expect(window.api.signInWithPassword).toHaveBeenCalledExactlyOnceWith("person@example.test", "ExistingPassword1!", undefined))
})

it("mounts the I-am-human box when the service requires it and sends the pass from the tick", async () => {
  vi.mocked(window.api.getCaptchaConfig).mockResolvedValue({
    enabled: true, appId: "190000001", scriptUrl: "https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js",
    surfaces: { login: true, register: true },
  })
  // Stand-in for TJNCaptcha-global.js: (container, appId, callback, options); show() draws the
  // checkbox in the container; the tick is simulated by invoking the stored callback.
  const ctor = vi.fn()
  let tick: ((r: unknown) => void) | null = null
  const reload = vi.fn()
  window.TencentCaptcha = class {
    constructor(container: HTMLElement, appId: string, cb: (r: unknown) => void) {
      ctor(container, appId)
      tick = cb
    }
    show(): void {}
    reload = reload
    destroy(): void {}
  } as unknown as typeof window.TencentCaptcha
  vi.mocked(window.api.signInWithPassword).mockResolvedValueOnce({ email: "person@example.test", displayName: null, expiresAt: 9999999999 })

  render(<WorkspaceSignIn />)
  fill("sign-in-email", "person@example.test")
  fill("sign-in-password", "ExistingPassword1!")
  await waitFor(() => expect(ctor).toHaveBeenCalledWith(expect.any(HTMLDivElement), "190000001"))

  // Submitting before the tick: told to tick, nothing sent.
  fireEvent.click(screen.getByTestId("sign-in-submit"))
  expect(await screen.findByText('Tick "I am human" above, then try again.')).toBeVisible()
  expect(window.api.signInWithPassword).not.toHaveBeenCalled()

  tick!({ ret: 0, ticket: "tr03pass", randstr: "@r1" })
  fireEvent.click(screen.getByTestId("sign-in-submit"))
  await waitFor(() =>
    expect(window.api.signInWithPassword).toHaveBeenCalledExactlyOnceWith(
      "person@example.test", "ExistingPassword1!", { ticket: "tr03pass", randstr: "@r1" },
    ),
  )
  // single-use ticket: the box is reset for the next attempt
  await waitFor(() => expect(reload).toHaveBeenCalled())
})

it("explains a 428 from the service in the person's language", async () => {
  vi.mocked(window.api.signInWithPassword).mockRejectedValueOnce(new Error("SIGN_IN_CAPTCHA_REQUIRED"))
  render(<WorkspaceSignIn />)
  fill("sign-in-email", "person@example.test")
  fill("sign-in-password", "ExistingPassword1!")
  fireEvent.click(screen.getByTestId("sign-in-submit"))
  expect(await screen.findByText("Human verification did not complete. Please try again.")).toBeVisible()
})
