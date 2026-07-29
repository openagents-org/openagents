import { spawn } from "child_process"

const INSTALLER_ENV = "OPENAGENTS_UPDATE_INSTALLER"

// PowerShell's -EncodedCommand input is UTF-16LE. Keeping the installer path
// out of the command text entirely is important: it avoids cmd.exe's OEM code
// page and PowerShell command-line quoting, both of which can corrupt a path
// such as C:\Users\张三\AppData\Local\...\update.exe.
const INSTALLER_HANDOFF_SCRIPT = `
$ErrorActionPreference = "Stop"
$installer = $env:${INSTALLER_ENV}
if ([string]::IsNullOrWhiteSpace($installer) -or -not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "Downloaded update installer was not found"
}
Start-Process -FilePath $installer -ArgumentList @("--updated", "--force-run")
`.trim()

export function hasNonAsciiPathSegment(filePath: string): boolean {
  return /[^\x00-\x7f]/.test(filePath)
}

export function encodedInstallerHandoffCommand(): string {
  return Buffer.from(INSTALLER_HANDOFF_SCRIPT, "utf16le").toString("base64")
}

/**
 * Launch an NSIS updater without putting its path on a cmd.exe/PowerShell
 * command line. Windows passes environment variables as UTF-16, and
 * Start-Process ultimately uses ShellExecuteExW, preserving non-ASCII paths.
 */
export async function launchUnicodeWindowsInstaller(
  installerPath: string,
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(
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
        },
      },
    )

    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `Unicode-safe installer handoff exited with code ${String(code)}`,
          ),
        )
      }
    })
  })
}
