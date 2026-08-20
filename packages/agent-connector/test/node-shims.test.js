'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { detectShadowedNodeShims, shadowedNodeWarning } = require('../src/node-shims');

const HOME = '/home/u';
const LINK_DIR = '/home/u/.local/bin';
const OWNER_DIR = '/home/u/.hermes/node/bin';

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
    pathEntries: [LINK_DIR, '/home/u/.nvm/versions/node/v22.16.0/bin', '/usr/bin'],
    exists: (p) => p === '/home/u/.nvm/versions/node/v22.16.0/bin/node',
  });

  assert.strictEqual(result.shims.length, 3);
  assert.deepStrictEqual(
    result.shims.map((s) => s.name),
    ['node', 'npm', 'npx'],
  );
  assert.strictEqual(result.shadowed, '/home/u/.nvm/versions/node/v22.16.0/bin/node');
});

test('stays quiet when the machine had no other node', () => {
  // Here the installer's Node is the only one — the symlinks are a favour, not
  // a hijack, and warning about them would be noise.
  const result = detectShadowedNodeShims({
    ...base,
    readLink: hijackedLinks,
    pathEntries: [LINK_DIR, '/usr/bin'],
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
    pathEntries: ['/usr/local/bin', LINK_DIR],
    exists: (p) => p === '/usr/local/bin/node',
  });

  assert.strictEqual(result.shadowed, null);
});

test('ignores symlinks pointing somewhere other than the agent', () => {
  const result = detectShadowedNodeShims({
    ...base,
    readLink: (p) =>
      path.basename(p) === 'node' ? '/home/u/.nvm/versions/node/v22.16.0/bin/node' : null,
    pathEntries: [LINK_DIR, '/usr/bin'],
    exists: () => true,
  });

  assert.deepStrictEqual(result, { shims: [], shadowed: null });
});

test('ignores real files that are not symlinks', () => {
  const result = detectShadowedNodeShims({
    ...base,
    readLink: () => null, // lstat says "not a symlink"
    pathEntries: [LINK_DIR, '/usr/bin'],
    exists: () => true,
  });

  assert.deepStrictEqual(result, { shims: [], shadowed: null });
});

test('the warning names the agent, what it shadowed, and how to undo it', () => {
  const detection = detectShadowedNodeShims({
    ...base,
    readLink: hijackedLinks,
    pathEntries: [LINK_DIR, '/home/u/.nvm/versions/node/v22.16.0/bin'],
    exists: (p) => p === '/home/u/.nvm/versions/node/v22.16.0/bin/node',
  });
  const warning = shadowedNodeWarning('Hermes Agent', detection);

  assert.match(warning, /Hermes Agent/);
  assert.match(warning, /nvm\/versions\/node\/v22\.16\.0/);
  assert.match(warning, /rm -f .*\.local\/bin\/node .*\.local\/bin\/npm .*\.local\/bin\/npx/);
});

test('no shims, no warning', () => {
  assert.strictEqual(shadowedNodeWarning('X', { shims: [], shadowed: null }), null);
  assert.strictEqual(shadowedNodeWarning('X', null), null);
});
