import crypto from "crypto"
import fs from "fs"
import path from "path"

import { apiBase, DEFAULT_API_BASE } from "../auth/endpoints"

/**
 * What a Workspace bundle says about itself, and how a downloaded one proves
 * where it came from.
 *
 * Every desktop build of workspace/frontend writes `bundle-info.json` beside
 * its index.html (desktop/bundle-info.ts). The feed publishes the same fields
 * plus where the archive is and its hash, as a manifest signed with the
 * release key; scripts/pack-workspace-bundle.mjs is the other end of this file.
 *
 * The signature is what makes this safe to load at all. The page runs with
 * `__oaHost__`, which can pair this computer and start agents on it, so a
 * bundle is only ever installed when its manifest verifies against a key
 * compiled into the launcher — never on the strength of the URL it came from.
 */

export const BUNDLE_SCHEMA = 1

/**
 * The hosted feed. Used only by an installed app on the hosted workspace
 * endpoint; see bundleFeedUrl for everything else.
 */
export const DEFAULT_BUNDLE_FEED = "https://dl.openagents.org/workspace-bundle/desktop/latest.json"

/**
 * Public keys a bundle manifest may be signed with (ed25519, SPKI DER,
 * base64). Rotating means shipping the new key here one launcher release
 * BEFORE the feed starts signing with it.
 */
const TRUSTED_KEYS = ["MCowBQYDK2VwAyEA2CMJOjtJ26M8tGfbwkjXi1yVskOLRwctbTue+sNc+yg="]

export interface BundleInfo {
  schema: number
  /** Unique per build and safe as a directory name, e.g. 20261120.081500-2c6974a. */
  version: string
  commit: string
  /**
   * When the source commit was made, ms. A bundle replaces another only when
   * its source is newer — not merely its build, which an old commit can have.
   */
  committedAt: number
  /** The lowest WORKSPACE_HOST_API the bundle can run on. */
  minHostApi: number
}

export interface BundleManifest extends BundleInfo {
  /** The archive, relative to the manifest's own URL. */
  archive: string
  sha256: string
  size: number
}

const VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]{0,79}$/

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

const positiveInt = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

export function parseBundleInfo(value: unknown): BundleInfo | null {
  const doc = record(value)
  if (!doc || doc.schema !== BUNDLE_SCHEMA) return null
  const { version, commit, committedAt, minHostApi } = doc
  if (typeof version !== "string" || !VERSION.test(version)) return null
  if (typeof commit !== "string" || commit.length > 80) return null
  if (!positiveInt(committedAt) || !Number.isSafeInteger(minHostApi) || (minHostApi as number) < 0) return null
  return { schema: BUNDLE_SCHEMA, version, commit, committedAt, minHostApi: minHostApi as number }
}

export function parseManifest(value: unknown): BundleManifest | null {
  const info = parseBundleInfo(value)
  const doc = record(value)
  if (!info || !doc) return null
  const { archive, sha256, size } = doc
  if (typeof archive !== "string" || !archive || archive.length > 300) return null
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null
  if (!positiveInt(size)) return null
  return { ...info, archive, sha256, size }
}

/** The bundle-info.json of an unpacked bundle, or null when there is none. */
export function readBundleInfo(dir: string): BundleInfo | null {
  try {
    return parseBundleInfo(JSON.parse(fs.readFileSync(path.join(dir, "bundle-info.json"), "utf-8")))
  } catch {
    return null
  }
}

/** Just the BundleInfo fields of a manifest (or of anything that has them). */
export function toBundleInfo(info: BundleInfo): BundleInfo {
  const { schema, version, commit, committedAt, minHostApi } = info
  return { schema, version, commit, committedAt, minHostApi }
}

/** Whether two descriptions are of the same build. */
export function sameBuild(a: BundleInfo, b: BundleInfo): boolean {
  return a.version === b.version && a.commit === b.commit && a.committedAt === b.committedAt && a.minHostApi === b.minHostApi
}

/**
 * The keys to trust. OPENAGENTS_WORKSPACE_BUNDLE_PUBLIC_KEY replaces them, for
 * a self-hosted feed signed with its own key.
 */
export function trustedKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.OPENAGENTS_WORKSPACE_BUNDLE_PUBLIC_KEY?.trim()
  return override ? override.split(/[\s,]+/).filter(Boolean) : TRUSTED_KEYS
}

/**
 * Check a published `latest.json` — `{ payload, signature }`, where payload
 * is the manifest's JSON text exactly as signed — and return the manifest
 * only when the signature verifies against one of `keys`.
 */
export function verifyManifest(value: unknown, keys: readonly string[]): BundleManifest | null {
  const doc = record(value)
  if (!doc || typeof doc.payload !== "string" || typeof doc.signature !== "string") return null
  const payload = Buffer.from(doc.payload, "utf-8")
  const signature = Buffer.from(doc.signature, "base64")
  const trusted = keys.some((key) => {
    try {
      const publicKey = crypto.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" })
      return crypto.verify(null, payload, publicKey, signature)
    } catch {
      return false
    }
  })
  if (!trusted) return null
  try {
    return parseManifest(JSON.parse(doc.payload))
  } catch {
    return null
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

/**
 * Where to look for bundle updates, or null when this install should only
 * ever run the bundle it shipped with.
 *
 *  - OPENAGENTS_WORKSPACE_BUNDLE_FEED set to a URL: that feed (https, or http
 *    on loopback for testing), in any build. Set to `off` to disable.
 *  - otherwise an installed app on the hosted endpoint uses the hosted feed.
 *  - otherwise none: a dev checkout runs its own build, and a self-hosted
 *    endpoint keeps the bundle that shipped, since the newest hosted front
 *    end may call API a self-hosted backend does not have yet.
 */
export function bundleFeedUrl(opts: {
  endpoint: string | undefined
  packaged: boolean
  env?: NodeJS.ProcessEnv
}): string | null {
  const raw = (opts.env ?? process.env).OPENAGENTS_WORKSPACE_BUNDLE_FEED?.trim()
  if (raw) {
    if (/^(off|none|false|0|disabled?)$/i.test(raw)) return null
    try {
      const url = new URL(raw)
      if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname))) return url.toString()
    } catch {
      /* fall through */
    }
    return null
  }
  if (!opts.packaged || apiBase(opts.endpoint) !== DEFAULT_API_BASE) return null
  return DEFAULT_BUNDLE_FEED
}
