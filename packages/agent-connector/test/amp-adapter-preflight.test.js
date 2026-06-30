'use strict';

/**
 * Amp adapter preflight + spawn-error classification.
 *
 *   - No resolvable amp binary  → preflight { ok:false, reason:'runtime_missing' }
 *     so the daemon skips the workspace join (no pointless join loop) and the
 *     message is "not found", NEVER a generic "not installed".
 *   - Resolvable binary         → preflight { ok:true }.
 *   - _isSpawnError distinguishes a launch failure (ENOENT/EACCES) from an
 *     ordinary runtime error, so a spawn failure surfaces as spawn_failed.
 *
 * Run: node --test test/amp-adapter-preflight.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createAdapter } = require('../src/adapters');

function makeAmp(binResolver) {
  const a = createAdapter('amp', {
    workspaceId: 'w',
    channelName: 'general',
    token: 't',
    agentName: 'amp-test',
    endpoint: 'http://127.0.0.1:0',
  });
  a._log = () => {}; // keep test output clean
  a._findAmpBinary = binResolver;
  a._ampBin = binResolver();
  return a;
}

describe('AmpAdapter.preflight', () => {
  it('no binary → ok:false, reason runtime_missing, no "not installed" wording', () => {
    const a = makeAmp(() => null);
    const pf = a.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, 'runtime_missing');
    assert.doesNotMatch(String(pf.message), /not installed/i);
  });

  it('binary resolves → ok:true', () => {
    const a = makeAmp(() => '/usr/local/bin/amp');
    assert.deepEqual(a.preflight(), { ok: true });
  });

  it('re-resolves the binary if it appeared since construction', () => {
    let resolved = null;
    const a = makeAmp(() => resolved);
    assert.equal(a.preflight().ok, false); // missing at first
    resolved = '/usr/local/bin/amp';
    a._ampBin = null; // simulate "not cached yet"
    assert.equal(a.preflight().ok, true); // preflight re-runs _findAmpBinary
  });
});

describe('AmpAdapter._isSpawnError', () => {
  const a = makeAmp(() => '/usr/local/bin/amp');
  it('treats ENOENT/EACCES/EPERM and spawn syscall as spawn errors', () => {
    assert.equal(a._isSpawnError({ code: 'ENOENT' }), true);
    assert.equal(a._isSpawnError({ code: 'EACCES' }), true);
    assert.equal(a._isSpawnError({ code: 'EPERM' }), true);
    assert.equal(a._isSpawnError({ syscall: 'spawn' }), true);
  });
  it('does NOT treat ordinary runtime errors as spawn errors', () => {
    assert.equal(a._isSpawnError(new Error('amp said something went wrong')), false);
    assert.equal(a._isSpawnError({ code: 'SOMETHINGELSE' }), false);
    assert.equal(a._isSpawnError(null), false);
  });
});
