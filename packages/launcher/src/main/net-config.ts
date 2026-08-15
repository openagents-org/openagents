/**
 * Where the launcher's downloads go out and how they get there: the mirror
 * region, the npm registry, and the proxy.
 *
 * All three have to be pushed into more than one place — this process's env
 * (inherited by every npm / agent CLI we spawn), Electron's own network stack,
 * and the updater's private session — because none of them read each other's
 * configuration.
 */
import { session } from "electron"
import {
  setRegionPreference,
  useChinaMirror,
  npmRegistryBase,
  nodeMirrorBases,
  npmRegistryCandidates,
  userNpmrcRegistry,
  getRegionPreference,
} from "./mirror"
import { fastestBase } from "./download"
import { slog } from "./bootstrap/startup-log"
import type { Store } from "./store"

/** The updater downloads on its own session so its proxy can be set apart. */
export const UPDATER_NET_PARTITION = "electron-updater"

/**
 * Resolve the download region and push it everywhere it has to be honoured:
 * this process (Node/npm/core downloads pick candidates per request), npm's own
 * registry for spawned installs, and the core's Node installer, which runs
 * outside Electron and would otherwise go straight to nodejs.org.
 *
 * npm_config_registry is only set for China — it overrides a user's .npmrc, so
 * outside that case we leave whatever registry they configured alone.
 */
export function applyDownloadRegion(pref: unknown): void {
  setRegionPreference(pref)
  if (useChinaMirror()) process.env.npm_config_registry = npmRegistryBase()
  else delete process.env.npm_config_registry
  process.env.OPENAGENTS_NODE_MIRRORS = nodeMirrorBases().join(",")
  process.env.OPENAGENTS_DOWNLOAD_REGION = useChinaMirror() ? "cn" : "global"
  slog(
    `download region: china=${useChinaMirror()} node=${nodeMirrorBases()[0]} registry=${npmRegistryBase()}`,
  )
}

// A measured registry choice is good for a day — long enough that a normal
// launch never pays for it, short enough to follow a user who travels.
const REGISTRY_PROBE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Pick the npm registry by measurement rather than by guessing the region.
 *
 * Agent runtimes — the biggest download of a first run — install through a
 * child npm process that takes ONE registry URL, so the racing downloader can't
 * help there; the registry has to be right up front. Timezone/locale detection
 * misses mainland users on English-locale machines, and those users were left
 * pulling a full dependency tree from registry.npmjs.org.
 *
 * Skipped when the user has decided for themselves: an explicit region, or a
 * registry in their own .npmrc (corporate/private mirrors must win).
 */
export async function tuneNpmRegistry(
  store: Store,
  corePkg: string,
): Promise<void> {
  if (getRegionPreference() !== "auto") return
  const ownRegistry = userNpmrcRegistry()
  if (ownRegistry) {
    slog(`npm registry: honouring .npmrc (${ownRegistry})`)
    return
  }

  const cached = store.get("npmRegistryProbe") as
    | { base?: string; at?: number }
    | undefined
  if (
    cached?.base &&
    typeof cached.at === "number" &&
    Date.now() - cached.at < REGISTRY_PROBE_TTL_MS
  ) {
    process.env.npm_config_registry = cached.base
    slog(`npm registry: ${cached.base} (cached probe)`)
    return
  }

  const winner = await fastestBase(
    npmRegistryCandidates(),
    `${corePkg}/latest`,
    {
      log: slog,
    },
  )
  if (!winner) return
  process.env.npm_config_registry = winner
  store.set("npmRegistryProbe", { base: winner, at: Date.now() })
}

// Apply proxy settings (Settings → Network) three ways:
//  1. process.env HTTP(S)_PROXY / NO_PROXY — inherited by every child process
//     we spawn (npm, agent CLIs), all of which honor these standard vars.
//  2. defaultSession.setProxy — Electron's own network stack (renderer fetch,
//     the net module).
//  3. the updater's private session — self-update downloads. Chromium's net
//     stack ignores HTTP_PROXY entirely, so without this the proxy configured
//     here did nothing for updates: the only thing that helped was an OS-level
//     proxy, which Chromium picks up on its own. That mismatch is why "it's
//     only fast with the system proxy on" was the reported experience.
// node's core https (our Node/npm bootstrap downloads) doesn't read these, but
// those already go through regional mirrors so proxy coverage there is moot.
export function applyProxyFromSettings(store: Store): void {
  const http = ((store.get("httpProxy") as string) || "").trim()
  const https = ((store.get("httpsProxy") as string) || "").trim()
  const no = ((store.get("noProxy") as string) || "").trim()

  const setOrClear = (name: string, value: string): void => {
    if (value) {
      process.env[name] = value
      process.env[name.toLowerCase()] = value
    } else {
      delete process.env[name]
      delete process.env[name.toLowerCase()]
    }
  }
  setOrClear("HTTP_PROXY", http)
  setOrClear("HTTPS_PROXY", https)
  setOrClear("NO_PROXY", no)

  const rules = [http && `http=${http}`, https && `https=${https}`]
    .filter(Boolean)
    .join(";")
  // No explicit proxy means "behave like the browser": follow whatever the OS
  // is configured to use. `direct` here used to force every Chromium request —
  // including the startup downloads and the update feed — to bypass a system
  // proxy the user had deliberately set up, which on a restricted network is
  // the difference between slow and not working at all.
  const config: Electron.ProxyConfig = rules
    ? { proxyRules: rules, proxyBypassRules: no || undefined }
    : { mode: "system" }

  if (session?.defaultSession) {
    void session.defaultSession.setProxy(config)
  }
  try {
    void session
      .fromPartition(UPDATER_NET_PARTITION, { cache: false })
      .setProxy(config)
  } catch (err) {
    slog(`failed to apply proxy to updater session: ${(err as Error).message}`)
  }
}
