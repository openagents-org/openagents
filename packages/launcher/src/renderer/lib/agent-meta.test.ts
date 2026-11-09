import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"

import type { EnvField } from "@renderer/types"

import { envFieldPlaceholder } from "./agent-meta"

const t = ((key: string) => key) as unknown as TFunction
const field = (f: Omit<EnvField, "description">): EnvField => ({ description: "", ...f })

describe("envFieldPlaceholder", () => {
  it("says an optional endpoint can stay blank instead of showing a URL", () => {
    const deepseek = field({
      name: "DEEPSEEK_BASE_URL",
      required: false,
      placeholder: "https://api.deepseek.com/anthropic",
    })
    expect(envFieldPlaceholder(deepseek, t)).toBe("agentMeta.placeholders.baseUrlOptional")
  })

  it("keeps the placeholder of an endpoint that is pre-filled or required", () => {
    expect(
      envFieldPlaceholder(
        field({ name: "KIMI_BASE_URL", default: "https://api.moonshot.ai/v1", placeholder: "https://api.moonshot.ai/v1" }),
        t,
      ),
    ).toBe("https://api.moonshot.ai/v1")
    expect(
      envFieldPlaceholder(field({ name: "LLM_BASE_URL", required: true, placeholder: "https://x.example/v1" }), t),
    ).toBe("https://x.example/v1")
  })

  it("leaves other fields to their own placeholder", () => {
    expect(envFieldPlaceholder(field({ name: "PI_MODEL", placeholder: "claude-opus-5" }), t)).toBe("claude-opus-5")
    expect(envFieldPlaceholder(field({ name: "CLINE_PROVIDER" }), t)).toBe("")
  })
})
