import { describe, expect, it } from "vitest"

import {
  extractHostedWorkspaceToken,
  hostedWorkspaceSlug,
  isLinkWithoutToken,
  parseCustomWorkspaceUrl,
} from "./workspace-link"

describe("extractHostedWorkspaceToken", () => {
  it("takes the token from the address-bar form", () => {
    // The link people actually copy out of the workspace tab.
    expect(
      extractHostedWorkspaceToken(
        "https://workspace.openagents.org/67520a7e?token=vDbyEKTVeYdkj-yu2P0ct",
      ),
    ).toBe("vDbyEKTVeYdkj-yu2P0ct")
  })

  it("falls back to the first path segment for invite links", () => {
    expect(
      extractHostedWorkspaceToken("https://workspace.openagents.org/tok-123"),
    ).toBe("tok-123")
  })

  it("ignores bare tokens and self-hosted links", () => {
    expect(extractHostedWorkspaceToken("plain-token-xyz")).toBeNull()
    expect(
      extractHostedWorkspaceToken("http://localhost:8000/team?token=abc"),
    ).toBeNull()
  })

  it("ignores non-http schemes", () => {
    expect(
      extractHostedWorkspaceToken("file://workspace.openagents.org/tok"),
    ).toBeNull()
  })
})

describe("hostedWorkspaceSlug", () => {
  it("names the workspace when the link also carries a token", () => {
    expect(
      hostedWorkspaceSlug("https://workspace.openagents.org/67520a7e?token=abc"),
    ).toBe("67520a7e")
  })

  it("is undefined for an invite link, where the segment IS the token", () => {
    expect(
      hostedWorkspaceSlug("https://workspace.openagents.org/tok-123"),
    ).toBeUndefined()
  })
})

describe("parseCustomWorkspaceUrl", () => {
  it("splits a self-hosted link into endpoint, slug and token", () => {
    expect(parseCustomWorkspaceUrl("http://localhost:8000/team?token=abc")).toEqual(
      { endpoint: "http://localhost:8000", slug: "team", token: "abc" },
    )
  })

  it("returns null for hosted links and bare tokens", () => {
    expect(
      parseCustomWorkspaceUrl("https://workspace.openagents.org/t?token=abc"),
    ).toBeNull()
    expect(parseCustomWorkspaceUrl("plain-token-xyz")).toBeNull()
  })
})

describe("isLinkWithoutToken", () => {
  it("only flags links, and only those missing ?token=", () => {
    expect(isLinkWithoutToken("https://workspace.openagents.org/67520a7e")).toBe(
      true,
    )
    expect(
      isLinkWithoutToken("https://workspace.openagents.org/67520a7e?token=abc"),
    ).toBe(false)
    // A bare token is not a link — the "copy the token instead" hint would be
    // nonsense advice for someone who already pasted one.
    expect(isLinkWithoutToken("plain-token-xyz")).toBe(false)
  })
})
