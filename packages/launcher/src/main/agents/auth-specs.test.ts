import { describe, expect, it } from "vitest"

import { CORE_AGENTS, launcherAuthFields } from "./auth-specs"

/**
 * Field ORDER is part of the contract, not cosmetics.
 *
 * The model picker's empty state says "fill in the API key above, then the
 * models this endpoint serves will load" — because the list is fetched FROM the
 * key and base URL. Pi shipped with its model field above its key, so that
 * sentence pointed at nothing: the input it named was further down the form.
 */
describe("launcher auth field order", () => {
  const nameOf = (f: Record<string, unknown>): string => String(f.name || "")

  for (const type of CORE_AGENTS) {
    const fields = launcherAuthFields(type) as
      | Array<Record<string, unknown>>
      | null
    if (!fields) continue

    it(`${type}: credentials come before the model field`, () => {
      const names = fields.map(nameOf)
      const model = names.findIndex((n) => n.endsWith("_MODEL"))
      if (model < 0) return
      const key = names.findIndex(
        (n) => n.endsWith("_API_KEY") || n.endsWith("_TOKEN"),
      )
      const base = names.findIndex((n) => n.endsWith("_BASE_URL"))
      // Only assert on inputs this agent actually has.
      if (key >= 0) expect(key).toBeLessThan(model)
      if (base >= 0) expect(base).toBeLessThan(model)
    })
  }

  it("pi asks for provider, key, endpoint, protocol, then model", () => {
    // Pinned in full: this is the one that was wrong, and the order is also the
    // order the fields depend on each other in.
    const names = (launcherAuthFields("pi") as Array<Record<string, unknown>>)
      .map(nameOf)
      .filter((n) => n !== "PI_THINKING" && n !== "PI_TRUST_PROJECT")
    expect(names).toEqual([
      "PI_PROVIDER",
      "PI_API_KEY",
      "PI_BASE_URL",
      "PI_API_FORMAT",
      "PI_MODEL",
    ])
  })
})
