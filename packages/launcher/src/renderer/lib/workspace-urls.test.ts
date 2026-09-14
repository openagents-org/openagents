import { describe, expect, it } from "vitest"
import { opensInApp } from "./workspace-urls"

describe("opensInApp", () => {
  const ws = { id: "w1", slug: "team" }

  it("opens a workspace on the configured deployment in the app when signed in", () => {
    expect(opensInApp(ws, undefined, true)).toBe(true)
    // The device records the API endpoint; the setting may be empty for the default.
    expect(opensInApp({ ...ws, endpoint: "https://workspace-endpoint.openagents.org/v1" }, "", true)).toBe(true)
  })

  it("uses the browser while signed out", () => {
    expect(opensInApp(ws, undefined, false)).toBe(false)
  })

  it("uses the browser for a workspace on another deployment", () => {
    const elsewhere = { ...ws, endpoint: "https://ws.example.com" }
    expect(opensInApp(elsewhere, undefined, true)).toBe(false)
    expect(opensInApp(elsewhere, "https://ws.example.com", true)).toBe(true)
  })
})
