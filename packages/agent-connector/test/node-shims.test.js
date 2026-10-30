'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { detectShadowedNodeShims, shadowedNodeWarning } = require('../src/node-shims');

// An absolute root the current platform actually recognises, so path.resolve
// inside the detector returns what these expectations compare against. POSIX
// literals looked fine on macOS/Linux and broke on the Windows runner, where
// path.resolve('/home/u', …) acquires a drive letter.
const ROOT = process.platform === 'win32' ? 'C:\\t' : '/t';
const HOME = path.join(ROOT, 'home', 'u');
const LINK_DIR = path.join(HOME, '.local', 'bin');
const OWNER_DIR = path.join(HOME, '.hermes', 'node', 'bin');
const NVM_BIN = path.join(HOME, '.nvm', 'versions', 'node', 'v22.16.0', 'bin');
const NVM_NODE = path.join(NVM_BIN, 'node');
const USR_BIN = path.join(ROOT, 'usr', 'bin');
const LOCAL_BIN = path.join(ROOT, 'usr', 'local', 'bin');

/** A machine where the installer has taken over all three shims. */
function hijackedLinks(p) {
  const name = path.basename(p);
  if (path.dirname(p) !== LINK_DIR) return null;
  if (!['node', 'npm', 'npx'].includes(name)) return null;
  return path.join(OWNER_DIR, name);
}

const base = { home: HOME, linkDir: LINK_DIR, ownerDir: OWNER_DIR };

test('reports the takeover when another node is shadowed', () => {
  const result = detectShadowedNodeShims({
    ...base,
    readLink: hijackedLinks,
    pathEntries: [LINK_DIR, NVM_BIN, USR_BIN],
    exists: (p) => p === NVM_NODE,
  });

  assert.strictEqual(result.shims.length, 3);
  assert.deepStrictEqual(
    result.shims.map((s) => s.name),
    ['node', 'npm', 'npx'],
  );
  assert.strictEqual(result.shadowed, NVM_NODE);
});

test('stays quiet when the machine had no other node', () => {
  // Here the installer's Node is the only one — the symlinks are a favour, not
  // a hijack, and warning about them would be noise.
  const result = detectShadowedNodeShims({
    ...base,
    readLink: hijackedLinks,
    pathEntries: [LINK_DIR, USR_BIN],
    exists: () => false,
  });

  assert.strictEqual(result.shims.length, 3);
  assert.strictEqual(result.shadowed, null);
  assert.strictEqual(shadowedNodeWarning('Hermes Agent', result), null);
});

test('ignores a node that comes BEFORE the link dir on PATH', () => {
  // Something earlier on PATH already wins; the symlinks shadow nothing.
  const result = detectShadowedNodeShims({
    ...base,
    readLink: hijackedLinks,
    pathEntries: [LOCAL_BIN, LINK_DIR],
    exists: (p) => p === path.join(LOCAL_BIN, 'node'),
  });

  assert.strictEqual(result.shadowed, null);
});

test('ignores symlinks pointing somewhere other than the agent', () => {
  const result = detectShadowedNodeShims({
    ...base,
    readLink: (p) => (path.basename(p) === 'node' ? NVM_NODE : null),
    pathEntries: [LINK_DIR, USR_BIN],
    exists: () => true,
  });

  assert.deepStrictEqual(result, { shims: [], shadowed: null });
});

test('ignores real files that are not symlinks', () => {
  const result = detectShadowedNodeShims({
    ...base,
    readLink: () => null, // lstat says "not a symlink"
    pathEntries: [LINK_DIR, USR_BIN],
    exists: () => true,
  });

  assert.deepStrictEqual(result, { shims: [], shadowed: null });
});

test('the warning names the agent, what it shadowed, and how to undo it', () => {
  const detection = detectShadowedNodeShims({
    ...base,
    readLink: hijackedLinks,
    pathEntries: [LINK_DIR, NVM_BIN],
    exists: (p) => p === NVM_NODE,
  });
  const warning = shadowedNodeWarning('Hermes Agent', detection);

  assert.match(warning, /Hermes Agent/);
  assert.ok(warning.includes(NVM_NODE), 'names the Node it shadowed');
  for (const name of ['node', 'npm', 'npx']) {
    assert.ok(warning.includes(path.join(LINK_DIR, name)), `names the ${name} link`);
  }
  assert.match(warning, /rm -f /);
});

test('no shims, no warning', () => {
  assert.strictEqual(shadowedNodeWarning('X', { shims: [], shadowed: null }), null);
  assert.strictEqual(shadowedNodeWarning('X', null), null);
});
