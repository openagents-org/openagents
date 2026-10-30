import { describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { OnboardingAgent } from "@renderer/types"
import { useOnboardingAuth } from "./use-onboarding-auth"

function installApi() {
  const api = {
    refreshLogin: vi.fn().mockResolvedValue({ installed: true, ready: true, logged_in: true }),
    healthCheck: vi.fn().mockResolvedValue({ installed: true, ready: true }),
    onCliLoginEvent: vi.fn(() => () => {}),
    cancelCliLogin: vi.fn().mockResolvedValue(undefined),
    saveAgentEnv: vi.fn().mockResolvedValue(undefined),
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

const codex = {
  name: "codex",
  authMode: "login",
  loginCommand: "codex login",
  envFields: [
    { name: "OPENAI_API_KEY", password: true },
    { name: "CODEX_MODEL" },
  ],
} as unknown as OnboardingAgent

describe("useOnboardingAuth — the sign-in path of an agent that also takes a key", () => {
  it("keeps the model for the agent, marked signed in, instead of saving it for the type", async () => {
    const api = installApi()
    const onSaved = vi.fn()
    const { result } = renderHook(() =>
      useOnboardingAuth({ active: true, entry: codex, showToast: vi.fn(), onSaved }),
    )
    await waitFor(() => expect(api.refreshLogin).toHaveBeenCalled())
    act(() => result.current.setValue("CODEX_MODEL", "gpt-5.5"))
    await act(() => result.current.saveAndContinue())

    expect(onSaved).toHaveBeenCalled()
    expect(api.saveAgentEnv).not.toHaveBeenCalled()
    expect(result.current.signedInEnv).toEqual({ CODEX_MODEL: "gpt-5.5", OPENAGENTS_AUTH_MODE: "cli_login" })
  })

  it("has no sign-in env on the key path", async () => {
    const api = installApi()
    const { result } = renderHook(() =>
      useOnboardingAuth({ active: true, entry: codex, showToast: vi.fn(), onSaved: vi.fn() }),
    )
    await waitFor(() => expect(api.refreshLogin).toHaveBeenCalled())
    act(() => result.current.setValue("OPENAI_API_KEY", "sk-new"))
    await act(() => result.current.saveAndContinue())

    expect(api.saveAgentEnv).toHaveBeenCalled()
    expect(result.current.signedInEnv).toBeNull()
  })
})
