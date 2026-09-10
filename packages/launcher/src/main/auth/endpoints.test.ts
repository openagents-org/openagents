import { describe, expect, it } from "vitest"

import { accountApiBase, apiBase, webBase, DEFAULT_API_BASE } from "./endpoints"

describe("endpoints", () => {
  it("defaults to the hosted workspace API", () => {
    expect(apiBase(undefined)).toBe(DEFAULT_API_BASE)
  })

  it("maps the API host to the web host that serves /auth/callback", () => {
    expect(webBase(undefined)).toBe("https://workspace.openagents.org")
    expect(webBase("https://workspace-endpoint.example.com")).toBe(
      "https://workspace.example.com",
    )
  })

  it("leaves a self-hosted endpoint that serves both from one origin alone", () => {
    expect(webBase("https://oa.internal")).toBe("https://oa.internal")
  })

  it("drops a trailing slash so paths concatenate cleanly", () => {
    expect(apiBase("https://oa.internal/")).toBe("https://oa.internal")
  })
})

describe("webBase override", () => {
  it("wins over the derivation, for a front end served apart from its API", () => {
    process.env.OPENAGENTS_WORKSPACE_WEB_BASE = "http://localhost:3001/"
    try {
      expect(webBase(undefined)).toBe("http://localhost:3001")
    } finally {
      delete process.env.OPENAGENTS_WORKSPACE_WEB_BASE
    }
  })
})

describe("accountApiBase", () => {
  it("is the account service, not the workspace API", () => {
    // Two different deployments: the website's own sign-in posts to this one,
    // and a password sent to the workspace API would only ever 404.
    expect(accountApiBase()).toBe("https://endpoint.openagents.org")
    expect(accountApiBase()).not.toBe(apiBase(undefined))
  })

  it("follows its override to a staging deployment", () => {
    process.env.OPENAGENTS_ACCOUNT_API_BASE = "https://staging.example.com/"
    try {
      expect(accountApiBase()).toBe("https://staging.example.com")
    } finally {
      delete process.env.OPENAGENTS_ACCOUNT_API_BASE
    }
  })
})
