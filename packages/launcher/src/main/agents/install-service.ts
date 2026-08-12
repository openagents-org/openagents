/**
 * Installing, updating, rolling back and versioning agent runtimes.
 *
 * The recurring trap this file exists to hold in one place: the registry's
 * `install` command is an INSTALL command. Re-running it as an update is a
 * no-op for a bare `npm install -g <pkg>` and a downgrade for a pinned
 * `<pkg>@0.83.0`, which is why "Update to v0.84.1" used to reinstall 0.83.0 and
 * the badge never cleared. Anything npm-backed updates via `@latest` instead —
 * see updateAgentTypeStreaming.
 */
import path from "path"
import fs from "fs"
import { spawn } from "child_process"
import { readPathEnv, withPathEnv } from "../env"
import {
  NO_NPM_PACKAGE,
  pinnedVersion,
  resolveNpmPackage,
} from "../../shared/npm-install-spec"
import { CONFIG_DIR, INSTALLED_HISTORY_FILE, PORTABLE_NODE_DIR } from "./paths"
import { platformKey, resolveNpmInvocation } from "./runtime"
import {
  fetchNpmInfo,
  resolveLatestVersion,
  sortedPublishedVersions,
} from "./npm-registry"

export interface InstalledAgentRecord {
  name: string
  version: string | null
  installedAt: string
  previousVersion?: string | null
  history?: Array<{ version: string; installedAt: string }>
}

export interface AgentUpdateInfo {
  name: string
  current: string | null
  latest: string | null
}

export interface InstallServiceDeps {
  /** The loaded connector; install calls assume the core is present. */
  connector: () => Record<string, unknown> | null
  /** Drop the catalog + updates caches after anything that changes install state. */
  clearCatalogCache: () => void
  /** The marketplace catalog, used to find everything currently installed. */
  getCatalog: () => Promise<unknown[]>
}

export class InstallService {
  private _updatesCache: {
    value: AgentUpdateInfo[]
    at: number
    inFlight: Promise<AgentUpdateInfo[]> | null
  } = { value: [], at: 0, inFlight: null }

  constructor(private deps: InstallServiceDeps) {}

  private get _connector(): Record<string, unknown> {
    return this.deps.connector() as Record<string, unknown>
  }

  clearUpdatesCache(): void {
    this._updatesCache = { value: [], at: 0, inFlight: null }
  }

  async checkAgentType(agentType: string): Promise<unknown> {
    const isInstalled = this._connector.isInstalled as (type: string) => boolean
    const installed = isInstalled.call(this._connector, agentType)
    const installer = this._connector.installer as Record<string, unknown>
    const which = installer.which as (type: string) => string | null
    const binary = installed ? which.call(installer, agentType) : null
    return { installed, binary: binary || null }
  }

  async installAgentType(agentType: string): Promise<unknown> {
    const install = this._connector.install as (
      type: string,
    ) => Promise<unknown>
    const result = await install.call(this._connector, agentType)
    this.recordInstall(agentType)
    this.deps.clearCatalogCache()
    return result
  }

  async installAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    // A registry command that freezes a version (`pi-coding-agent@0.83.0`) is a
    // baseline someone vetted once, in a file that is maintained by hand — it
    // is stale the moment upstream publishes. Installing it would hand a new
    // user an old build while the page next to the button already advertises
    // the newest one, so the pin is overridden here too, not just on update.
    // Dist-tags (`@latest`, `@beta`) float on their own and are left alone.
    const pinned = pinnedVersion(this._installCommand(agentType))
    if (pinned) return this.installAtVersionTag(agentType, "latest", onData)

