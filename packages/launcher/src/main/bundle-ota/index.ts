import path from "path"
import { app } from "electron"

import { slog } from "../bootstrap/startup-log"
import { downloadToFile, fetchTextRacing } from "../download"
import { builtinBundleDir, serveBundleFrom } from "../workspace-bundle"
import { bundleFeedUrl, readBundleInfo, trustedKeys } from "./manifest"
import { BundleStore } from "./store"
import { WorkspaceBundleUpdater } from "./updater"

export type { BundlePages } from "./updater"
export { WorkspaceBundleUpdater }

/**
 * The updater, wired to Electron and to the protocol handler. Must run after
 * `app.whenReady()` (userData) and before the bundle is first served, so the
 * first page already comes from the right folder.
 */
export function createWorkspaceBundleUpdater(opts: {
  endpoint: () => string | undefined
  autoUpdate: () => boolean
}): WorkspaceBundleUpdater {
  const builtin = builtinBundleDir()
  const updater = new WorkspaceBundleUpdater({
    store: new BundleStore(path.join(app.getPath("userData"), "workspace-bundles"), slog),
    builtin: { dir: builtin, info: readBundleInfo(builtin) },
    feedUrl: () => bundleFeedUrl({ endpoint: opts.endpoint(), packaged: app.isPackaged }),
    keys: trustedKeys(),
    autoUpdate: opts.autoUpdate,
    fetchText: (url) => fetchTextRacing([url], { log: slog }),
    download: async (url, dest, sha256) => {
      await downloadToFile([url], dest, { expectedSha: sha256, log: slog })
    },
    log: slog,
  })
  // Only a download overrides the folder: the built-in one keeps being looked
  // up per request, so a dev build made while the app runs is still found.
  serveBundleFrom(() => {
    const served = updater.served()
    return served.source === "downloaded" ? served.dir : null
  })
  return updater
}
