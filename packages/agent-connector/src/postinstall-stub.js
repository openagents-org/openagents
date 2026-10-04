'use strict';

/**
 * The placeholder an npm package ships where its native binary goes.
 *
 * opencode-ai and @anthropic-ai/claude-code are both published this way: the
 * package's `bin` (bin/opencode.exe, bin/claude.exe) is a few hundred bytes of
 * shell that prints "postinstall … not run" and exits 1, and the package's
 * postinstall script swaps in the real binary from a per-platform optional
 * dependency. Skip that script — `ignore-scripts=true` in an npmrc,
 * `--ignore-scripts`, pnpm and bun by default — and the install still exits 0
 * with the placeholder sitting where the CLI should be. It resolves on PATH
 * and it has the right name, so nothing about it looks like a missing install:
 * the launcher reports the agent installed, and every run fails on whatever
 * check happens to come next.
 */

const fs = require('fs');
const path = require('path');

// A native CLI is tens of megabytes; the placeholders are about 500 bytes.
const STUB_MAX_BYTES = 4096;
const STUB_SIGNATURE = /postinstall (script )?(was|did) not run|native binary not installed/i;

/** Whether text a CLI printed is its package's placeholder talking. */
function isPostinstallStubOutput(text) {
  return STUB_SIGNATURE.test(String(text || ''));
}

function isStubFile(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > STUB_MAX_BYTES) return false;
    return STUB_SIGNATURE.test(fs.readFileSync(file, 'utf-8'));
  } catch {
    return false;
  }
}

/**
 * The files an npm `.cmd` shim launches. The shim is a wrapper npm wrote
 * beside the package, never the placeholder itself — the placeholder is what
 * it points at (`"%dp0%\node_modules\opencode-ai\bin\opencode.exe" %*`).
 */
function cmdShimTargets(file) {
  if (!/\.cmd$/i.test(file)) return [];
  try {
    if (fs.statSync(file).size > STUB_MAX_BYTES) return [];
    const dir = path.dirname(file);
    const text = fs.readFileSync(file, 'utf-8');
    return [...text.matchAll(/"%(?:~dp0|dp0%)\\?([^"\r\n]+)"/g)]
      .map((m) => path.join(dir, ...m[1].split(/[\\/]+/)));
  } catch {
    return [];
  }
}

/**
 * Whether `file` is such a placeholder — directly, through the symlink npm
 * puts in `.bin`, or through a Windows `.cmd` shim. Read off disk rather than
 * by running it: on Windows the placeholder is shell text named `.exe`, and
 * starting it raises a "this app can't run on your PC" dialog.
 */
function isPostinstallStub(file) {
  if (!file) return false;
  return [file, ...cmdShimTargets(file)].some(isStubFile);
}

module.exports = { isPostinstallStub, isPostinstallStubOutput };
