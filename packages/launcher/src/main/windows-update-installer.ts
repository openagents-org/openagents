// ── Windows update installer handoff ──
//
// electron-updater's own handoff is fire-and-forget: NsisUpdater.doInstall()
// spawns the staged NSIS installer, returns `true` immediately, and BaseUpdater
// quits the app on the very next tick. Everything that can go wrong afterwards —
// Windows refusing to start the executable, a per-machine install demanding
// elevation, the user dismissing the UAC prompt — surfaces long after the
// process is gone. From the user's side the launcher "just exits and nothing
// installs", which is exactly the reported failure.
//
// So we start the installer ourselves, confirm it is actually running, and only
// then let the caller quit. Two launch paths:
//
//   direct    — spawn() goes through CreateProcessW, so a Chinese username in
//               the path is safe. This is the normal case.
//   elevated  — a per-machine install (Program Files) needs admin rights;
//               CreateProcess then fails with ERROR_ELEVATION_REQUIRED, which
//               Node surfaces as UNKNOWN/EACCES/EPERM. electron-updater falls
//               back to elevate.exe here, which takes its arguments as ANSI and
//               mangles non-ASCII paths. PowerShell's Start-Process -Verb RunAs
//               is Unicode-clean, and the path stays off the command line
//               entirely — it is passed through the (UTF-16) environment block.
import { spawn, type ChildProcess, type SpawnOptions } from "child_process"

const INSTALLER_ENV = "OPENAGENTS_UPDATE_INSTALLER"

// What electron-updater passes for a non-silent update install: `--updated`
// tells the NSIS script this is an upgrade of an existing install, `--force-run`
// relaunches the app afterwards.
const INSTALLER_ARGS = ["--updated", "--force-run"]

/**
 * How long the installer has to stay alive before we believe it started. An
 * executable Windows refuses to run, or a UAC prompt the user dismisses, dies
 * well inside this window; a real install is still going after it.
 */
const ALIVE_PROBE_MS = 1500

/** Longest we wait for the elevated handoff, which blocks on the UAC prompt. */
const ELEVATED_TIMEOUT_MS = 120_000

// Node reports ERROR_ELEVATION_REQUIRED inconsistently across Windows versions;
// all three of these mean "run it as admin instead".
const ELEVATION_ERROR_CODES = new Set(["EACCES", "EPERM", "UNKNOWN"])

// PowerShell reads -EncodedCommand as UTF-16LE. Keeping the installer path out
// of the command text is what makes this safe: it avoids cmd.exe's OEM code
// page and PowerShell quoting, both of which can corrupt a path such as
// C:\Users\张三\AppData\Local\...\update.exe.
const ELEVATED_HANDOFF_SCRIPT = `
$ErrorActionPreference = "Stop"
$installer = $env:${INSTALLER_ENV}
if ([string]::IsNullOrWhiteSpace($installer) -or -not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Downloaded update installer was not found"
}
$proc = Start-Process -FilePath $installer -ArgumentList @(${INSTALLER_ARGS.map(
  (a) => `"${a}"`,
).join(", ")}) -Verb RunAs -PassThru
if ($null -eq $proc) { throw "Installer did not start" }
Start-Sleep -Milliseconds ${ALIVE_PROBE_MS}
$proc.Refresh()
if ($proc.HasExited -and $proc.ExitCode -ne 0) {
  throw "Installer exited immediately with code $($proc.ExitCode)"
}
`.trim()

export function hasNonAsciiPathSegment(filePath: string): boolean {
  return /[^\x00-\x7f]/.test(filePath)
}

export function encodedElevatedHandoffCommand(): string {
  return Buffer.from(ELEVATED_HANDOFF_SCRIPT, "utf16le").toString("base64")
}

export interface InstallerLaunch {
  ok: boolean
  /** Human-readable outcome, logged verbatim and shown to the user on failure. */
  detail: string
}

type SpawnFn = typeof spawn

/**
 * Start a process and wait long enough to tell "running" from "died on the
 * spot". Resolves with the exit code when it ends inside the probe window, or
 * null when it is still running — the healthy case for an installer.
 */
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
        // Still alive: let it outlive us.
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
 * Launch the staged NSIS installer and report whether it is genuinely running.
 * A false result means the app must NOT quit — nothing would install it.
 */
export async function launchWindowsUpdateInstaller(
  installerPath: string,
  log: (msg: string) => void = () => {},
  spawnProcess: SpawnFn = spawn,
  probeMs: number = ALIVE_PROBE_MS,
): Promise<InstallerLaunch> {
  const base: SpawnOptions = { detached: true, stdio: "ignore" }

  try {
    const code = await spawnAndProbe(
      spawnProcess,
      installerPath,
      INSTALLER_ARGS,
      base,
      probeMs,
    )
    // Exit 0 inside the probe window is fine: the NSIS bootstrapper hands off to
    // an inner instance and returns. A non-zero code means it gave up.
    if (code === null) return { ok: true, detail: "installer is running" }
    if (code === 0) return { ok: true, detail: "installer handed off (exit 0)" }
    log(
      `[updater] installer exited immediately with code ${code} — retrying with elevation`,
    )
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? ""
    if (!ELEVATION_ERROR_CODES.has(code)) {
      return {
        ok: false,
        detail: `could not start installer (${code || "spawn failed"}): ${(err as Error).message}`,
      }
    }
    log(`[updater] installer needs elevation (${code}) — retrying through UAC`)
  }

  // The script does its own alive-probe and reports the verdict through its exit
  // code, so here we wait for PowerShell itself to finish — which also means we
  // stay up (and installable) for as long as the UAC prompt is on screen.
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
        encodedElevatedHandoffCommand(),
      ],
      {
        ...base,
        windowsHide: true,
        env: { ...process.env, [INSTALLER_ENV]: installerPath },
      },
      ELEVATED_TIMEOUT_MS,
    )
    if (code === 0) return { ok: true, detail: "installer started through UAC" }
    if (code === null) {
      return { ok: false, detail: "elevated handoff timed out" }
    }
    return { ok: false, detail: `elevated handoff exited with code ${code}` }
  } catch (err) {
    return {
      ok: false,
      detail: `elevated handoff failed: ${(err as Error).message}`,
    }
  }
}
