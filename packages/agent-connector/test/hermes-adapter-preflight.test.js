'use strict';

/**
 * Hermes adapter preflight.
 *
 * A hermes agent created from the workspace runs `agn create … --install`,
 * and a failed third-party install script is only a WARNING there — the CLI
 * still exits 0, so the agent gets created, connected and joined. Without a
 * preflight gate the workspace then showed a green, "all set" hermes next to a
 * smoke test reading "Not installed", and every message failed.
 *
 *   - No resolvable hermes binary → preflight { ok:false, reason:'runtime_missing' }
 *     so the daemon skips the join and surfaces the real reason. Never the
 *     wording "not installed" — install detection lives in the installer.
 *   - Resolvable binary           → preflight { ok:true }.
 *   - The lookup is re-run, so a CLI installed after the daemon started is
 *     picked up without a restart.
 *
 * Run: node --test test/hermes-adapter-preflight.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createAdapter } = require('../src/adapters');

function makeHermes(binResolver) {
  const a = createAdapter('hermes', {
    workspaceId: 'w',
    channelName: 'general',
    token: 't',
    agentName: 'hermes-test',
    endpoint: 'http://127.0.0.1:0',
  });
  a._log = () => {}; // keep test output clean
  a._findHermesBinary = binResolver;
  a._hermesBin = binResolver();
  return a;
}

describe('HermesAdapter.preflight', () => {
  it('no binary → ok:false, reason runtime_missing, no "not installed" wording', () => {
    const a = makeHermes(() => null);
    const pf = a.preflight();
    assert.equal(pf.ok, false);
    assert.equal(pf.reason, 'runtime_missing');
    assert.doesNotMatch(String(pf.message), /not installed/i);
    assert.match(String(pf.message), /Hermes CLI not found/);
  });

  it('binary resolves → ok:true', () => {
    const a = makeHermes(() => '/home/u/.local/bin/hermes');
    assert.deepEqual(a.preflight(), { ok: true });
  });

  it('re-resolves the binary if it appeared since construction', () => {
    let resolved = null;
    const a = makeHermes(() => resolved);
    assert.equal(a.preflight().ok, false); // missing at first
    resolved = '/home/u/.local/bin/hermes';
    assert.equal(a.preflight().ok, true); // preflight re-runs _findHermesBinary
  });
});

describe('HermesAdapter._handleMessage without a CLI', () => {
  it('reports runtime_missing and answers with the install hint instead of hanging', async () => {
    const a = makeHermes(() => null);
    const statuses = [];
    const errors = [];
    a._onStatus = (s) => statuses.push(s);
    a.sendError = async (_ch, m) => { errors.push(m); };
    a.sendStatus = async () => { throw new Error('must not reach "thinking..."'); };
    a._autoTitleChannel = async () => { throw new Error('must not title the channel'); };

    await a._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].reason, 'runtime_missing');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Hermes CLI not found/);
  });

  it('a CLI installed after the agent went online is picked up on the next message', async () => {
    let resolved = null;
    const a = makeHermes(() => resolved);
    const errors = [];
    a.sendError = async (_ch, m) => { errors.push(m); };
    a.sendStatus = async () => {};
    a._autoTitleChannel = async () => {};
    a._buildContextPrefix = async () => '';
    let ran = null;
    a._runHermes = async (prompt) => { ran = prompt; return 'pong'; };
    a.sendResponse = async () => {};

    await a._handleMessage({ content: 'hi', sessionId: 'general' });
    assert.equal(errors.length, 1); // still missing
    assert.equal(ran, null);

    resolved = '/home/u/.local/bin/hermes';
    await a._handleMessage({ content: 'hi again', sessionId: 'general' });
    assert.equal(errors.length, 1); // no new error
    assert.equal(ran, 'hi again');
  });
});
