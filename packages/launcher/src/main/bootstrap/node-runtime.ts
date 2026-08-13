/**
 * Getting a working Node.js + npm onto the user's machine.
 *
 * The launcher ships no runtime of its own: on first run it downloads one into
 * ~/.openagents/nodejs and every agent install goes through that copy. Most of
 * the care here is about two hostile environments — a Windows box whose home
 * directory contains non-ASCII characters (cmd.exe re-encodes command lines in
 * the OEM code page and corrupts the path), and a mirror that serves a
 * truncated artifact (hence the SHASUMS256 check on every platform).
 */
import path from "path"
import fs from "fs"
import os from "os"
import { execFileSync, spawnSync } from "child_process"
import { readPathEnv, writePathEnv } from "../env"
import { nodeDistUrls, npmUrls } from "../mirror"
import { downloadToFile, fetchTextRacing } from "../download"
import { PORTABLE_NODE_DIR } from "../agents/paths"
import { slog } from "./startup-log"

/**
 * Belt-and-braces guard for the install pipeline. The agent-launcher core
 * resolves `npm` via `whichBinary('npm')` → first line of `where npm`.
 *
 * On Windows with nvm-for-windows installed, `C:\nvm4w\nodejs\` contains both
 *   - `npm`      (Unix shebang script, no extension)
 *   - `npm.cmd`  (Windows batch shim)
 *
 * `where` lists the bare `npm` first, so cmd.exe ends up trying to run a Unix
 * script and dies with "is not recognized as an internal or external command"
 * — breaking every agent install. The bundled portable runtime only ships
 * `npm.cmd`, so forcing PORTABLE_NODE_DIR to the very front of PATH makes
 * `where npm` return our `npm.cmd` first instead.
 *
 * Idempotent: if PORTABLE_NODE_DIR is already first, this is a no-op.
 */
export function ensureBundledRuntimeFirstOnPath(): void {
  if (process.platform !== "win32") return
  if (!fs.existsSync(PORTABLE_NODE_DIR)) return
  const sep = ";"
  const target = PORTABLE_NODE_DIR.toLowerCase()
  const parts = readPathEnv().split(sep)
  if (parts.length > 0 && parts[0].toLowerCase() === target) return
  const filtered = parts.filter((p) => p.toLowerCase() !== target)
  writePathEnv([PORTABLE_NODE_DIR, ...filtered].join(sep))
}

