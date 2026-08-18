import { describe, expect, it } from "vitest"

import { loginVerdict } from "./login-probe"
import { DUAL_LOGIN_AGENTS, HOSTED_LOGIN_AGENTS } from "./auth-specs"

/**
 * Verbatim `status` output, captured by running each CLI. The codex pair is the
 * one that forced this function to exist: it exits **1** when signed out, so
 * "clean run, matched nothing ⇒ signed out" never fired for it.
 */
const CODEX_OUT = "Not logged in"
const CODEX_IN_CHATGPT = "Logged in using ChatGPT"
const CODEX_IN_KEY = "Logged in using an API key"

describe("loginVerdict", () => {
  const codex = DUAL_LOGIN_AGENTS.codex
  const claude = DUAL_LOGIN_AGENTS.claude
  const cursor = HOSTED_LOGIN_AGENTS.cursor

  it("reads codex as SIGNED OUT despite its non-zero exit", () => {
    // The regression: this used to be null, and health.ts treats null
    // optimistically, so a signed-out codex looked usable.
    expect(loginVerdict(codex, CODEX_OUT, 1)).toBe(false)
  })

  it("reads both of codex's signed-in wordings", () => {
    expect(loginVerdict(codex, CODEX_IN_CHATGPT, 0)).toBe(true)
    expect(loginVerdict(codex, CODEX_IN_KEY, 0)).toBe(true)
  })

  it("never lets 'Not logged in' match the signed-in pattern", () => {
    expect(codex.loggedInPattern?.test(CODEX_OUT)).toBe(false)
  })

  it("still treats a clean run that matched nothing as the opposite", () => {
    // claude declares only a signed-in pattern and exits 0 either way.
    expect(loginVerdict(claude, '{"loggedIn": false}', 0)).toBe(false)
    expect(loginVerdict(claude, '{"loggedIn": true}', 0)).toBe(true)
    // cursor declares only a signed-out pattern — the shortcut runs the other way.
    expect(loginVerdict(cursor, "Logged in as ada@example.com", 0)).toBe(true)
    expect(loginVerdict(cursor, "Not logged in", 0)).toBe(false)
  })

  it("stays unknown when the CLI fell over rather than answered", () => {
    // Non-zero AND nothing a pattern recognises: a crash, not a verdict.
    expect(loginVerdict(claude, "panic: runtime error", 3)).toBe(null)
    expect(loginVerdict(codex, "", 1)).toBe(null)
    expect(loginVerdict(codex, "   ", null)).toBe(null)
  })

  it("stays unknown for a spec that declares no pattern at all", () => {
    expect(loginVerdict({}, "anything", 0)).toBe(null)
  })
})
