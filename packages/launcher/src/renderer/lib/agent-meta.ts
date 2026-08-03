import type { TFunction } from "i18next"

import type { EnvField } from "@renderer/types"

/**
 * Translation overlay for the strings the agent-launcher core supplies in
 * English only: agent descriptions and env-var documentation.
 *
 * The registry (packages/agent-connector/registry.json) is the source of
 * truth for WHICH fields exist; this only renames them for display. Anything
 * missing from the catalog falls back to the registry's own wording, so a
 * newly added agent still shows something sensible before it is translated.
 */

/** Short human label for an env var, derived from the catalog or its name. */
export function envFieldLabel(field: EnvField, t: TFunction): string {
  const translated = t(`agentMeta.env.${field.name}.label`, { defaultValue: "" })
  if (translated) return translated

  const generic = genericRole(field.name)
  if (generic) return t(`agentMeta.genericLabels.${generic}`)
  return field.name
}

/**
 * The longer explanation shown under the input.
 *
 * Falls back through: exact catalog entry → generic text for the role the name
 * implies → whatever English the agent shipped. The generic step matters: env
 * vars are added to agent-manager faster than this catalog is updated, and a
 * lone English paragraph in an otherwise translated form reads as a bug.
 */
export function envFieldHint(field: EnvField, t: TFunction): string {
  const exact = t(`agentMeta.env.${field.name}.hint`, { defaultValue: "" })
  if (exact) return exact

  const generic = genericRole(field.name)
  if (generic) return t(`agentMeta.genericHints.${generic}`)
  return field.description || ""
}

/** Agent blurb for the picker and marketplace cards. */
export function agentDescription(
  name: string,
  fallback: string | null | undefined,
  t: TFunction,
): string {
  return t(`agentMeta.descriptions.${name}`, { defaultValue: fallback || "" })
}

function genericRole(name: string): string | null {
  if (/API_KEY$|_KEY$/.test(name)) return "apiKey"
  if (/_TOKEN$/.test(name)) return "token"
  if (/BASE_URL$|_URL$|_API_BASE$|_HOST$/.test(name)) return "baseUrl"
  if (/MODEL(_NAME)?$/.test(name)) return "model"
  if (/PROVIDER$/.test(name)) return "provider"
  return null
}
