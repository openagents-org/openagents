// ── Region-aware download mirrors ──
//
// First launch downloads the Node.js runtime (nodejs.org) plus npm and the
// agent-launcher core (registry.npmjs.org). In mainland China both origins are
// slow or intermittently unreachable, which is the root of the "loading page
// hangs / never finishes" reports. npmmirror (Alibaba/taobao) carries
// byte-identical copies under the SAME path layout, so we can transparently
// swap the origin for users detected in China and keep the official origin as
// an automatic fallback.
//
// Detection is best-effort (timezone + locale) and can be overridden from the
// store key `downloadRegion` ('auto' | 'global' | 'cn') for support/QA without
// shipping a UI. A false positive is harmless — npmmirror is reachable
// worldwide — and every China candidate list still ends with the official URL,
// so a mirror outage degrades to the official origin rather than failing.
import { app } from "electron"

const OFFICIAL_NODE = "https://nodejs.org/dist"
const MIRROR_NODE = "https://cdn.npmmirror.com/binaries/node"
const OFFICIAL_NPM = "https://registry.npmjs.org"
const MIRROR_NPM = "https://registry.npmmirror.com"

// Launcher self-update feed (electron-updater generic provider). Mirrored here
// so a region/user override can redirect it the same way Node and npm are.
const OFFICIAL_LAUNCHER_FEED = "https://dl.openagents.org/launcher/stable"

export type RegionPref = "auto" | "global" | "cn"

let _override: RegionPref = "auto"

// Called once at startup from the persisted `downloadRegion` setting, and again
// whenever the user changes it in Settings → Network.
export function setRegionPreference(pref: unknown): void {
  if (pref === "global" || pref === "cn" || pref === "auto") _override = pref
}

export function getRegionPreference(): RegionPref {
  return _override
}

let _cachedCN: boolean | null = null

function detectChina(): boolean {
  if (_cachedCN !== null) return _cachedCN
  let cn = false
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""
    // zh-CN system timezones (mainland + the two IANA aliases Windows emits).
    if (/Shanghai|Chongqing|Chungking|Urumqi|Harbin|Kashgar|PRC/i.test(tz))
      cn = true
  } catch {}
  try {
    const loc = (app?.getLocale?.() || "").toLowerCase()
    if (loc === "zh" || loc.startsWith("zh-cn") || loc.startsWith("zh-hans"))
      cn = true
  } catch {}
  _cachedCN = cn
  return cn
}

export function useChinaMirror(): boolean {
  if (_override === "cn") return true
  if (_override === "global") return false
  return detectChina()
}

// Ordered download candidates for a Node dist-relative path, e.g.
// "v22.22.3/win-x64/node.exe" or "v22.22.3/SHASUMS256.txt". China users get
// the mirror first, official second; everyone else gets official only.
export function nodeDistUrls(relPath: string): string[] {
  const official = `${OFFICIAL_NODE}/${relPath}`
  if (useChinaMirror()) return [`${MIRROR_NODE}/${relPath}`, official]
  return [official]
}

// Ordered download candidates for an npm-registry-relative path, e.g.
// "npm/-/npm-10.9.8.tgz" or "@scope/pkg/latest". The npmmirror registry mirrors
// both the metadata API and the tarball layout under the same paths.
export function npmUrls(relPath: string): string[] {
  const official = `${OFFICIAL_NPM}/${relPath}`
  if (useChinaMirror()) return [`${MIRROR_NPM}/${relPath}`, official]
  return [official]
}

// Base registry URL for `npm install --registry` / npm_config_registry, so
// core + agent installs spawned by npm also resolve through the mirror in China.
export function npmRegistryBase(): string {
  return useChinaMirror() ? MIRROR_NPM : OFFICIAL_NPM
}

export const DEFAULT_LAUNCHER_FEED = OFFICIAL_LAUNCHER_FEED

/**
 * Where electron-updater should look for launcher releases.
 *
 * Unlike Node/npm there is no public byte-identical mirror of our own release
 * feed to fall back on, and electron-updater's generic provider takes a single
 * URL with no candidate list — pointing it at a host that turns out to be
 * unreachable would leave those users unable to update at all. So the official
 * origin is the default and an override is deliberately NOT surfaced in the UI:
 * there is no mirror to offer yet, and a mistyped value breaks updates outright.
 *
 * It stays reachable as the `updateFeedUrl` key in settings.json, so support can
 * point a specific user at a host serving the same latest*.yml + installers
 * (e.g. a China-side CDN) without shipping a build. Wire it into the UI once such
 * a mirror actually exists. A mirror can't substitute a different build: the
 * sha512 comes from the feed and Windows checks the publisher signature.
 *
 * Returns null when the default should be used (i.e. don't call setFeedURL).
 */
export function launcherFeedUrl(override?: unknown): string | null {
  if (typeof override !== "string") return null
  const trimmed = override.trim()
  if (!trimmed) return null
  // Reject anything that isn't an absolute http(s) URL rather than handing
  // electron-updater a value that would throw deep inside a background check.
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
  } catch {
    return null
  }
  if (trimmed.replace(/\/+$/, "") === OFFICIAL_LAUNCHER_FEED) return null
  return trimmed
}
