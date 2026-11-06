'use strict';

// The desktop app installs this package by downloading its npm tarball and
// extracting it into ~/.openagents/nodejs/node_modules/@openagents-org/
// agent-launcher. Nothing runs `npm install` there, so a dependency that is not
// INSIDE the tarball does not exist for the daemon. That is how every OpenWorker
// turn failed with "Could not open the OpenWorker session: Cannot find module
// 'ws'" (daily report 2026-11-06, Windows, core 0.2.217): `ws` was a plain
// dependency, and the copy the app ships beside its own bundled core is out of
// reach of the downloaded one.
//
// So whatever the daemon requires must be listed in bundleDependencies, and
// the packed tarball must really carry it. npm packs a bundled dependency only
// from an installed node_modules, and leaves it out without a word when there
// is none, which is why the publish job runs `npm ci` and then this file.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { builtinModules } = require('module');

const PKG_DIR = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf-8'));

// `agn tui` is a terminal command, run from an npm install that has its
// dependencies; the daemon never loads it.
const NOT_LOADED_BY_THE_DAEMON = new Set(['src/tui.js']);

/** Third-party packages required anywhere under src/, by the file that requires them. */
function requiredPackages() {
  const found = new Map();
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) { walk(file); continue; }
      if (!file.endsWith('.js')) continue;
      const rel = path.relative(PKG_DIR, file).split(path.sep).join('/');
      if (NOT_LOADED_BY_THE_DAEMON.has(rel)) continue;
      const source = fs.readFileSync(file, 'utf-8');
      for (const m of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const id = m[1];
        if (id.startsWith('.') || id.startsWith('node:')) continue;
        const parts = id.split('/');
        const name = id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        if (builtinModules.includes(name)) continue;
        if (!found.has(name)) found.set(name, rel);
      }
    }
  })(path.join(PKG_DIR, 'src'));
  return found;
}

describe('package bundling (the tarball the desktop app extracts)', () => {
  it('bundles every package the daemon can require', () => {
    const bundled = new Set(pkg.bundleDependencies || []);
    const required = requiredPackages();
    assert.ok(required.has('ws'), 'expected the OpenWorker adapter to require ws');
    for (const [name, file] of required) {
      assert.ok(pkg.dependencies && pkg.dependencies[name], `${file} requires ${name}, which is not in dependencies`);
      assert.ok(bundled.has(name), `${file} requires ${name}, which is not in bundleDependencies — a downloaded core would not have it`);
    }
  });

  it('the packed tarball carries ws', () => {
    const out = execSync('npm pack --dry-run --json', {
      cwd: PKG_DIR,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const files = new Set(JSON.parse(out)[0].files.map((f) => f.path));
    for (const name of pkg.bundleDependencies || []) {
      assert.ok(
        files.has(`node_modules/${name}/package.json`),
        `node_modules/${name} is missing from the package — run \`npm ci\` before packing`,
      );
    }
    assert.ok(files.has('node_modules/ws/index.js'));
    assert.ok(files.has('node_modules/ws/lib/websocket.js'));
  });
});
