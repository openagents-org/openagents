import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const yaml = require("js-yaml") as { load(text: string): unknown }

export interface HermesModelOptions {
  env?: NodeJS.ProcessEnv
  homeDir?: string
  platform?: NodeJS.Platform
  agentName?: string
  binary?: string | null
  typeEnv?: NodeJS.ProcessEnv | null
  instanceEnv?: NodeJS.ProcessEnv | null
}

/**
 * The per-agent selection is passed to chat --model. Without an override,
 * read Hermes's native default without launching a CLI or exposing the
 * credentials which share the file.
 */
export function readHermesModel(options: HermesModelOptions = {}): string | null {
  const own = options.instanceEnv ?? {}
  const typeEnv = { ...options.typeEnv }
  // Match core env.js typeEnvFor for Hermes's declared model/key fields.
  // A sign-in, an own key, or an explicit default excludes the type model.
  if (own.OPENAGENTS_AUTH_MODE === "cli_login" || own.OPENAGENTS_MODEL_MODE === "default"
      || own.LLM_API_KEY?.trim() || own.OPENAI_API_KEY?.trim()) {
    delete typeEnv.LLM_MODEL
  }
  const env = { ...(options.env ?? process.env), ...typeEnv, ...own }
  // Match configuredModel("hermes"), not the generic *_MODEL display scan.
  const selectedModel = env.HERMES_MODEL?.trim() || env.LLM_MODEL?.trim()
  if (selectedModel) return selectedModel
  if (options.binary?.startsWith("wsl:")) return null
  const homeDir = options.homeDir ?? os.homedir()
  const platform = options.platform ?? process.platform
  const nativeHome = platform === "win32"
    ? path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "hermes")
    : path.join(homeDir, ".hermes")
  const rawHome = env.HERMES_HOME?.trim() || nativeHome
  // Hermes expands variables and ~ in HERMES_HOME; this is text expansion,
  // never a shell command. Leave unknown variables unchanged, as Python does.
  const variables = platform === "win32"
    ? /\$(?:\{([^}]+)\}|([A-Za-z_]\w*))|%([^%]+)%/g
    : /\$(?:\{([^}]+)\}|([A-Za-z_]\w*))/g
  const expanded = rawHome.replace(variables, (literal, braced, plain, windows) => env[braced || plain || windows] ?? literal)
  const home = expanded === "~" ? homeDir : /^~[\\/]/.test(expanded) ? path.join(homeDir, expanded.slice(2)) : expanded
  const pinnedProfile = path.basename(path.dirname(home)) === "profiles"
  const root = pinnedProfile ? path.dirname(path.dirname(home)) : home
  let configHome = home
  try {
    // Match HermesAdapter._resolveProfile: a matching legacy profile name is
    // passed as -p, otherwise Hermes honors a pinned home or active_profile.
    const name = options.agentName
    const named = name && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)
      && fs.existsSync(path.join(homeDir, ".hermes", "profiles", name))
    if (named) {
      configHome = path.join(root, "profiles", name)
    } else if (!pinnedProfile) {
      let active = ""
      try { active = fs.readFileSync(path.join(root, "active_profile"), "utf-8").trim() } catch {}
      if (active && active !== "default") {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(active)) return null
        configHome = path.join(root, "profiles", active)
      }
    }
    const parsed = yaml.load(fs.readFileSync(path.join(configHome, "config.yaml"), "utf-8")) as
      { model?: unknown } | null
    const model = parsed?.model
    // Match Hermes's config normalization: default > model > name, with a
    // nested {model/default, provider} accepted for each alias.
    const unwrap = (value: unknown): unknown => typeof value === "object" && value && !Array.isArray(value)
      ? (value as Record<string, unknown>).model || (value as Record<string, unknown>).default
      : value
    const selected = typeof model === "object" && model && !Array.isArray(model)
      ? unwrap((model as Record<string, unknown>).default)
        || unwrap((model as Record<string, unknown>).model)
        || unwrap((model as Record<string, unknown>).name)
      : model
    return typeof selected === "string" && selected.trim() ? selected.trim() : null
  } catch {
    return null
  }
}
