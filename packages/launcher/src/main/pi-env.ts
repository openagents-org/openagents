/**
 * Mirror Launcher's provider-neutral Pi key to the conventional variable that
 * Pi's native provider reads. Keeping PI_API_KEY as the source of truth lets
 * the UI stay simple; persisting the mirror also supports daemon processes
 * that were started with an older connector build.
 */
export function mirrorPiProviderApiKey(
  env: Record<string, string>,
): Record<string, string> {
  const out = { ...env }
  if (!Object.prototype.hasOwnProperty.call(out, "PI_API_KEY")) return out

  const provider = (out.PI_PROVIDER || "").trim().toLowerCase()
  const target = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    google: "GEMINI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  }[provider]
  if (target && !(out[target] || "").trim()) {
    out[target] = (out.PI_API_KEY || "").trim()
  }
  return out
}
