import fs from "fs"
import path from "path"

import { WORKSPACE_HOST_API, type WorkspaceBundleUpdate } from "../../shared/workspace-bundle"
import { toBundleInfo, verifyManifest, type BundleInfo, type BundleManifest } from "./manifest"
import { BundleStore, committedAtOf, type BundleChoice } from "./store"
import { BundleContentError } from "./tar"

/**
 * Keeps the Workspace bundle current without a launcher release.
 *
 * The feed is checked shortly after start and then periodically. A newer
 * build that verifies and runs on this launcher is downloaded, hash-checked
 * and unpacked beside the old one, then:
 *
 *  - with no workspace page open, it is simply served from then on;
 *  - with pages open, they are offered a refresh, because swapping the files
 *    under a running page breaks its next lazy-loaded chunk.
 *
 * A downloaded bundle is on probation until a page loaded from it reports that
 * it started. One that does not within the boot timeout is set aside for the
 * session — given up on for good after a second failed start — and every page
 * goes back to the download that was working before it, or else to the bundle
 * that shipped with the launcher. A bad publish costs a reload rather than a
 * launcher nobody can use. Probation is kept on disk too: quitting before the
 * build reported counts as a failed start at the next launch, so a build that
 * never gets to run long enough for the timeout is still given up on.
 */

/** What the updater needs from whatever shows the bundle (WorkspaceHost). */
export interface BundlePages {
  /** Whether any workspace page is loaded. */
  hasPages(): boolean
  /** Offer every page the update; null withdraws the offer. */
  announce(update: WorkspaceBundleUpdate | null): void
  /** Reload every page, so each picks up whichever bundle is served now. */
  reloadAll(): void
}

export interface BundleUpdaterOptions {
  store: BundleStore
  builtin: { dir: string; info: BundleInfo | null }
  /** Re-read on every check: the endpoint can change while the app runs. */
  feedUrl: () => string | null
  keys: readonly string[]
  /** The launcher's "update automatically" setting. Stops downloads, not serving. */
  autoUpdate: () => boolean
  fetchText: (url: string) => Promise<string | null>
  /**
   * Download to `dest`, rejecting unless the file's SHA-256 is `sha256`, and
   * as soon as more than `size` bytes arrive.
   */
  download: (url: string, dest: string, expected: { sha256: string; size: number }) => Promise<void>
  hostApi?: number
  log?: (message: string) => void
  bootTimeoutMs?: number
  firstCheckMs?: number
  intervalMs?: number
}

export class WorkspaceBundleUpdater {
  private _served: BundleChoice
  private _pending: BundleChoice | null = null
  private _pages: BundlePages | null = null
  private _checking: Promise<void> | null = null
  /** The served download has started at least once this session. */
  private _proven = false
  /** Pages loading a download on probation, by webContents id. */
  private readonly _probation = new Map<number, ReturnType<typeof setTimeout>>()
  /** Builds that failed to start this session; not served or fetched again until restart. */
  private readonly _failedThisSession = new Set<string>()
  private _timer: ReturnType<typeof setTimeout> | null = null
  private readonly _builtin: BundleChoice
  private readonly _hostApi: number
  private readonly _log: (message: string) => void

  constructor(private readonly _o: BundleUpdaterOptions) {
    this._hostApi = _o.hostApi ?? WORKSPACE_HOST_API
    this._log = _o.log ?? (() => {})
    this._builtin = { ..._o.builtin, source: "builtin" }
    const unproven = _o.store.takeUnproven()
    if (unproven) {
      const givenUp = _o.store.recordFailedStart(unproven)
      this._log(`[bundle-ota] bundle ${unproven} did not report a start last session — ${givenUp ? "giving up on it" : "trying it once more"}`)
    }
    // With no feed this install runs only what it shipped with — and leaves
    // earlier downloads alone, for when the feed is turned back on.
    if (_o.feedUrl() === null) {
      this._served = this._builtin
    } else {
      const candidates = _o.store.candidates(_o.builtin.info, this._hostApi)
      this._served = candidates[0] ?? this._builtin
      // What is served, and what it would fall back to; nothing else is reachable.
      _o.store.prune(candidates.map((c) => c.info!.version))
    }
    if (this._served.source === "downloaded") this._log(`[bundle-ota] serving downloaded bundle ${this._served.info?.version}`)
  }

  /** The bundle being served. */
  served(): BundleChoice {
    return this._served
  }

  /** The update waiting for the pages to refresh, if any. */
  pending(): WorkspaceBundleUpdate | null {
    return this._pending?.info ? { version: this._pending.info.version } : null
  }

  attach(pages: BundlePages): void {
    this._pages = pages
  }

  start(): void {
    const { firstCheckMs = 15_000, intervalMs = 30 * 60_000 } = this._o
    const schedule = (delay: number): void => {
      this._timer = setTimeout(() => {
        void this.check().finally(() => schedule(intervalMs))
      }, delay)
      this._timer.unref?.()
    }
    schedule(firstCheckMs)
  }

  stop(): void {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
    this._clearProbation()
  }

  /** One look at the feed. Concurrent calls share the same check. */
  check(): Promise<void> {
    this._checking ??= this._check()
      .catch((err) => this._log(`[bundle-ota] update failed: ${(err as Error).message}`))
      .finally(() => { this._checking = null })
    return this._checking
  }

  /**
   * Serve the pending update and reload the pages onto it. False when there
   * is nothing to apply.
   */
  apply(): boolean {
    if (!this._pending || this._o.feedUrl() === null) return false
    this._served = this._pending
    this._pending = null
    this._proven = false
    this._log(`[bundle-ota] now serving ${this._served.info?.version}`)
    this._pages?.announce(null)
    this._pages?.reloadAll()
    return true
  }

