/**
 * Restore the execute bit on node-pty's `spawn-helper`.
 *
 * node-pty 1.1.0 publishes its macOS/Linux prebuilds with
 * `prebuilds/<platform>/spawn-helper` at mode 0644, and npm does not fix it
 * (the package has no install script to). pty.spawn() execs that helper, so
 * every terminal the CLI opens dies with "posix_spawnp failed." — seen with
 * Kimi Code, whose optional `node-pty` dependency resolves to 1.1.0. Every
 * node-pty fork that ships a spawn-helper is treated the same, so the next CLI
 * that pulls one in is covered too.
 *
 * Nothing to do on Windows: there is no spawn-helper and no mode bits.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';

/** Nested node_modules deeper than this are not worth walking. */
const MAX_DEPTH = 6;

/** Packages whose spawn-helper this module restores. */
const PTY_PACKAGES = [
  'node-pty',
  // @lydell keeps its prebuilds in a per-platform package.
  `@lydell/node-pty-${process.platform}-${process.arch}`,
];

function readDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/**
 * chmod +x every spawn-helper inside one package directory.
 * @returns {string[]} the helpers that were fixed
 */
function fixPackage(pkgDir) {
  const helpers = [path.join(pkgDir, 'build', 'Release', 'spawn-helper')];
  const prebuilds = path.join(pkgDir, 'prebuilds');
  for (const plat of readDir(prebuilds)) {
    helpers.push(path.join(prebuilds, plat, 'spawn-helper'));
  }
  const fixed = [];
  for (const helper of helpers) {
    try {
      const { mode } = fs.statSync(helper);
      if ((mode & 0o111) === 0o111) continue;
      fs.chmodSync(helper, mode | 0o755);
      fixed.push(helper);
    } catch {}
  }
  return fixed;
}

/**
 * Walk an npm prefix's node_modules (nested ones included) and fix every
 * package that carries a spawn-helper. Run after an npm install.
 * @param {string} prefixDir - the `--prefix` the agent was installed into
 * @returns {string[]} the helpers that were fixed
 */
function fixSpawnHelpers(prefixDir) {
  if (IS_WINDOWS) return [];
  const fixed = [];
  const visit = (modulesDir, depth) => {
    if (depth > MAX_DEPTH) return;
    for (const entry of readDir(modulesDir)) {
      if (entry.startsWith('.')) continue;
      const dirs = entry.startsWith('@')
        ? readDir(path.join(modulesDir, entry)).map((s) => path.join(modulesDir, entry, s))
        : [path.join(modulesDir, entry)];
      for (const pkgDir of dirs) {
        fixed.push(...fixPackage(pkgDir));
        visit(path.join(pkgDir, 'node_modules'), depth + 1);
      }
    }
  };
  visit(path.join(prefixDir, 'node_modules'), 0);
  return fixed;
}

/**
 * Fix the node-pty a CLI would load, resolved the way Node resolves it from
 * the CLI's own location — for an install that predates fixSpawnHelpers, or
 * one the user made themselves.
 * @param {string} fromPath - the CLI binary or entry script
 * @returns {string[]} the helpers that were fixed
 */
function fixSpawnHelpersFor(fromPath) {
  if (IS_WINDOWS || !fromPath) return [];
  let start;
  try { start = path.dirname(fs.realpathSync(fromPath)); } catch { return []; }
  // Node's lookup by hand: the nearest node_modules/<name> going up. Not
  // require.resolve — a package with an `exports` map refuses package.json.
  const fixed = [];
  for (const name of PTY_PACKAGES) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      const pkgDir = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
        fixed.push(...fixPackage(pkgDir));
        break;
      }
      if (path.dirname(dir) === dir) break;
    }
  }
  return fixed;
}

module.exports = { fixSpawnHelpers, fixSpawnHelpersFor };
