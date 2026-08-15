'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// node-config resolves ~/.openagents at require time, so each test gets an
// isolated HOME and a freshly-required copy of the module (cache busted). The
// aider tests use the same HOME-redirect trick.
let tmpHome;
let savedHome;
let nodeCfg;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-nodecfg-'));
  savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete require.cache[require.resolve('../src/node-config')];
  nodeCfg = require('../src/node-config');
});

afterEach(() => {
  if (savedHome.HOME === undefined) delete process.env.HOME; else process.env.HOME = savedHome.HOME;
  if (savedHome.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedHome.USERPROFILE;
  delete require.cache[require.resolve('../src/node-config')];
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const W1 = { node_id: 'n1', workspace_id: 'w1', workspace_slug: 'ws1', endpoint: 'https://ws1', token: 'secret' };
const W2 = { node_id: 'n2', workspace_id: 'w2', workspace_slug: 'ws2', endpoint: 'https://ws2', token: 'other' };

describe('node-config listPairings', () => {
  it('returns every paired workspace — they are all live', () => {
    nodeCfg.saveNode({ node_key: 'dev-key', ...W2, pairings: [W2, W1] });

    assert.deepEqual(
      nodeCfg.listPairings().map((p) => p.workspace_id),
      ['w2', 'w1'],
    );
  });

  // node.json written before `pairings` existed carries one top-level pairing.
  it('reconstructs the list from a legacy single-pairing file', () => {
    nodeCfg.saveNode({ node_key: 'dev-key', ...W1 });

    assert.deepEqual(
      nodeCfg.listPairings().map((p) => p.workspace_id),
      ['w1'],
    );
  });

  it('is empty when nothing is paired', () => {
    nodeCfg.saveNode({ node_key: 'dev-key' });
    assert.deepEqual(nodeCfg.listPairings(), []);
  });
});

describe('node-config clearPairing', () => {
  it('drops the named workspace but keeps the device key', () => {
    nodeCfg.saveNode({ node_key: 'dev-key', ...W1, pairings: [W1] });

    const dropped = nodeCfg.clearPairing('w1');

    assert.equal(dropped.workspace_id, 'w1');
    const after = nodeCfg.loadNode();
    assert.equal(after.node_key, 'dev-key', 'the device key survives, so a re-pair reuses the same id');
    assert.equal(after.workspace_id, undefined, 'the binding is gone');
    assert.equal(after.token, undefined, 'the workspace token is gone');
    assert.deepEqual(after.pairings, [], 'the dropped workspace is removed');
  });

  // The whole point of multi-pairing: one workspace forgetting this device says
  // nothing about the others, which must go on heartbeating.
  it('leaves every other paired workspace intact', () => {
    nodeCfg.saveNode({ node_key: 'dev-key', ...W1, pairings: [W1, W2] });

    nodeCfg.clearPairing('w1');

    const after = nodeCfg.loadNode();
    assert.deepEqual(after.pairings.map((p) => p.workspace_id), ['w2']);
    assert.equal(after.workspace_id, 'w2', 'a survivor is promoted to the top level');
    assert.equal(after.token, 'other', 'with its own token, so it can still heartbeat');
  });

  it('defaults to the top-level pairing', () => {
    nodeCfg.saveNode({ node_key: 'dev-key', ...W2, pairings: [W2, W1] });

    assert.equal(nodeCfg.clearPairing().workspace_id, 'w2');
    assert.deepEqual(nodeCfg.listPairings().map((p) => p.workspace_id), ['w1']);
  });

  it('never returns the dropped pairing\'s token', () => {
    nodeCfg.saveNode({ node_key: 'dev-key', ...W1, pairings: [W1] });
    assert.equal(nodeCfg.clearPairing('w1').token, undefined);
  });

  it('is a no-op for a workspace that is not paired', () => {
    nodeCfg.saveNode({ node_key: 'dev-key', ...W1, pairings: [W1] });

    assert.equal(nodeCfg.clearPairing('w-nope'), null);
    assert.deepEqual(nodeCfg.listPairings().map((p) => p.workspace_id), ['w1']);
  });

  it('is a no-op when nothing is paired', () => {
    nodeCfg.saveNode({ node_key: 'dev-key' });
    assert.equal(nodeCfg.clearPairing(), null);
    assert.equal(nodeCfg.loadNode().node_key, 'dev-key');
  });
});
