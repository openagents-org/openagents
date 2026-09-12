'use strict';

/**
 * Turn a registry login command ("codex login", "claude auth login", bare
 * "gemini") into something `child_process.spawn` can actually run.
 *
 * The TUI used to hand the whole string to blessed's `screen.exec`, which calls
 * `spawn(file, args)` WITHOUT a shell — so it looked for an executable literally
 * named "codex login", got ENOENT, and (because the callback was swallowed by
 * an args/options mix-up) restored the screen without a word. Windows made it
 * worse: even a correctly split command dies there, because an npm-installed
 * CLI is a `codex.cmd` shim Node refuses to spawn directly (CVE-2024-27980),
 * the bare `codex` name may not be on the GUI-inherited PATH at all, and the
 * package's own bin (`…\@openai\codex\bin\codex.js`) needs `node` in front.
 *
 * Mirrors the launcher's `windowsExecutable` so both front-ends agree on what
 * "the binary" means. Pure — platform and existence check are injectable so the
 * Windows branches are testable from any machine.
 *
 * @param {string} loginCommand   e.g. "codex login"
 * @param {string|null} binary    absolute path from `installer.which()`, or null
 * @param {string} [platform]
 * @param {(p: string) => boolean} [exists]
 * @returns {{ file: string, args: string[], shell: boolean }}
 */
function loginSpawnSpec(loginCommand, binary, platform = process.platform, exists = defaultExists) {
  const tokens = String(loginCommand || '').trim().split(/\s+/).filter(Boolean);
  const args = tokens.slice(1);
  const bare = tokens[0] || '';

  // Nothing resolved: let the shell try the bare name against the enhanced
  // PATH — that is the best anyone can do, and the error (if any) is at least
  // the shell's own "not recognized" rather than a silent ENOENT.
  if (!binary) {
    return { file: tokens.join(' '), args: [], shell: true };
  }

  if (platform !== 'win32') {
    return { file: binary, args, shell: false };
  }

  if (/\.exe$/i.test(binary)) return { file: binary, args, shell: false };
  if (/\.(cmd|bat)$/i.test(binary)) return shellLine(binary, args);

  // A script's Windows shim is named for the COMMAND, not the file: next to
  // `…\bin\codex.js` sits `codex.cmd`, never `codex.js.cmd`. For an
  // extensionless Git-Bash script (what `where codex` lists first) the stem is
  // the path itself.
  const stem = binary.replace(/\.(js|cjs|mjs)$/i, '');
  for (const ext of ['.cmd', '.bat', '.exe']) {
    let hit = false;
    try { hit = exists(stem + ext); } catch {}
    if (!hit) continue;
    return ext === '.exe'
      ? { file: stem + ext, args, shell: false }
      : shellLine(stem + ext, args);
  }

  // No shim: a JS bin is node's job. Bare `node` rather than an absolute path
  // because the caller spawns with the enhanced PATH (which carries the
  // portable ~/.openagents/nodejs).
  if (/\.(js|cjs|mjs)$/i.test(binary)) {
    return { file: `node "${binary}"${args.length ? ' ' + args.join(' ') : ''}`, args: [], shell: true };
  }

  // Extensionless and no sibling shim: let cmd.exe consult PATHEXT.
  return { file: bare ? [bare, ...args].join(' ') : `"${binary}"`, args: [], shell: true };
}

/**
 * One quoted command line for cmd.exe. With `shell: true` Node passes the
 * string through verbatim, and `C:\Users\First Last\…` is not hypothetical.
 */
function shellLine(binary, args) {
  return { file: `"${binary}"${args.length ? ' ' + args.join(' ') : ''}`, args: [], shell: true };
}

function defaultExists(p) {
  try { return require('fs').existsSync(p); } catch { return false; }
}

module.exports = { loginSpawnSpec };
