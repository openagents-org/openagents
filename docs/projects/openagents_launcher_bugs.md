# OpenAgents Launcher — Bug Tracker

Last updated: 2026-03-27

## Open Bugs

No open bugs.

## Resolved Bugs (Closed)

### BUG-R16: Workspace endpoint returns 500 on /v1/discover
- **Status:** Resolved
- **Description:** The `/v1/discover` endpoint returned HTTP 500 Internal Server Error for workspace `5fc4c33d`.
- **Fix:** Backend server issue resolved.

### BUG-R01: Bundled core library version mismatch
- **Status:** Resolved in launcher v0.6.0
- **Description:** Two copies of the core library existed — bundled (asar) and global. They could be different versions, causing inconsistent behavior.
- **Fix:** Removed bundled dependency entirely. Single copy at `~/.openagents/nodejs/node_modules/`. Auto-update on every startup.

### BUG-R02: Install tab freeze after installing agent
- **Status:** Resolved in launcher v0.3.x
- **Description:** After installing openclaw, clicking "Back to Install" didn't work. The entire app froze.
- **Fix:** Fixed event listener registration order — `btn-start-all` and `btn-stop-all` listeners were attached before elements existed, causing JS error that broke all subsequent click handlers.

### BUG-R03: sharp/koffi native module compilation fails
- **Status:** Resolved in core v0.2.44
- **Description:** `npm install -g openclaw` fails because `sharp` and `koffi` post-install scripts can't find `node` on PATH, or require native build tools not present on the machine.
- **Fix:** Added `--ignore-scripts` flag to all npm install commands. OpenClaw works without sharp/koffi (they're optional for image processing).

### BUG-R04: Console window pops up when agent processes message
- **Status:** Resolved in core v0.2.33
- **Description:** On Windows, a visible cmd.exe console window appeared briefly every time the openclaw CLI was invoked to process a workspace message.
- **Fix:** Added `windowsHide: true` to spawn options.

### BUG-R05: macOS npm global path differs from Windows (lib/node_modules/)
- **Status:** Resolved in core v0.2.49+
- **Description:** npm `-g` installs to `node_modules/` on Windows but `lib/node_modules/` on macOS/Linux. The Launcher only checked `node_modules/`, so core library was "not found" on macOS despite being installed.
- **Fix:** Replaced `npm install -g` with `npm install --prefix ~/.openagents/nodejs` which forces `node_modules/` on all platforms. No platform-specific path logic needed.

### BUG-R06: Single instance not enforced — multiple launchers could run
- **Status:** Resolved in launcher v0.6.4
- **Description:** Users could accidentally open multiple Launcher instances, causing daemon conflicts and port binding errors.
- **Fix:** Added `app.requestSingleInstanceLock()`. Second instance shows a dialog and quits. First instance's window gets focused.

### BUG-R07: OpenClaw shows INSTALLED after uninstall (stale shims)
- **Status:** Resolved in core v0.2.46+
- **Description:** After uninstalling OpenClaw, the Install tab still shows "INSTALLED". Caused by npm leaving extensionless shim files (Unix-style) that `where` command finds.
- **Fix:** `isInstalled()` now verifies the actual package exists in `node_modules` before reporting installed. Also `_cleanStaleShims()` removes all shim variants after uninstall. Further simplified in v0.2.52 — no more shim hunting, uses deterministic `openclaw.mjs` path.

### BUG-R08: Chinese/CJK username breaks npm and openclaw CLI
- **Status:** Resolved in core v0.2.47+
- **Description:** Users with Chinese/Japanese/Korean characters in their Windows username (e.g., `C:\Users\王思璠\`) experience garbled paths when running npm.cmd or openclaw.cmd through cmd.exe. Batch files can't handle Unicode paths.
- **Fix:** All commands now use `node.exe` directly instead of `.cmd` shims. npm runs via `node.exe npm-cli.js`. OpenClaw runs via `node.exe openclaw.mjs`. No cmd.exe involvement.

### BUG-R09: Core library auto-update notification not shown
- **Status:** Resolved in launcher v0.6.2+
- **Description:** `checkCoreUpdate()` was called before `createWindow()`, so `mainWindow` was null and the notification was never sent to the renderer.
- **Fix:** Moved `checkCoreUpdate()` to after `createWindow()`. Added periodic check every 4 hours. Auto-update runs on every startup before window opens.

### BUG-R10: Node.js zip extraction fails silently on Windows
- **Status:** Resolved in launcher v0.6.0+
- **Description:** `Expand-Archive` (PowerShell) silently fails on some Windows machines. The zip downloads but extraction produces empty directory.
- **Fix:** Replaced zip download with direct `node.exe` binary download (85MB single file) + npm tarball extraction via `tar`. No zip, no Expand-Archive needed.

### BUG-R11: Daemon start fails from packaged exe (asar path)
- **Status:** Resolved in launcher v0.4.1+
- **Description:** `_startDaemon()` used `require.resolve()` which returned a path inside the asar virtual filesystem. Child processes can't access asar paths, so the daemon crashed with MODULE_NOT_FOUND.
- **Fix:** Search for the CLI at the global portable Node.js path first. Removed bundled dependency in v0.6.0.

### BUG-R12: Multiple daemon instances cause duplicate responses
- **Status:** Resolved in core v0.2.33+
- **Description:** `restart:` command started a new adapter loop without properly stopping the old one. Multiple adapter loops polled the same workspace, causing each message to be processed 2-5 times.
- **Fix:** Added `_stopToken` per adapter. `restartAgent()` sets the stop token, waits for the old loop to exit, then starts a new one.

### BUG-R13: Dashboard status flapping (running/stopped)
- **Status:** Resolved in core v0.2.14+
- **Description:** Dashboard alternated between showing "running" and "stopped" on every refresh. Caused by cross-session process.kill on Windows and stale PID files.
- **Fix:** Removed PID validation from `getDaemonPid()`. Added EPERM handling in `_isAlive()`. Always clean status files on daemon stop.

### BUG-R14: OpenClaw binary not found on macOS (node_modules/.bin path)
- **Status:** Resolved in core v0.2.52
- **Description:** After switching to `npm --prefix`, binary shims moved to `node_modules/.bin/` but the adapter only searched `bin/` and the root directory.
- **Fix:** Eliminated shim hunting entirely. Always spawn `node + openclaw.mjs` directly. Deterministic path: `~/.openagents/nodejs/node_modules/openclaw/openclaw.mjs`.

### BUG-R15: configureNativeAuth fails when ~/.openclaw doesn't exist
- **Status:** Resolved in core v0.2.48
- **Description:** OpenClaw installed with `--ignore-scripts` skips initial setup. The `~/.openclaw/` directory doesn't exist, so writing `openclaw.json` and `auth-profiles.json` fails silently.
- **Fix:** `configureNativeAuth()` now creates all necessary directories with `mkdirSync({ recursive: true })` before writing config files.
