'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixSpawnHelpers, fixSpawnHelpersFor } = require('../src/node-pty-perms');

const skip = process.platform === 'win32' && 'no spawn-helper or mode bits on Windows';
const PLAT = `${process.platform}-${process.arch}`;

describe('node-pty spawn-helper permissions', { skip }, () => {
  let prefix;

  const helper = (pkgDir, mode = 0o644) => {
    const p = path.join(prefix, 'node_modules', pkgDir, 'prebuilds', PLAT, 'spawn-helper');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(path.join(prefix, 'node_modules', pkgDir, 'package.json'), '{}');
    fs.writeFileSync(p, '');
    fs.chmodSync(p, mode);
    return p;
  };
  const executable = (p) => (fs.statSync(p).mode & 0o111) === 0o111;

  // Real path: macOS's tmpdir is a /var -> /private/var symlink, and the
  // resolver reports paths it reached through realpath.
  beforeEach(() => { prefix = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pty-perms-'))); });
  afterEach(() => fs.rmSync(prefix, { recursive: true, force: true }));

  // node-pty 1.1.0 ships exactly this: prebuilds/<plat>/spawn-helper at 0644,
  // and pty.spawn() then fails with "posix_spawnp failed."
  it('makes a 0644 spawn-helper executable after an install', () => {
    const top = helper('node-pty');
    const nested = helper(path.join('@moonshot-ai', 'kimi-code', 'node_modules', 'node-pty'));
    const scoped = helper(`@lydell/node-pty-${PLAT}`);
    const fixed = fixSpawnHelpers(prefix);
    assert.deepEqual(fixed.sort(), [top, nested, scoped].sort());
    assert.ok([top, nested, scoped].every(executable));
  });

  it('leaves an already executable helper alone', () => {
    helper('node-pty', 0o755);
    assert.deepEqual(fixSpawnHelpers(prefix), []);
  });

  it('is a no-op on a prefix with no node_modules', () => {
    assert.deepEqual(fixSpawnHelpers(path.join(prefix, 'missing')), []);
  });

  it('fixes the node-pty a CLI resolves, starting from its .bin shim', () => {
    const p = helper('node-pty');
    const entry = path.join(prefix, 'node_modules', '@moonshot-ai', 'kimi-code', 'dist', 'main.mjs');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '');
    const bin = path.join(prefix, 'node_modules', '.bin', 'kimi');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(bin), entry), bin);

    assert.deepEqual(fixSpawnHelpersFor(bin), [p]);
    assert.ok(executable(p));
    assert.deepEqual(fixSpawnHelpersFor(bin), [], 'second pass has nothing to do');
  });
});
