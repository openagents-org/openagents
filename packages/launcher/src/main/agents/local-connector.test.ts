import { describe, expect, it } from "vitest"

import { localConnectorEnabled } from "./local-connector"

describe("localConnectorEnabled", () => {
  it("stays off on a new install until there is a local agent", () => {
    expect(localConnectorEnabled(undefined, 0)).toBe(false)
    expect(localConnectorEnabled(undefined, 1)).toBe(true)
  })

  it("follows an explicit choice whatever agents there are", () => {
    expect(localConnectorEnabled(false, 3)).toBe(false)
    expect(localConnectorEnabled(true, 0)).toBe(true)
  })

  it("ignores a value that is not a choice", () => {
    expect(localConnectorEnabled("off", 0)).toBe(false)
    expect(localConnectorEnabled(null, 2)).toBe(true)
  })
})
