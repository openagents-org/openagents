/**
 * The version of the bridge (`window.__oaHost__`) this launcher gives the
 * Workspace bundle.
 *
 * The bundle can now be updated without a launcher release (see
 * main/bundle-ota), so a bundle may arrive that is newer than the launcher
 * running it. Each bundle states the lowest bridge version it needs
 * (`minHostApi`, from workspace/frontend/desktop/host-api.ts), and the
 * launcher only installs one it can actually run.
 *
 * Bump this whenever the preload gains something a bundle may depend on — a
 * new method, a new event, a new config field — and raise the bundle's
 * REQUIRED_HOST_API only when the page cannot work without it. A page that
 * merely benefits from a newer method should feature-detect it instead, so it
 * keeps working on the launchers already installed.
 */
export const WORKSPACE_HOST_API = 1

/** A downloaded bundle that is ready to replace the one on screen. */
export interface WorkspaceBundleUpdate {
  version: string
}
