'use strict';

/**
 * The per-platform npm package that holds an agent CLI's native build.
 *
 * @openai/codex, @anthropic-ai/claude-code and opencode-ai are thin npm
 * wrappers: the executable itself is in one optional dependency per platform
 * (`@openai/codex-win32-x64`, `@anthropic-ai/claude-code-darwin-arm64`, …).
 * npm leaves an optional dependency out WITHOUT failing the install — when its
 * download fails (it is the big one, tens of megabytes) or when optional
 * dependencies are turned off (`omit=optional` in an npmrc). The wrapper is
 * then all there is: codex throws "Missing optional dependency
 * @openai/codex-win32-x64" on every run, and the claude-code / opencode-ai
 * postinstall finds nothing to copy and leaves the package's placeholder,
 * which read as "postinstall did not run".
 *
 * Only the packages listed here are checked. Many CLIs also list optional
 * platform packages they can run without (node-pty, sharp, esbuild, bun), and
 * a missing one of those must not fail an install.
 */

const fs = require('fs');
const path = require('path');

/**
 * Package names each wrapper accepts for this platform, in the order its own
 * loader tries them; the first is the one to install when none is present.
 * Mirrors bin/codex.js, claude-code's install.cjs and opencode-ai's
 * postinstall.mjs.
 */
const NATIVE_BUILDS = {
  // codex.js maps every Linux target to a musl build published under the
  // plain linux-<arch> name.
  '@openai/codex': ({ os, cpu }) => [`@openai/codex-${os}-${cpu}`],
  '@anthropic-ai/claude-code': ({ os, cpu, musl }) => [
    `@anthropic-ai/claude-code-${os}-${cpu}${os === 'linux' && musl ? '-musl' : ''}`,
  ],
  // opencode-ai takes any of its variants (baseline = no AVX2) and calls
  // win32 "windows".
  'opencode-ai': ({ os, cpu, musl }) => {
    const base = `opencode-${os === 'win32' ? 'windows' : os}-${cpu}`;
    if (os === 'linux') {
      return musl
        ? [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
        : [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`];
    }
    return [base, `${base}-baseline`];
  },
};

/**
 * Wrappers whose postinstall copies the native build over their own bin
 * placeholder. Once it has, the CLI runs without the per-platform package:
 * opencode-ai's postinstall, finding that npm left it out, installs it into a
 * temp directory, copies the binary from there and deletes the directory. A
 * missing package next to a real binary is a working install. codex is not
 * listed: bin/codex.js resolves the package on every run.
 */
const COPIED_INTO_BIN = new Set(['@anthropic-ai/claude-code', 'opencode-ai']);

/** musl libc, detected the way claude-code's install.cjs does it. */
function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    const report = process.report && typeof process.report.getReport === 'function'
      ? process.report.getReport()
      : null;
    return report != null && report.header && report.header.glibcVersionRuntime === undefined;
  } catch {
    return false;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

/**
 * Where `name` would be found by a require() made from inside `pkgDir`: its own
 * node_modules first, then each parent's — nested or hoisted, as npm put it.
 */
function findInstalled(pkgDir, name) {
  let dir = path.resolve(pkgDir);
  for (;;) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', ...name.split('/'));
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The native build an installed wrapper package needs on this machine.
 *
 * @param {string} pkgDir  the wrapper's directory (…/node_modules/@openai/codex)
 * @returns {{ pkgName: string, version: string, name: string, spec: string,
 *   accepted: string[], installed: string|null, target: string,
 *   copiedIntoBin: boolean } | null}
 *   null when the package is not one of NATIVE_BUILDS, or lists no build for
 *   this platform (nothing to check). `name`/`spec` are what to install —
 *   spec as the wrapper lists it, `npm:` aliases included. `copiedIntoBin`:
 *   see COPIED_INTO_BIN.
 */
function nativeBuildFor(pkgDir, { platform = process.platform, arch = process.arch, musl = isMusl() } = {}) {
  const pkg = readJson(path.join(pkgDir, 'package.json'));
  if (!pkg || !NATIVE_BUILDS[pkg.name]) return null;
  const optional = (pkg.optionalDependencies && typeof pkg.optionalDependencies === 'object')
    ? pkg.optionalDependencies
    : {};
  const accepted = NATIVE_BUILDS[pkg.name]({ os: platform, cpu: arch, musl }).filter((n) => optional[n]);
  if (!accepted.length) return null;
  let installed = null;
  for (const n of accepted) {
    installed = findInstalled(pkgDir, n);
    if (installed) break;
  }
  return {
    pkgName: pkg.name,
    version: pkg.version || '',
    name: accepted[0],
    spec: String(optional[accepted[0]]),
    accepted,
    installed,
    target: `${platform}-${arch}${platform === 'linux' && musl ? '-musl' : ''}`,
    copiedIntoBin: COPIED_INTO_BIN.has(pkg.name),
  };
}

module.exports = { nativeBuildFor, findInstalled, isMusl, NATIVE_BUILDS, COPIED_INTO_BIN };
