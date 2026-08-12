import { describe, expect, it } from "vitest"

import { mirrorPiProviderApiKey } from "./pi-env"

describe("mirrorPiProviderApiKey", () => {
  it("mirrors the unified key for native DeepSeek", () => {
    expect(
      mirrorPiProviderApiKey({
        PI_PROVIDER: "deepseek",
        PI_API_KEY: "test-secret",
      }),
    ).toMatchObject({
      PI_API_KEY: "test-secret",
      DEEPSEEK_API_KEY: "test-secret",
    })
  })

  it("does not overwrite an explicitly supplied provider key", () => {
    expect(
      mirrorPiProviderApiKey({
        PI_PROVIDER: "deepseek",
        PI_API_KEY: "unified",
        DEEPSEEK_API_KEY: "explicit",
      }).DEEPSEEK_API_KEY,
    ).toBe("explicit")
  })

  it("does nothing when the form has no unified Pi key", () => {
    expect(mirrorPiProviderApiKey({ PI_PROVIDER: "deepseek" })).toEqual({
      PI_PROVIDER: "deepseek",
    })
  })
})
