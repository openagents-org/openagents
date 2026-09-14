/**
 * Why an installed app would not show the Workspace: it has no bundle to load.
 *
 * Thrown by main from `workspace-view:show` and matched by the renderer in the
 * rejected IPC call's message, which Electron prefixes with its own text.
 */
export const WORKSPACE_BUNDLE_MISSING = "workspace-bundle-missing"
