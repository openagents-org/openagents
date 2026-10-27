'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const check = require('./check-connector-bundle.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const bundled = path.join(root, 'bundle');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@openagents-org/agent-launcher', version: '0.2.208', files: ['src/'], main: 'src/index.js' }));
  fs.writeFileSync(path.join(source, 'src/index.js'), 'module.exports = "current";');
  fs.cpSync(source, bundled, { recursive: true });
  return { root, source, bundled };
}

test('accepts the current copied package', (t) => {
  const { source, bundled } = fixture(t);
  check.verifyConnector(source, bundled);
});
test('rejects an old connector version', (t) => {
  const { source, bundled } = fixture(t);
  const p = path.join(bundled, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(p)); pkg.version = '0.2.194'; fs.writeFileSync(p, JSON.stringify(pkg));
  assert.throws(() => check.verifyConnector(source, bundled), /Stale connector/);
});
test('rejects stale code even with the same version', (t) => {
  const { source, bundled } = fixture(t);
  fs.writeFileSync(path.join(bundled, 'src/index.js'), 'module.exports = "old credential reader";');
  assert.throws(() => check.verifyConnector(source, bundled), /content differs/);
});
test('rejects incomplete and unexpected connector files', (t) => {
  const { source, bundled } = fixture(t);
  fs.unlinkSync(path.join(bundled, 'src/index.js'));
  assert.throws(() => check.verifyConnector(source, bundled), /file list differs/);
  fs.cpSync(source, bundled, { recursive: true });
  fs.writeFileSync(path.join(bundled, 'src/obsolete.js'), 'old code');
  assert.throws(() => check.verifyConnector(source, bundled), /file list differs/);
});
test('rejects a workspace symlink instead of a packaged copy', { skip: process.platform === 'win32' }, (t) => {
  const { root, source } = fixture(t);
  const linked = path.join(root, 'linked'); fs.symlinkSync(source, linked, 'dir');
  assert.throws(() => check.verifyConnector(source, linked), /not a symlink/);
});
test('packaged hook fails closed when the connector is absent', () => {
  assert.throws(() => check.checkPackaged({ appOutDir: '/does-not-exist', electronPlatformName: 'linux' }), /missing/);
});
