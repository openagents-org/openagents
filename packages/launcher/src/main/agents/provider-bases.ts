/**
 * Default endpoints for the agents that carry their PROVIDER in a field of
 * their own (OpenWorker, Goose) rather than in a base URL.
 *
 * These live here, apart from both callers, because two modules need them and
 * neither may import the other: `model-catalog` already imports `llm-test` for
 * its HTTP helper, so a table owned by either one would close a cycle.
 *
 * Everything below is a FALLBACK for a blank base-URL field. A value the user
 * typed always wins — that field is how a relay, a gateway or a self-hosted
 * deployment gets reached, and it is the whole reason "test connection" has to
 * probe the endpoint the agent will really call rather than the vendor's.
 */

/**
 * OpenWorker's own prefilled defaults (providers/registry.py), repeated here
 * because the user never has to type one: leaving Base URL blank has to list
 * and probe the models of the provider they picked, not OpenAI's.
 */
export const OPENWORKER_COMPAT_BASES: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  kimi: "https://api.moonshot.ai/v1",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  minimax: "https://api.minimax.io/v1",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  meta: "https://api.meta.ai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  openrouter: "https://openrouter.ai/api/v1",
}

/**
 * Goose provider ids that speak the OpenAI protocol, and where each one lives
 * when GOOSE_PROVIDER__HOST is blank.
 *
 * Goose's own provider list is much longer (bedrock, vertex, databricks,
 * sagemaker…), but those authenticate with cloud IAM rather than an API key in
 * a field — there is nothing here to probe for them, and saying so is more
 * useful than guessing an endpoint. `ollama` is listed because it is the one
 * local server users actually point Goose at, and it answers `/v1/models`
 * without a key.
 */
export const GOOSE_COMPAT_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  venice: "https://api.venice.ai/api/v1",
  ollama: "http://localhost:11434/v1",
}

/** Goose providers that need no API key (a local server). */
export const GOOSE_KEYLESS_PROVIDERS = new Set(["ollama"])
