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

export type RegionPref = "auto" | "global" | "cn"

let _override: RegionPref = "auto"

// Called once at startup from the persisted `downloadRegion` setting.
export function setRegionPreference(pref: unknown): void {
  if (pref === "global" || pref === "cn" || pref === "auto") _override = pref
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