  /**
   * The endpoint changed. A downloaded bundle is the HOSTED front end, so on
   * an endpoint the feed does not serve it gives way to the built-in bundle at
   * once, rather than at the next restart: the newest hosted front end may
   * call API a self-hosted backend does not have.
   */
  reconsider(): void {
    if (this._o.feedUrl() !== null) return
    if (this._pending) {
      this._pending = null
      this._pages?.announce(null)
    }
    if (this._served.source !== "downloaded") return
    this._log("[bundle-ota] endpoint has no bundle feed — back to the built-in bundle")
    if (!this._proven) this._o.store.clearStarting()
    this._clearProbation()
    this._served = this._builtin
    this._proven = false
    this._pages?.reloadAll()
  }

  /** A page began loading the served bundle. */
  pageStarted(id: number): void {
    if (this._served.source !== "downloaded" || this._proven) return
    if (this._served.info) this._o.store.recordStarting(this._served.info.version)
    if (this._probation.has(id)) return
    const timeout = this._o.bootTimeoutMs ?? 45_000
    const timer = setTimeout(() => this._failed(`no start signal within ${timeout / 1000}s`), timeout)
    timer.unref?.()
    this._probation.set(id, timer)
  }

  /** The page closed before it could report either way. */
  pageGone(id: number): void {
    const timer = this._probation.get(id)
    if (timer) clearTimeout(timer)
    this._probation.delete(id)
  }

  /**
   * A page reported that the bundle started. Only a page on probation counts:
   * one still running an older bundle — left mid-sign-in on the account site
   * when the update was applied, say — proves nothing about this one.
   */
  pageReady(id: number): void {
    if (this._served.source !== "downloaded" || this._proven || !this._probation.has(id)) return
    this._proven = true
    this._clearProbation()
    if (this._served.info) this._o.store.recordStart(this._served.info.version)
    this._log(`[bundle-ota] bundle ${this._served.info?.version} started`)
  }

  private _clearProbation(): void {
    for (const timer of this._probation.values()) clearTimeout(timer)
    this._probation.clear()
  }

  private _failed(reason: string): void {
    if (this._served.source !== "downloaded" || !this._served.info) return
    const { version } = this._served.info
    const givenUp = this._o.store.recordFailedStart(version)
    this._failedThisSession.add(version)
    this._clearProbation()
    // Whatever is best now: the download before this one when it is still
    // usable, a pending newer one that the store has made active, or the
    // built-in bundle.
    this._served = this._o.store.choose(this._o.builtin, this._hostApi, this._failedThisSession)
    this._proven = false
    if (this._pending && this._pending.dir === this._served.dir) this._pending = null
    this._log(
      `[bundle-ota] bundle ${version} failed to start (${reason}) — ` +
        `${givenUp ? "giving up on it" : "will retry it next launch"}; now serving ${this._served.info?.version ?? "the built-in bundle"}`,
    )
    this._pages?.announce(this.pending())
    this._pages?.reloadAll()
  }

  /** Newer than everything this launcher already has, and runnable on it. */
  private _wanted(manifest: BundleManifest): boolean {
    const newest = Math.max(committedAtOf(this._builtin.info), committedAtOf(this._served.info), committedAtOf(this._pending?.info ?? null))
    if (manifest.committedAt <= newest) return false
    if (manifest.minHostApi > this._hostApi) {
      this._log(`[bundle-ota] ${manifest.version} needs host API ${manifest.minHostApi}, this launcher has ${this._hostApi} — waiting for a launcher update`)
      return false
    }
    // Already installed and failed this session: the next launch retries it.
    if (this._failedThisSession.has(manifest.version)) return false
    return !this._o.store.isRejected(manifest.version)
  }

  private async _check(): Promise<void> {
    const feed = this._o.feedUrl()
    if (!feed || !this._o.autoUpdate()) return
    const text = await this._o.fetchText(feed)
    if (!text) return
    let manifest: BundleManifest | null = null
    try {
      manifest = verifyManifest(JSON.parse(text), this._o.keys)
    } catch {
      /* reported below */
    }
    if (!manifest) {
      this._log("[bundle-ota] feed manifest did not verify — ignoring it")
      return
    }
    if (!this._wanted(manifest)) return
    const url = new URL(manifest.archive, feed)
    if (url.protocol !== "https:" && url.protocol !== new URL(feed).protocol) throw new Error(`refusing archive URL ${url}`)

    const { store } = this._o
    await fs.promises.mkdir(store.root, { recursive: true })
    const archive = path.join(store.root, `${manifest.version}.tar.gz`)
    let dir: string
    try {
      this._log(`[bundle-ota] downloading ${manifest.version}`)
      // A failed download is worth retrying on the next check, and so is an
      // install that the machine got in the way of (a full disk, a folder held
      // open by a virus scan). An archive that arrived intact but does not
      // hold what its manifest says never will be.
      await this._o.download(url.toString(), archive, { sha256: manifest.sha256, size: manifest.size })
      dir = await store.install(manifest, archive).catch((err: Error) => {
        if (err instanceof BundleContentError) store.reject(manifest!.version)
        throw err
      })
    } finally {
      await fs.promises.rm(archive, { force: true }).catch(() => {})
    }
    store.activate(manifest, this._served.source === "downloaded" ? this._served.info : null)
    this._pending = { dir, source: "downloaded", info: toBundleInfo(manifest) }
    if (this._pages?.hasPages()) this._pages.announce(this.pending())
    else this.apply()
  }
}