    const installer = this._connector.installer as Record<string, unknown>
    const installStreaming = installer.installStreaming as (
      type: string,
      onData: (data: string) => void,
    ) => Promise<unknown>
    const result = await installStreaming.call(installer, agentType, onData)
    this.recordInstall(agentType)
    this.deps.clearCatalogCache()
    return result
  }

  /** This platform's install command from the registry, if the entry has one. */
  private _installCommand(agentType: string): string | undefined {
    const entry = this.getRegistryEntry(agentType)
    const install = entry?.install as Record<string, unknown> | undefined
    if (!install) return undefined
    return (install[platformKey()] || install.command || install.npm) as
      string | undefined
  }

  async uninstallAgentType(agentType: string): Promise<unknown> {
    const uninstall = this._connector.uninstall as (
      type: string,
    ) => Promise<unknown>
    const result = await uninstall.call(this._connector, agentType)
    this.recordUninstall(agentType)
    this.deps.clearCatalogCache()
    return result
  }

  async uninstallAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    const installer = this._connector.installer as Record<string, unknown>
    const uninstallStreaming = installer.uninstallStreaming as (
      type: string,
      onData: (data: string) => void,
    ) => Promise<unknown>
    const result = await uninstallStreaming.call(installer, agentType, onData)
    this.recordUninstall(agentType)
    this.deps.clearCatalogCache()
    return result
  }

  /** Read installed package version by inspecting runtime prefix package.json. */
  getInstalledVersion(agentType: string): string | null {
    try {
      const entry = this.getRegistryEntry(agentType)
      const npmPkg = this.resolveNpmPackage(entry)
      if (!npmPkg) return null
      const candidates = [
        path.join(
          CONFIG_DIR,
          "runtimes",
          agentType,
          "node_modules",
          npmPkg,
          "package.json",
        ),
        path.join(PORTABLE_NODE_DIR, "node_modules", npmPkg, "package.json"),
      ]
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) {
            const pkg = JSON.parse(fs.readFileSync(c, "utf-8"))
            if (pkg?.version) return pkg.version
          }
        } catch {}
      }
    } catch {}
    return null
  }

  getRegistryEntry(agentType: string): Record<string, unknown> | null {
    try {
      const registry = this.deps.connector()?.registry as
        Record<string, unknown> | undefined
      if (!registry) return null
      const getEntry = registry.getEntry as ((t: string) => unknown) | undefined
      const entry = getEntry
        ? (getEntry.call(registry, agentType) as Record<string, unknown> | null)
        : null
      return entry || null
    } catch {
      return null
    }
  }

  /**
   * Null for every agent the registry installs by script — see
   * `resolveNpmPackage`, which owns the rule and explains why `install.binary`
   * must never stand in for a package name. Callers already handle null by
   * reporting no version information, which is the truth for those agents.
   */
  resolveNpmPackage(entry: Record<string, unknown> | null): string | null {
    if (!entry) return null
    return resolveNpmPackage(
      entry.install as Record<string, unknown> | undefined,
      platformKey(),
    )
  }

  /**
   * Bring an installed agent up to the newest published version.
   *
   * This must NOT reuse `installAgentTypeStreaming` for ANY npm agent — the
   * registry's command is an install command, and running it as an update is a
   * no-op in both of its shapes:
   *
   *   - Bare `npm install -g <pkg>` (claude, codex, gemini). npm reads that as
   *     "make sure this is installed": once package.json holds a satisfied
   *     range — `--save` writes `^0.46.0` on first install — it prints "up to
   *     date" and changes nothing.
   *   - Pinned `npm install -g <pkg>@0.83.0` (pi, opencode). It reinstalls the
   *     version the user already has. The pin is a fresh-install baseline in a
   *     hand-maintained registry, so it goes stale as soon as upstream
   *     publishes; treating it as the update target left the launcher offering
   *     "Update to v0.84.1" and installing 0.83.0 every time, with the badge
   *     never clearing.
   *
   * The version the UI advertises comes from npm's `latest` dist-tag
   * (`_loadAgentUpdates`), so `latest` is the only target that keeps the button
   * honest. Non-npm installers (curl / pip / echo) keep the original pipeline:
   * they have no version to pin and their scripts already fetch the newest
   * build. Channel installs (beta / nightly) go through `installAtVersionTag`
   * with their own tag and never reach here.
   */
  async updateAgentTypeStreaming(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<unknown> {
    const entry = this.getRegistryEntry(agentType)
    const npmPkg = this.resolveNpmPackage(entry)
    if (npmPkg) {
      return this.installAtVersionTag(agentType, "latest", onData)
    }
    return this.installAgentTypeStreaming(agentType, onData)
  }

  // ── Install history ────────────────────────────────────────────

  getInstalledHistory(): Record<string, InstalledAgentRecord> {
    try {
      if (fs.existsSync(INSTALLED_HISTORY_FILE)) {
        const data = JSON.parse(
          fs.readFileSync(INSTALLED_HISTORY_FILE, "utf-8"),
        )
        if (data && typeof data === "object") return data
      }
    } catch {}
    return {}
  }

  private _writeInstalledHistory(
    data: Record<string, InstalledAgentRecord>,
  ): void {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
      fs.writeFileSync(
        INSTALLED_HISTORY_FILE,
        JSON.stringify(data, null, 2),
        "utf-8",
      )
    } catch {}
  }

  recordInstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      const version = this.getInstalledVersion(agentType)
      const prev = data[agentType]
      const history = prev?.history ? [...prev.history] : []
      const versionChanged = !!(
        prev?.version &&
        version &&
        prev.version !== version
      )
      if (versionChanged) {
        history.unshift({
          version: prev.version!,
          installedAt: prev.installedAt,
        })
      }
      // Only carry a previousVersion when the install actually changed the
      // version. A reinstall / repair that lands on the same version must NOT
      // record `previousVersion = currentVersion` — that self-referential
      // pointer lights up `canRollback` and points `rollbackAgentType` at the
      // same version we're already on. End result before this fix: a
      // permanent "Roll back" button that no-op reinstalls the current
      // version forever.
      const nextPreviousVersion = versionChanged
        ? prev!.version
        : prev?.previousVersion && prev.previousVersion !== version
          ? prev.previousVersion
          : null
      data[agentType] = {
        name: agentType,
        version,
        installedAt: new Date().toISOString(),
        previousVersion: nextPreviousVersion,
        history: history.slice(0, 10),
      }
      this._writeInstalledHistory(data)
    } catch {}
  }

  recordUninstall(agentType: string): void {
    try {
      const data = this.getInstalledHistory()
      if (data[agentType]) {
        delete data[agentType]
        this._writeInstalledHistory(data)
      }
    } catch {}
  }

  listInstalledAgents(): InstalledAgentRecord[] {
    const data = this.getInstalledHistory()
    const out: InstalledAgentRecord[] = []
    for (const name of Object.keys(data)) {
      const r = data[name]
      const version = r.version || this.getInstalledVersion(name)
      // Auto-heal self-referential previousVersion / history entries written
      // by the pre-fix recordInstall code. Without this scrub, machines
      // upgraded from the buggy version keep seeing the Roll back button
      // even though the only "previous" pointer points at themselves.
      const cleanHistory = (r.history || []).filter(
        (h) => h.version && h.version !== version,
      )
      const cleanPrev =
        r.previousVersion && r.previousVersion !== version
          ? r.previousVersion
          : null
      out.push({
        ...r,
        version,
        history: cleanHistory,
        previousVersion: cleanPrev,
      })
    }
    return out
  }

  // ── Version-targeted installs ──────────────────────────────────

  /**
   * Install an npm-backed agent at an arbitrary version specifier (semver
   * version, dist-tag, or anything `npm install pkg@<spec>` accepts).
   * Powers both rollback (previous version) and update-channel installs
   * (stage.md §2.5 — Beta / Nightly).
   */
  async installAtVersionTag(
    agentType: string,
    target: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    const entry = this.getRegistryEntry(agentType)
    const npmPkg = this.resolveNpmPackage(entry)
    if (!npmPkg)
      return {
        success: false,
        version: null,
        error: "Cannot determine npm package",
      }

    // Bootstrap Node the way the core installer does before its own npm call.
    // This path used to run only for updates and channel switches, where a
    // runtime is already on disk; a first install of a version-pinned agent
    // now lands here too, and on a machine with no Node the npm spawn below
    // would simply fail.
    const installer = this._connector.installer as {
      hasNodejs?: () => boolean
      installNodejs?: (onData?: (d: string) => void) => Promise<unknown>
    }
    try {
      if (
        typeof installer?.hasNodejs === "function" &&
        !installer.hasNodejs() &&
        typeof installer.installNodejs === "function"
      ) {
        await installer.installNodejs(onData)
      }
    } catch (e) {
      if (onData) onData(`\nCould not prepare Node.js: ${String(e)}\n`)
    }

    const prefixDir = path.join(CONFIG_DIR, "runtimes", agentType)
    fs.mkdirSync(prefixDir, { recursive: true })
    const args = [
      "install",
      "--save",
      "--prefix",
      prefixDir,
      `${npmPkg}@${target}`,
    ]

    // Invoke bundled `node npm-cli.js` directly (no shell) so non-ASCII home
    // paths survive on Windows; see resolveNpmInvocation().
    const inv = resolveNpmInvocation()
    if (onData) onData(`$ npm ${args.join(" ")}\n\n`)

    return new Promise((resolve) => {
      const proc = spawn(inv.cmd, [...inv.preArgs, ...args], {
        shell: inv.useShell,
        cwd: prefixDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: withPathEnv(PORTABLE_NODE_DIR + path.delimiter + readPathEnv()),
        windowsHide: true,
      })
      proc.stdout?.setEncoding("utf-8")
      proc.stderr?.setEncoding("utf-8")
      proc.stdout?.on("data", (d) => onData && onData(d))
      proc.stderr?.on("data", (d) => onData && onData(d))
      proc.on("error", (err) =>
        resolve({ success: false, version: null, error: err.message }),
      )
      proc.on("close", (code) => {
        if (code === 0) {
          this.recordInstall(agentType)
          this.deps.clearCatalogCache()
          // Read what actually landed — for dist-tags the resolved version
          // can differ from the input string ("beta" → "2.1.144-beta.3").
          const resolved = this.getInstalledVersion(agentType) || target
          if (onData) onData(`\nInstalled ${npmPkg}@${resolved}.\n`)
          resolve({ success: true, version: resolved })
        } else {
          resolve({
            success: false,
            version: null,
            error: `Install failed with code ${code}`,
          })
        }
      })
    })
  }

  async rollbackAgentType(
    agentType: string,
    onData: (data: string) => void,
  ): Promise<{ success: boolean; version: string | null; error?: string }> {
    const data = this.getInstalledHistory()
    const record = data[agentType]
    const current = record?.version || this.getInstalledVersion(agentType)
    // Resolve the first history / previousVersion entry that is *different*
    // from the version currently on disk. Without this filter a stale
    // previousVersion pointer (pre-fix history records carrying
    // previousVersion === currentVersion) makes rollback re-install the
    // same version and the UI keep offering Roll back forever.
    const candidates = [
      ...(record?.history || []).map((h) => h.version),
      record?.previousVersion || null,
    ].filter((v): v is string => !!v && v !== current)
    const target = candidates[0]
    if (!target)
      return {
        success: false,
        version: null,
        error: "No previous version to roll back to",
      }

    // Delegate to the shared install-at-version pipeline so rollback and
    // channel switching share the same npm spawn + history recording path.
    return this.installAtVersionTag(agentType, target, onData)
  }

  // ── Update checks ──────────────────────────────────────────────

  async checkAgentUpdates(
    options: { force?: boolean } = {},
  ): Promise<AgentUpdateInfo[]> {
    const now = Date.now()
    const ttl = 60 * 60 * 1000
    // Cache hit ONLY when the renderer didn't ask for a forced refresh,
    // the cache holds something useful, and the entry is still inside the
    // TTL. The previous implementation had this inverted: `!options.force`
    // returned the cache unconditionally, even after `clearCatalogCache()`
    // had reset it to `[]` — so the detail page silently lost the
    // "Update to v…" button immediately after a rollback / install /
    // uninstall, until the hourly background refresh re-populated the
    // cache.
    const cacheFresh =
      this._updatesCache.value.length > 0 && now - this._updatesCache.at < ttl
    if (!options.force && cacheFresh) {
      return this._updatesCache.value
    }

    if (this._updatesCache.inFlight) return this._updatesCache.inFlight
    this._updatesCache.inFlight = this._loadAgentUpdates()
      .then((updates) => {
        this._updatesCache = { value: updates, at: Date.now(), inFlight: null }
        return updates
      })
      .catch((err) => {
        this._updatesCache.inFlight = null
        throw err
      })
    return this._updatesCache.inFlight
  }

  private async _loadAgentUpdates(): Promise<AgentUpdateInfo[]> {
    // Use the full catalog (every entry with installed=true), not just the
    // history file — agents installed globally / pre-launcher won't be in
    // the history but are still installed and worth checking for updates.
    const catalog = (await this.deps.getCatalog()) as Array<
      Record<string, unknown>
    >
    const installedEntries = catalog.filter((e) => e.installed === true)
    const historyByName = new Map(
      this.listInstalledAgents().map((r) => [r.name, r.version]),
    )

    return Promise.all(
      installedEntries.map(async (entry) => {
        const name = entry.name as string
        const npmPkg = this.resolveNpmPackage(entry)
        const current =
          historyByName.get(name) || this.getInstalledVersion(name)
        if (!npmPkg) return { name, current, latest: null }
        const info = await fetchNpmInfo(npmPkg).catch(() => null)
        return { name, current, latest: resolveLatestVersion(info) }
      }),
    )
  }

  async getAgentChangelog(agentType: string): Promise<{
    versions: Array<{ version: string; date?: string }>
    homepage?: string
    latest?: string | null
    error?: string
  }> {
    const entry = this.getRegistryEntry(agentType)
    const homepage = (entry?.homepage as string | undefined) || undefined
    const npmPkg = this.resolveNpmPackage(entry)
    // A code, not prose: the renderer turns this one into a translated
    // explanation, while a genuine fetch failure below is passed through as the
    // message it came with.
    if (!npmPkg)
      return { versions: [], homepage, latest: null, error: NO_NPM_PACKAGE }
    try {
      const info = await fetchNpmInfo(npmPkg)
      const time = info.time || {}
      // Show pre-releases in the changelog list (useful for visibility), but
      // return `latest` as the stable dist-tag so the detail page's
      // "Update to vX" computation matches what `npm install` actually fetches.
      const versions = sortedPublishedVersions(info, {
        includePreRelease: true,
      })
        .slice(0, 12)
        .map((v) => ({ version: v, date: time[v] }))
      return { versions, homepage, latest: resolveLatestVersion(info) }
    } catch (e: unknown) {
      return {
        versions: [],
        homepage,
        latest: null,
        error: (e as Error).message,
      }
    }
  }
}
