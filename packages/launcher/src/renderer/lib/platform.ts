/**
 * Publish the OS to CSS as `<html data-platform>`, so the stylesheet can answer
 * the "which corner?" question by itself.
 *
 * The window has no system title bar (`titleBarStyle: 'hidden'`, see
 * main/index.ts) and the platforms disagree about where the buttons go — macOS
 * draws its traffic lights over the top-LEFT, Windows and Linux put
 * minimise/maximise/close on the top-RIGHT. So exactly one of the two panes has
 * to make room, and which one is a per-platform fact that several components
 * would otherwise each have to branch on. Expressed once, as the pair
 * `--rail-top-inset` / `--content-top-inset` in globals.css; everything else
 * just reads the inset for the pane it is in.
 *
 * `process.platform` comes across from preload as a plain value rather than an
 * IPC call, so this can run from the renderer entry before React mounts and the
 * first paint is already correct.
 */
export function initPlatform(): void {
  const p = window.api?.platform
  if (p) document.documentElement.dataset.platform = p
}

/**
 * This machine, in the registry's own vocabulary — the key its `install` blocks
 * are indexed by (`install.macos`, `install.windows`, `install.linux`).
 *
 * From `process.platform` rather than a user-agent sniff: Electron's UA is not
 * where the answer lives, and "does the string contain 'win'" also matches
 * "Darwin". Linux is the fallback because it is the only one of the three the
 * launcher ships for that is not `darwin` or `win32`.
 */
export const REGISTRY_PLATFORM: "macos" | "linux" | "windows" =
  window.api?.platform === "darwin"
    ? "macos"
    : window.api?.platform === "win32"
      ? "windows"
      : "linux"
