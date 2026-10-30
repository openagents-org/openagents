import { describe, it, expect } from "vitest"

import BUNDLED_REGISTRY from "../../../../../agent-connector/registry.json"
import { matchesSearch } from "./entry-meta"
import type { CatalogEntry } from "../../types"

const CATALOG = BUNDLED_REGISTRY as unknown as CatalogEntry[]
const find = (name: string): CatalogEntry => {
  const entry = CATALOG.find((e) => e.name === name)
  if (!entry) throw new Error(`no ${name} entry in the bundled registry`)
  return entry
}

/** What the marketplace search box would show for a query. */
const search = (query: string): string[] =>
  CATALOG.filter((e) => matchesSearch(e, query)).map((e) => e.name)

describe("matchesSearch", () => {
  it("matches on name, label, description and tags", () => {
    const entry = {
      name: "acme",
      label: "Acme Code",
      description: "Does things",
      tags: ["widget"],
    } as unknown as CatalogEntry

    expect(matchesSearch(entry, "acme")).toBe(true)
    expect(matchesSearch(entry, "Acme Code")).toBe(true)
    expect(matchesSearch(entry, "things")).toBe(true)
    expect(matchesSearch(entry, "widget")).toBe(true)
    expect(matchesSearch(entry, "nope")).toBe(false)
  })

  it("is case- and whitespace-insensitive, and an empty query matches all", () => {
    const entry = { name: "acme", label: "Acme Code" } as unknown as CatalogEntry
    expect(matchesSearch(entry, "  ACME  ")).toBe(true)
    expect(matchesSearch(entry, "")).toBe(true)
    expect(matchesSearch(entry, "   ")).toBe(true)
  })

  it("survives an entry with no label, description or tags", () => {
    const entry = { name: "acme" } as unknown as CatalogEntry
    expect(matchesSearch(entry, "acme")).toBe(true)
    expect(matchesSearch(entry, "undefined")).toBe(false)
  })
})

describe("finding an agent by the name its users know it by", () => {
  /**
   * CodeBuddy Code is the engine behind Tencent's WorkBuddy desktop app, and
   * plenty of users only ever met it as WorkBuddy. The word appears nowhere in
   * the CLI's name, so this search rides entirely on the entry's `tags` — drop
   * that tag and the agent silently becomes unfindable for everyone who knows
   * the product rather than the command.
   */
  it("finds CodeBuddy when searching for WorkBuddy", () => {
    expect(search("workbuddy")).toContain("codebuddy")
    expect(search("WorkBuddy")).toContain("codebuddy")
  })

  it("says WorkBuddy in the label, so the result is recognisable", () => {
    expect(find("codebuddy").label).toMatch(/workbuddy/i)
  })

  it("finds CodeBuddy by its own name too", () => {
    expect(search("codebuddy")).toContain("codebuddy")
  })

  it("keeps the search specific enough to be useful", () => {
    // If a query for one product returned half the catalog the tag would be
    // doing harm rather than good.
    expect(search("workbuddy")).toEqual(["codebuddy"])
  })
})
