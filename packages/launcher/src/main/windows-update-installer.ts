// ── Windows update installer handoff ──
//
// Starting NSIS while Electron and its agent processes are still shutting down
// races the installer against open files in the application directory. On some
// machines the bootstrapper then exits cleanly without replacing anything: the
// launcher disappears, but no installation UI follows.
//
// A detached PowerShell handoff avoids that race. It waits for this process to
// be completely gone and only then starts the staged NSIS installer. Paths are
// passed in the UTF-16 environment block, which also keeps Chinese profile and
// installation paths intact.
import { spawn, type ChildProcess, type SpawnOptions } from "child_process"

const INSTALLER_ENV = "OPENAGENTS_UPDATE_INSTALLER"
const INSTALL_DIRECTORY_ENV = "OPENAGENTS_UPDATE_DIRECTORY"
const PARENT_PID_ENV = "OPENAGENTS_UPDATE_PARENT_PID"
const ALIVE_PROBE_MS = 750

const HANDOFF_SCRIPT = `
$ErrorActionPreference = "Stop"
$installer = $env:${INSTALLER_ENV}
$installDir = $env:${INSTALL_DIRECTORY_ENV}
$parentPid = 0
[void][int]::TryParse($env:${PARENT_PID_ENV}, [ref]$parentPid)

if ([string]::IsNullOrWhiteSpace($installer) -or -not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Downloaded update installer was not found"
}

# Do not let a stuck shutdown leave a hidden helper around forever.
$deadline = [DateTime]::UtcNow.AddMinutes(5)
while ($parentPid -gt 0 -and (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {
  if ([DateTime]::UtcNow -ge $deadline) { throw "Timed out waiting for OpenAgents to exit" }
  Start-Sleep -Milliseconds 200
}

$installerArgs = @("--updated", "--force-run")
if (-not [string]::IsNullOrWhiteSpace($installDir)) {
  # NSIS requires /D to be the final argument. Because it is last, a path with
  # spaces is consumed as a single directory value by NSIS.
  $installerArgs += "/D=$installDir"
}
$proc = Start-Process -FilePath $installer -ArgumentList $installerArgs -PassThru
if ($null -eq $proc) { throw "Installer did not start" }
`.trim()

export function hasNonAsciiPathSegment(filePath: string): boolean {
  return /[^\x00-\x7f]/.test(filePath)
}

export function encodedInstallerHandoffCommand(): string {
  return Buffer.from(HANDOFF_SCRIPT, "utf16le").toString("base64")
}

export interface InstallerLaunchOptions {
  parentPid: number
  installDirectory?: string | null
}

export interface InstallerLaunch {
  ok: boolean
  detail: string
}

type SpawnFn = typeof spawn

function spawnAndProbe(
  spawnProcess: SpawnFn,
  command: string,
  args: string[],
  options: SpawnOptions,
  probeMs: number,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawnProcess(command, args, options)
    } catch (err) {
      reject(err)
      return
    }
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      settle(() => {
        try {
          child.unref()
        } catch {}
        resolve(null)
      })
    }, probeMs)
    child.once("error", (err) => settle(() => reject(err)))
    child.once("exit", (code) => settle(() => resolve(code ?? 0)))
  })
}

/**
 * Start a helper that waits for the current app to exit before launching NSIS.
 * The app only quits after this helper has demonstrably stayed alive.
 */
export async function launchWindowsUpdateInstaller(
  installerPath: string,
  options: InstallerLaunchOptions,
  log: (msg: string) => void = () => {},
  spawnProcess: SpawnFn = spawn,
  probeMs: number = ALIVE_PROBE_MS,
): Promise<InstallerLaunch> {
  try {
    const code = await spawnAndProbe(
      spawnProcess,
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedInstallerHandoffCommand(),
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          [INSTALLER_ENV]: installerPath,
          [INSTALL_DIRECTORY_ENV]: options.installDirectory ?? "",
          [PARENT_PID_ENV]: String(options.parentPid),
        },
      },
      probeMs,
    )
    if (code === null) {
      return { ok: true, detail: "installer handoff is waiting for app exit" }
    }
    const detail = `installer handoff exited early with code ${code}`
    log(`[updater] ${detail}`)
    return { ok: false, detail }
  } catch (err) {
    const detail = `could not start installer handoff: ${(err as Error).message}`
    log(`[updater] ${detail}`)
    return { ok: false, detail }
  }
}
