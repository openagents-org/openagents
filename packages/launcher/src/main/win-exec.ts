import fs from "fs"

/**
 * How to actually launch a CLI path the core resolved for us.
 *
 * Everything here exists because `installer.which()` does NOT hand back
 * something Windows can execute. It hands back whatever `where` printed first,
 * or — when PATH misses entirely — the package's own bin file. Three shapes
 * reach us, and only one of them is directly spawnable:
 *
 *   C:\nvm4w\nodejs\claude          extensionless Git-Bash script; npm writes it
 *                                   alongside claude.cmd and claude.ps1, and
 *                                   `where claude` lists it FIRST. CreateProcess
 *                                   refuses it.
 *   …\@openai\codex\bin\codex.js    the package's declared bin, returned by the
 *                                   core's _resolvePackageBin fallback when no
 *                                   .bin shim is on PATH. cmd.exe hands a .js to
 *                                   Windows Script Host, which is not node.
 *   C:\bin\amp.cmd                  spawnable, but only through a shell (Node
 *                                   refuses .cmd directly since CVE-2024-27980).
 *
 * So: keep `.exe` as-is, prefer a real Windows shim sitting next to whatever we
 * were given, and run a bare .js through `node` rather than letting the shell
 * guess. Paths are quoted — with shell:true Node hands the string to cmd.exe
 * verbatim and plenty of people are `C:\Users\First Last\`.
 *
 * Shared by every launcher-side spawn of an agent CLI (the in-app login, the
 * sign-in probe, the login terminal) so they can't disagree about what "the
 * binary" means — they used to, and the probe's disagreement read as "not
 * signed in" for every npm-installed agent on Windows.
 */
export function windowsExecutable(
  bin: string,
  // Injected so the Windows branches are testable from any machine — the bugs
  // this function exists for could only ever be reproduced on Windows, so a
  // test that can only run there is a test that never runs.
  platform: string = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): { command: string; shell: boolean } {
  if (platform !== "win32") return { command: bin, shell: false }
  if (/\.exe$/i.test(bin)) return { command: bin, shell: false }
  if (/\.(cmd|bat)$/i.test(bin)) return { command: `"${bin}"`, shell: true }
  // A script's Windows shim is named for the COMMAND, not the file: the sibling
  // of `…\bin\codex.js` is `codex.cmd`, never `codex.js.cmd`. For the
  // extensionless case the stem is the path itself, so this is a no-op there.
  const stem = bin.replace(/\.(js|cjs|mjs)$/i, "")
  for (const ext of [".cmd", ".bat", ".exe"]) {
    try {
      if (exists(stem + ext))
        return {
          command: ext === ".exe" ? stem + ext : `"${stem + ext}"`,
          shell: ext !== ".exe",
        }
    } catch {
      /* unreadable path — fall through */
    }
  }
  // No shim: a JS bin is node's job. `node` rather than an absolute path
  // because every caller spawns with the core's enhanced PATH (which carries
  // the portable ~/.openagents/nodejs), and the login terminal injects the same
  // dirs — while process.execPath here is Electron, not node.
  if (/\.(js|cjs|mjs)$/i.test(bin))
    return { command: `node "${bin}"`, shell: true }
  // Let the shell figure it out rather than handing CreateProcess something it
  // will certainly reject.
  return { command: `"${bin}"`, shell: true }
}

/**
 * The same resolution, as a string to drop into a shell command line (the login
 * terminal) rather than a spawn's argv[0].
 *
 * `windowsExecutable` leaves a directly-spawnable path UNQUOTED — a `.exe`, and
 * every non-Windows path — because spawn passes argv[0] through untouched. On a
 * command line that same path breaks at the first space, and `C:\Program
 * Files\…` / `/Users/First Last/…` are not hypothetical.
 */
export function shellCommandFor(
  bin: string,
  platform: string = process.platform,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const { command } = windowsExecutable(bin, platform, exists)
  return command === bin ? `"${bin}"` : command
}
