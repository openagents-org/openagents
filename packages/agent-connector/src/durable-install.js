'use strict';

/**
 * Keep the launcher somewhere that lasts. `npx @openagents-org/agent-launcher
 * join <code>` runs this package out of npx's cache, which npm may clear at
 * any time; a daemon or a login service pointing there would stop working
 * when it does. So `join` first puts the package where install.sh puts it,
 * ~/.openagents/nodejs/node_modules, with the same `agn` shims, and runs
 * everything long-lived from there.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG = '@openagents-org/agent-launcher';

function runningFromNpxCache(dir) {
  return /[\\/]_npx[\\/]/.test(dir);
}

function readVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).version || null; } catch { return null; }
}

/** -1, 0 or 1, comparing dotted numeric versions (pre-release tags ignored). */
function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * Make sure a lasting copy of this package exists and return where it is.
 *
 * @param {object} [opts]
 * @param {string} [opts.pkgRoot] - this package's directory
 * @param {string} [opts.home]
 * @param {string} [opts.nodeBin] - node for the shims when there is no portable one
 * @returns {{ cliPath: string, nodeBin: string, copied: boolean, version: string|null }}
 */
function ensureDurableInstall(opts = {}) {
  const pkgRoot = opts.pkgRoot || path.resolve(__dirname, '..');
  const home = opts.home || os.homedir();
  const prefix = path.join(home, '.openagents', 'nodejs');
  const portableNode = path.join(prefix, 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
  const nodeBin = fs.existsSync(portableNode) ? portableNode : (opts.nodeBin || process.execPath);

  if (!runningFromNpxCache(pkgRoot)) {
    return { cliPath: path.join(pkgRoot, 'bin', 'agent-connector.js'), nodeBin, copied: false, version: readVersion(pkgRoot) };
  }

  const modules = path.join(prefix, 'node_modules');
  const target = path.join(modules, ...PKG.split('/'));
  const own = readVersion(pkgRoot);
  const installed = readVersion(target);
  let copied = false;
  if (!installed || (own && compareVersions(installed, own) < 0)) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(pkgRoot, target, { recursive: true, dereference: true });
    copied = true;
  }

  // Runtime dependencies sit next to the package in npx's node_modules.
  const npxModules = path.resolve(pkgRoot, '..', '..');
  let deps = {};
  try { deps = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8')).dependencies || {}; } catch {}
  for (const dep of Object.keys(deps)) {
    const from = path.join(npxModules, ...dep.split('/'));
    const to = path.join(modules, ...dep.split('/'));
    if (fs.existsSync(path.join(to, 'package.json')) || !fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, dereference: true });
  }

  // install.sh keeps a package.json at the prefix so a later `npm --prefix`
  // install there does not prune what is not listed in it.
  const prefixPkg = path.join(prefix, 'package.json');
  let manifest = { private: true, dependencies: {} };
  try { manifest = JSON.parse(fs.readFileSync(prefixPkg, 'utf-8')); } catch {}
  manifest.dependencies = { ...(manifest.dependencies || {}) };
  manifest.dependencies[PKG] = readVersion(target) || own || 'latest';
  for (const dep of Object.keys(deps)) {
    if (!manifest.dependencies[dep]) manifest.dependencies[dep] = readVersion(path.join(modules, ...dep.split('/'))) || deps[dep];
  }
  fs.writeFileSync(prefixPkg, JSON.stringify(manifest));

  writeShims(modules, nodeBin);
  return { cliPath: path.join(target, 'bin', 'agent-connector.js'), nodeBin, copied, version: readVersion(target) };
}

/** `agn`, `openagents` and `agent-connector` in node_modules/.bin, as install.sh writes them. */
function writeShims(modules, nodeBin) {
  const binDir = path.join(modules, '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const entry = path.join(modules, ...PKG.split('/'), 'bin', 'agent-connector.js');
  for (const name of ['agn', 'openagents', 'agent-connector']) {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(binDir, `${name}.cmd`), `@echo off\r\n"${nodeBin}" "${entry}" %*\r\n`);
    } else {
      const file = path.join(binDir, name);
      // rm first: a symlink into the package's bin would be followed by the
      // write and overwrite the real entry point (see install.sh).
      fs.rmSync(file, { force: true });
      fs.writeFileSync(file, `#!/bin/sh\nexec "${nodeBin}" "${entry}" "$@"\n`, { mode: 0o755 });
    }
  }
  return binDir;
}

module.exports = { ensureDurableInstall, runningFromNpxCache, compareVersions, writeShims };
