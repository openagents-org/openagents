/**
 * Endpoints for the DeepSeek Harness (dsh) agent.
 *
 * dsh 0.2 talks to DeepSeek over the Anthropic Messages API, served under
 * `https://api.deepseek.com/anthropic`, while DeepSeek's model list lives on
 * the OpenAI-style root. Users copy either form from DeepSeek's docs, so both
 * are mapped to the endpoint each caller actually needs. A gateway (any other
 * host) is left exactly as typed.
 */

const DEEPSEEK_HOST = "api.deepseek.com"
const DEEPSEEK_MESSAGES_BASE = "https://api.deepseek.com/anthropic"
const DEEPSEEK_MODELS_BASE = "https://api.deepseek.com/v1"

function isDeepseekHost(base: string): boolean {
  try {
    return new URL(base.trim()).hostname.toLowerCase() === DEEPSEEK_HOST
  } catch {
    return false
  }
}

/** Where the harness sends `/v1/messages`: blank or DeepSeek's own host → its Anthropic endpoint. */
export function dshMessagesBase(base: string): string {
  const trimmed = (base || "").trim()
  if (!trimmed || isDeepseekHost(trimmed)) return DEEPSEEK_MESSAGES_BASE
  return trimmed
}

/** Where DeepSeek's model list is read: any URL on DeepSeek's own host → its OpenAI-style root. */
export function dshModelsBase(base: string): string {
  const trimmed = (base || "").trim()
  if (!trimmed || isDeepseekHost(trimmed)) return DEEPSEEK_MODELS_BASE
  return trimmed
}
