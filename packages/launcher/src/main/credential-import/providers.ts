/**
 * Provider ids as each tool spells them, and who issued a key saved under one.
 *
 * Only providers whose endpoint is known are listed. A key filed under any
 * other id comes with no endpoint to send it to, so it is not an offer anyone
 * can use — unless the tool's config also declares where that provider lives,
 * which the readers check for separately.
 */
import type { Protocol, Vendor } from "../../shared/credential-import"

export interface KnownProvider {
  vendor: Vendor
  protocol: Protocol
  /** When the id means one region of a vendor that has several. */
  base?: string
}

const anthropic: KnownProvider = { vendor: "anthropic", protocol: "anthropic" }
const openai: KnownProvider = { vendor: "openai", protocol: "openai" }
const google: KnownProvider = { vendor: "google", protocol: "gemini" }
const deepseek: KnownProvider = { vendor: "deepseek", protocol: "openai" }
const moonshot: KnownProvider = { vendor: "moonshot", protocol: "openai" }
const openrouter: KnownProvider = { vendor: "openrouter", protocol: "openai" }

export const PI_PROVIDERS: Record<string, KnownProvider> = {
  anthropic,
  openai,
  google,
  deepseek,
  openrouter,
}

export const OPENWORKER_PROVIDERS: Record<string, KnownProvider> = {
  anthropic,
  openai,
  gemini: google,
  deepseek,
  kimi: moonshot,
  openrouter,
}

export const CLINE_PROVIDERS: Record<string, KnownProvider> = {
  anthropic,
  "openai-native": openai,
  gemini: google,
  deepseek,
  moonshot,
  openrouter,
}

/** OpenCode follows models.dev's provider ids. */
export const OPENCODE_PROVIDERS: Record<string, KnownProvider> = {
  anthropic,
  openai,
  google,
  deepseek,
  openrouter,
  moonshotai: moonshot,
  "moonshotai-cn": { ...moonshot, base: "https://api.moonshot.cn/v1" },
}
