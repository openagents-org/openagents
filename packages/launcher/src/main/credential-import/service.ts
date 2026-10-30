import crypto from "node:crypto"

import {
  credentialIdentity,
  effectiveBase,
  maskKey,
  type CredentialProfile,
  type ImportCandidate,
  type ImportSource,
} from "../../shared/credential-import"
import { importPatch } from "../../shared/credential-import-targets"
import { profilesFromEnv, profilesFromSavedEnv } from "./env-profiles"
import { parseEnvText } from "./env-text"
import { readNativeProfiles } from "./native"

export interface SavedEnv {
  env: Record<string, string>
  source: ImportSource
}

export interface CredentialImportDeps {
  /** What the launcher has saved: each agent type's form, and each agent's own. */
  savedEnvs: () => SavedEnv[]
  /** The login shell's environment — see shell-env. */
  shellEnv: () => Promise<Record<string, string>>
  home: string
}

/**
 * Finds the model credentials already on this machine and offers the ones an
 * agent's form can use.
 *
 * Keys stay in the main process until the user picks one: a scan hands out
 * masked candidates, and only `resolve` — one candidate, for one agent's form —
 * returns a key. What a scan found is held until the next scan, so a pick always
 * resolves against what was on screen.
 */
export class CredentialImportService {
  private _found = new Map<string, CredentialProfile>()

  constructor(private deps: CredentialImportDeps) {}

  /**
   * Offered in this order: other tools' own config first — where people
   * actually set a key up — then agents configured in the launcher, then the
   * shell.
   */
  async scan(agentType: string): Promise<ImportCandidate[]> {
    this._found.clear()
    const env = await this.deps.shellEnv().catch(() => ({}))
    return this._offer(agentType, [
      ...readNativeProfiles({ home: this.deps.home, env }),
      ...this.deps
        .savedEnvs()
        .flatMap((saved) => profilesFromSavedEnv(saved.env, saved.source)),
      ...profilesFromEnv(env, { kind: "shell", ref: "" }),
    ])
  }

  /** Candidates in pasted text, kept alongside what the last scan found. */
  parse(agentType: string, text: string): ImportCandidate[] {
    return this._offer(
      agentType,
      profilesFromSavedEnv(parseEnvText(text), { kind: "paste", ref: "" }),
    )
  }

  /** The form values for a candidate this service offered, or null. */
  resolve(agentType: string, id: string): Record<string, string> | null {
    const found = this._found.get(id)
    return found ? importPatch(agentType, found) : null
  }

  private _offer(
    agentType: string,
    profiles: CredentialProfile[],
  ): ImportCandidate[] {
    const groups = new Map<
      string,
      { profile: CredentialProfile; sources: ImportSource[] }
    >()
    for (const profile of profiles) {
      if (!importPatch(agentType, profile)) continue
      const key = credentialIdentity(profile)
      const group = groups.get(key)
      if (!group) {
        groups.set(key, { profile, sources: [profile.source] })
        continue
      }
      // The first source that named a model supplies it.
      if (!group.profile.model && profile.model)
        group.profile = { ...group.profile, model: profile.model }
      if (!group.sources.some((s) => sameSource(s, profile.source)))
        group.sources.push(profile.source)
    }
    return [...groups.values()].map(({ profile, sources }) => {
      const id = crypto.randomBytes(8).toString("hex")
      this._found.set(id, profile)
      return {
        id,
        protocol: profile.protocol,
        vendor: profile.vendor,
        baseUrl: effectiveBase(profile),
        model: profile.model,
        keyHint: maskKey(profile.apiKey),
        sources,
      }
    })
  }
}

function sameSource(a: ImportSource, b: ImportSource): boolean {
  return a.kind === b.kind && a.ref === b.ref && a.label === b.label
}