// Smoke-test a node binary. Returns true only if `--version` exits cleanly.
// Used at startup to detect a corrupt bundled node.exe (e.g. from an
// interrupted download) that Windows would refuse to spawn with
// "此应用无法在你的电脑上运行".
export function canExecuteNodeBinary(binaryPath: string): boolean {
  try {
    const r = spawnSync(binaryPath, ["--version"], {
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return r.status === 0 && !r.error
  } catch {
    return false
  }
}

// Node dist publishes SHASUMS256.txt beside the binaries and every mirror
// carries the same file, so the checksum comes from whichever origin answers
// first and is then enforced on the artifact no matter which mirror served it.
async function fetchNodeShasum(
  nodeVersion: string,
  relativePath: string,
): Promise<string | null> {
  const body = await fetchTextRacing(
    nodeDistUrls(`${nodeVersion}/SHASUMS256.txt`),
    { log: slog },
  )
  if (!body) return null
  for (const line of body.split(/\r?\n/)) {
    const [sum, file] = line.trim().split(/\s+/)
    if (file === relativePath && sum) return sum.toLowerCase()
  }
  return null
}

// Map process.arch to Node.js distribution arch. Falls back to x64 — Windows
// ia32 is not produced for v22+ and Node.js does not publish 32-bit Windows
// binaries anymore.
function nodeDistArch(): string {
  if (process.arch === "arm64") return "arm64"
  return "x64"
}

// Extract a tarball with tar, passing args as an ARRAY (never a shell string).
// A shell string like `tar -xzf "${path}"` is interpreted by cmd.exe using the
// OEM code page (936/GBK on zh-CN Windows), which corrupts any non-ASCII path
// segment (e.g. a Chinese Windows username: C:\Users\王思璠\.openagents\…) and
// makes tar fail to find/create the directory. execFileSync bypasses the shell
// entirely, so the path is handed to the process verbatim as Unicode.
export function extractTarball(
  archivePath: string,
  destDir: string,
  opts: { xz?: boolean; timeout?: number } = {},
): void {
  execFileSync(
    "tar",
    [
      opts.xz ? "-xJf" : "-xzf",
      archivePath,
      "-C",
      destDir,
      "--strip-components=1",
    ],
    { timeout: opts.timeout ?? 60000, stdio: "pipe", windowsHide: true },
  )
}

export async function downloadNodejs(
  nodejsDir: string,
  onProgress: (pct: number, detail: string) => void,
): Promise<void> {
  const nodeVersion = "v22.22.3"
  const arch = nodeDistArch()

  try {
    fs.rmSync(nodejsDir, { recursive: true, force: true })
  } catch {}
  fs.mkdirSync(nodejsDir, { recursive: true })
  slog(
    `downloadNodejs: platform=${process.platform} arch=${arch} dir=${nodejsDir}`,
  )

  if (process.platform === "win32") {
    const nodeRelative = `win-${arch}/node.exe`
    const nodeExeDest = path.join(nodejsDir, "node.exe")
    const expectedSha = await fetchNodeShasum(nodeVersion, nodeRelative)
    if (!expectedSha)
      slog(`SHASUMS256.txt unavailable — proceeding without hash verification`)
    await downloadToFile(
      nodeDistUrls(`${nodeVersion}/${nodeRelative}`),
      nodeExeDest,
      { expectedSha, onProgress, log: slog },
    )
    if (!canExecuteNodeBinary(nodeExeDest)) {
      try {
        fs.unlinkSync(nodeExeDest)
      } catch {}
      throw new Error(
        "Bundled node.exe failed smoke test (--version did not exit cleanly). The download may be corrupt or blocked by security software.",
      )
    }

    const npmVersion = "10.9.8"
    const npmTgz = path.join(os.tmpdir(), `npm-${npmVersion}.tgz`)
    const npmModDir = path.join(nodejsDir, "node_modules", "npm")
    if (onProgress) onProgress(85, "Installing npm...")
    await downloadToFile(npmUrls(`npm/-/npm-${npmVersion}.tgz`), npmTgz, {
      log: slog,
    })

    fs.mkdirSync(npmModDir, { recursive: true })
    // Let a failure here propagate: if npm can't be unpacked the app is unusable
    // (blank window), so surface it on the splash instead of silently continuing.
    extractTarball(npmTgz, npmModDir)
    try {
      fs.unlinkSync(npmTgz)
    } catch {}

    const npmCliPath = path.join(npmModDir, "bin", "npm-cli.js")
    if (fs.existsSync(npmCliPath)) {
      // Reference node.exe / the cli via %~dp0 (this .cmd file's own dir),
      // NOT an absolute path. cmd.exe reads a .cmd FILE from disk using the OEM
      // code page (936/GBK on zh-CN), so an embedded "C:\Users\中文名\…" path
      // would be corrupted; %~dp0 is resolved from the filesystem at runtime as
      // Unicode and stays correct under a non-ASCII home dir.
      fs.writeFileSync(
        path.join(nodejsDir, "npm.cmd"),
        `@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npm-cli.js" %*\r\n`,
      )
      fs.writeFileSync(
        path.join(nodejsDir, "npx.cmd"),
        `@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npx-cli.js" %*\r\n`,
      )
    }
  } else {
    const platName = process.platform === "darwin" ? "darwin" : "linux"
    const ext = process.platform === "darwin" ? "tar.gz" : "tar.xz"
    const nodeRelative = `node-${nodeVersion}-${platName}-${arch}.${ext}`
    const tarPath = path.join(os.tmpdir(), `node-${nodeVersion}.${ext}`)
    // Verified on every platform now — macOS/Linux used to extract whatever
    // arrived, so a truncated or mirror-corrupted tarball surfaced later as an
    // unexplained "node failed to start" instead of a clean re-download.
    const expectedSha = await fetchNodeShasum(nodeVersion, nodeRelative)
    if (!expectedSha)
      slog(`SHASUMS256.txt unavailable — proceeding without hash verification`)

    await downloadToFile(
      nodeDistUrls(`${nodeVersion}/${nodeRelative}`),
      tarPath,
      { expectedSha, onProgress, log: slog },
    )
    if (onProgress) onProgress(90, "Extracting...")
    extractTarball(tarPath, nodejsDir, {
      xz: ext !== "tar.gz",
      timeout: 120000,
    })
    try {
      fs.unlinkSync(tarPath)
    } catch {}

    const binDir = path.join(nodejsDir, "bin")
    for (const name of ["node", "npm", "npx"]) {
      const src = path.join(binDir, name)
      const dest = path.join(nodejsDir, name)
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.symlinkSync(src, dest)
        } catch {}
      }
    }
  }
  if (onProgress) onProgress(100, "Done")
}

/**
 * How to run npm, as an executable plus leading arguments — never as a shell
 * string. `execSync("\"C:\\Users\\王思瑶\\.openagents\\nodejs\\node.exe\" …")`
 * goes through cmd.exe, which re-encodes the command line in the OEM code page
 * (936 on a zh-CN Windows) and corrupts every non-ASCII path segment, so npm
 * either can't be found or installs into a mangled directory. execFile* hands
 * argv to CreateProcessW verbatim, so the same path survives as Unicode.
 */
export function findNpmCommand(): { bin: string; preArgs: string[] } | null {
  const nodeUnified = path.join(
    PORTABLE_NODE_DIR,
    process.platform === "win32" ? "node.exe" : "node",
  )
  const nodeBin = fs.existsSync(nodeUnified)
    ? nodeUnified
    : path.join(PORTABLE_NODE_DIR, "bin", "node")
  if (!fs.existsSync(nodeBin)) return null
  const candidates = [
    path.join(PORTABLE_NODE_DIR, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(
      PORTABLE_NODE_DIR,
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ]
  const npmCli = candidates.find((p) => fs.existsSync(p))
  if (npmCli) return { bin: nodeBin, preArgs: [npmCli] }
  if (process.platform !== "win32") {
    const npmBin = path.join(PORTABLE_NODE_DIR, "bin", "npm")
    if (fs.existsSync(npmBin)) return { bin: npmBin, preArgs: [] }
  }
  return null
}

export function addToPrefixPackageJson(pkg: string, version: string): void {
  const pkgJsonPath = path.join(PORTABLE_NODE_DIR, "package.json")
  let data: { dependencies?: Record<string, string> } = {}
  try {
    data = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"))
  } catch {}
  if (!data.dependencies) data.dependencies = {}
  data.dependencies[pkg] = version
  try {
    fs.writeFileSync(pkgJsonPath, JSON.stringify(data, null, 2) + "\n", "utf-8")
  } catch {}
}
