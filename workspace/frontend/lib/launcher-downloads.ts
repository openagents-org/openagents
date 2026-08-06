// Where the "download the launcher" buttons point.
//
// Windows deliberately bypasses the website's /api/download route: that route
// hands out the .msi, and the MSI is the wrong artifact for a person clicking a
// download button. It installs per-machine (so it needs UAC), and double-clicking
// one that is already installed drops into Windows Installer maintenance mode —
// a progress dialog that finishes without ever launching the app, which is what
// "it installed but it won't open" turned out to be. The NSIS .exe installs for
// the current user, needs no elevation, and starts the app when it finishes.
//
// The version-free filename is an alias the release workflow republishes on every
// tag (see .github/workflows/desktop-build.yml, "Mirror release assets to
// Cloudflare R2"), so this URL never has to be bumped.
export const LAUNCHER_DOWNLOAD_WINDOWS =
  "https://dl.openagents.org/launcher/stable/OpenAgents-Launcher-win-x64.exe"

// macOS and Linux keep the website route — it HEAD-checks the CDN mirror and
// falls back to the GitHub asset, and neither platform has the MSI problem.
export const LAUNCHER_DOWNLOAD_MAC =
  "https://openagents.org/api/download/launcher/mac"
export const LAUNCHER_DOWNLOAD_LINUX =
  "https://openagents.org/api/download/launcher/linux-appimage"
