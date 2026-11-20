import fs from "fs"
import path from "path"

import { writeJsonAtomic } from "../atomic-json"
import { parseBundleInfo, readBundleInfo, sameBuild, toBundleInfo, type BundleInfo, type BundleManifest } from "./manifest"
import { extractTarGz } from "./tar"

/**
 * Downloaded Workspace bundles, on disk under userData/workspace-bundles:
 *
 *   state.json   the active download, the one before it, and the builds
 *                that failed to start
 *   <version>/   an unpacked bundle, exactly as the archive held it
 *
 * The one before is kept so a new download that fails to start falls back to
 * the download that was working, not all the way to the bundle that shipped
 * with the launcher. That one is never touched here: it is the last resort.
 */

/** Builds that failed to start, so the same build is not installed again. */
const MAX_REJECTED = 20
/**
 * Failed starts before a build is given up on. One can be a machine that was
 * merely slow — a virus scan of the freshly unpacked files, a dozen tabs
 * restoring — so the build is tried again on the next launch first.
 */
const MAX_FAILED_STARTS = 2

interface StoreState {
  active: BundleInfo | null
  previous: BundleInfo | null
  rejected: string[]
  failures: Record<string, number>
}

export interface BundleChoice {
  dir: string
  source: "builtin" | "downloaded"
  /** Null only for a built-in bundle too old to describe itself. */
  info: BundleInfo | null
}

/** A built-in bundle with no bundle-info.json predates all of this. */
export const committedAtOf = (info: BundleInfo | null): number => info?.committedAt ?? 0

export class BundleStore {
  constructor(
    readonly root: string,
    private readonly log: (message: string) => void = () => {},
  ) {}

  private get statePath(): string {
    return path.join(this.root, "state.json")
  }

  private read(): StoreState {
    try {
      const doc = JSON.parse(fs.readFileSync(this.statePath, "utf-8")) as Partial<StoreState>
      const failures: Record<string, number> = {}
      for (const [version, count] of Object.entries(doc.failures ?? {})) {
        if (Number.isSafeInteger(count)) failures[version] = count
      }
      return {
        active: parseBundleInfo(doc.active),
        previous: parseBundleInfo(doc.previous),
        rejected: Array.isArray(doc.rejected) ? doc.rejected.filter((v): v is string => typeof v === "string") : [],
        failures,
      }
    } catch {
      return { active: null, previous: null, rejected: [], failures: {} }
    }
  }

  private write(state: StoreState): void {
    writeJsonAtomic(this.statePath, state)
  }

  dirFor(version: string): string {
    return path.join(this.root, version)
  }

  isRejected(version: string): boolean {
    return this.read().rejected.includes(version)
  }

  /** Whether `version` is the active download already. */
  isActive(version: string): boolean {
    return this.read().active?.version === version
  }

  /**
   * The downloads worth serving, best first: the active one, then the one
   * before it — each only when it is newer than the bundle that shipped, runs
   * on this launcher, has not been given up on, is not in `skip` (failed this
   * session) and is still intact on disk. A launcher update that ships a newer
   * bundle therefore supersedes older downloads without any clean-up first.
   */
  candidates(builtin: BundleInfo | null, hostApi: number, skip: ReadonlySet<string> = new Set()): BundleChoice[] {
    const { active, previous, rejected } = this.read()
    const out: BundleChoice[] = []
    for (const info of [active, previous]) {
      if (!info || out.some((c) => c.info?.version === info.version)) continue
      const dir = this.dirFor(info.version)
      const onDisk = readBundleInfo(dir)
      const usable =
        !rejected.includes(info.version) &&
        !skip.has(info.version) &&
        info.minHostApi <= hostApi &&
        info.committedAt > committedAtOf(builtin) &&
        !!onDisk && sameBuild(onDisk, info) &&
        fs.existsSync(path.join(dir, "index.html"))
      if (usable) out.push({ dir, source: "downloaded", info })
      else this.log(`[bundle-ota] not using downloaded bundle ${info.version} — older than built-in, incompatible, failed or damaged`)
    }
    return out
  }

  /** The bundle to serve: the best usable download, else the built-in one. */
  choose(builtin: { dir: string; info: BundleInfo | null }, hostApi: number, skip?: ReadonlySet<string>): BundleChoice {
    return this.candidates(builtin.info, hostApi, skip)[0] ?? { ...builtin, source: "builtin" }
  }

  /**
   * Unpack an archive whose hash has already been checked, and check that
   * what came out is the build the manifest described. Nothing is activated
   * here; until `activate`, a half-finished install is just a stray folder.
   */
  async install(manifest: BundleManifest, archive: string): Promise<string> {
    const final = this.dirFor(manifest.version)
    const staging = `${final}.partial`
    await fs.promises.rm(staging, { recursive: true, force: true })
    await fs.promises.mkdir(staging, { recursive: true })
    try {
      const files = await extractTarGz(archive, staging)
      const info = readBundleInfo(staging)
      if (!info || !sameBuild(info, manifest)) throw new Error("bundle-info.json does not match the manifest")
      if (!fs.existsSync(path.join(staging, "index.html"))) throw new Error("archive has no index.html")
      await fs.promises.rm(final, { recursive: true, force: true })
      await fs.promises.rename(staging, final)
      this.log(`[bundle-ota] unpacked ${manifest.version} (${files} files)`)
      return final
    } catch (err) {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  /**
   * Make `info` the active download. `fallback` is the download running now,
   * if any — what to go back to should `info` fail to start.
   */
  activate(info: BundleInfo, fallback: BundleInfo | null): void {
    const state = this.read()
    const next = toBundleInfo(info)
    const previous = fallback && fallback.version !== next.version ? toBundleInfo(fallback) : null
    this.write({ ...state, active: next, previous })
  }

  /**
   * A build failed to start. Returns true once it has failed often enough to
   * be given up on for good (see MAX_FAILED_STARTS).
   */
  recordFailedStart(version: string): boolean {
    const state = this.read()
    const count = (state.failures[version] ?? 0) + 1
    if (count >= MAX_FAILED_STARTS) {
      this.reject(version)
      return true
    }
    this.write({ ...state, failures: { ...state.failures, [version]: count } })
    return false
  }

  /** A build started: forget its earlier failed starts. */
  recordStart(version: string): void {
    const state = this.read()
    if (!(version in state.failures)) return
    const failures = { ...state.failures }
    delete failures[version]
    this.write({ ...state, failures })
  }

  /** Never serve or install `version` again; the one before it takes over. */
  reject(version: string): void {
    const state = this.read()
    const rejected = [...state.rejected.filter((v) => v !== version), version].slice(-MAX_REJECTED)
    const failures = { ...state.failures }
    delete failures[version]
    const active = state.active?.version === version ? state.previous : state.active
    const previous = state.active?.version === version || state.previous?.version === version ? null : state.previous
    this.write({ active, previous, rejected, failures })
  }

  /**
   * Remove every downloaded bundle except `keep`. Only at startup, before
   * anything is served: a page that is open keeps fetching lazy chunks from
   * the folder it was loaded from.
   */
  prune(keep: readonly string[]): void {
    let names: string[]
    try {
      names = fs.readdirSync(this.root)
    } catch {
      return
    }
    for (const name of names) {
      if (name === "state.json" || keep.includes(name)) continue
      try {
        fs.rmSync(path.join(this.root, name), { recursive: true, force: true })
      } catch (err) {
        this.log(`[bundle-ota] could not remove ${name}: ${(err as Error).message}`)
      }
    }
  }
}
