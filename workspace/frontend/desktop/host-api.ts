/**
 * The lowest launcher bridge version (`window.__oaHost__.hostApi`) this
 * bundle needs. Written into bundle-info.json at build time (see
 * bundle-info.ts); a launcher whose bridge is older will not install a
 * downloaded bundle that asks for more, and keeps the one it has.
 *
 * Raise it only when the page cannot work without something a newer launcher
 * adds (packages/launcher/src/shared/workspace-bundle.ts, WORKSPACE_HOST_API).
 * When the page merely benefits from it, check for the method instead and keep
 * the older behaviour, so the update still reaches launchers already installed.
 */
export const REQUIRED_HOST_API = 1;
