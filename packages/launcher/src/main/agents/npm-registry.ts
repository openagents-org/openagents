/**
 * What npm says about an agent's package: which versions exist, and which one
 * `npm install <pkg>` would actually fetch. Drives the "Update to vX" badge and
 * the changelog list, so being wrong here shows up as a badge that never clears.
 */
import https from "https"
import { npmRegistryBase } from "../mirror"

export interface NpmRegistryInfo {
  "dist-tags"?: { latest?: string }
  versions?: Record<string, unknown>
  time?: Record<string, string>
  homepage?: string
}

export function fetchNpmInfo(pkg: string): Promise<NpmRegistryInfo> {
  return new Promise((resolve, reject) => {
    const url = `${npmRegistryBase()}/${encodeURIComponent(pkg).replace("%40", "@")}`
    const req = https.get(
      url,
      { headers: { Accept: "application/json" } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          fetchNpmInfo(res.headers.location as string).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        let data = ""
        res.setEncoding("utf-8")
        res.on("data", (c) => {
          data += c
        })
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as NpmRegistryInfo)
          } catch (e) {
            reject(e as Error)
          }
        })
      },
    )
    req.on("error", reject)
    req.setTimeout(10000, () => req.destroy(new Error("npm registry timeout")))
  })
}

export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0)
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return y - x
  }
  return 0
}

// Semver pre-release identifier — anything after a hyphen (`-beta.1`, `-rc.2`,
// `-canary.123`). Plain releases match /^\d+\.\d+\.\d+$/ with no hyphen.
export function isPreRelease(version: string): boolean {
  return version.includes("-")
}

// Versions published to npm, sorted highest-first. Stable-only by default —
// previously this returned every published version including betas, which
// made the marketplace surface a beta as "latest" even though `npm install
// <pkg>` only fetches dist-tags.latest. After installing the actual newest
// stable, the card would still claim an update was available because it was
// comparing against the beta. Pass includePreRelease for the changelog
// listing where surfacing betas is useful.
export function sortedPublishedVersions(
  info: NpmRegistryInfo | null,
  opts: { includePreRelease?: boolean } = {},
): string[] {
  return Object.keys(info?.versions || {})
    .filter((v) => /^\d/.test(v))
    .filter((v) => (opts.includePreRelease ? true : !isPreRelease(v)))
    .sort(compareVersionsDesc)
}

export function resolveLatestVersion(
  info: NpmRegistryInfo | null,
): string | null {
  // dist-tags.latest is the source of truth for what `npm install <pkg>`
  // installs. Use it whenever it's published; only fall back to scanning the
  // versions map for packages that don't publish a `latest` tag.
  const tagged = info?.["dist-tags"]?.latest
  if (tagged) return tagged
  return sortedPublishedVersions(info)[0] || null
}
