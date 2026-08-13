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

describe('node-config clearActivePairing', () => {
  it('drops the active workspace but keeps the device key', () => {
    nodeCfg.saveNode({
      node_key: 'dev-key',
      node_id: 'n1',
      workspace_id: 'w1',
      workspace_slug: 'ws1',
      workspace_name: 'oa ws',
      endpoint: 'https://ws',
      token: 'secret',
      pairings: [{ node_id: 'n1', workspace_id: 'w1', workspace_slug: 'ws1', token: 'secret' }],
    });

    const dropped = nodeCfg.clearActivePairing();

    assert.equal(dropped.workspace_id, 'w1');
    const after = nodeCfg.loadNode();
    assert.equal(after.node_key, 'dev-key', 'the device key survives, so a re-pair reuses the same id');
    assert.equal(after.workspace_id, undefined, 'the active binding is gone');
    assert.equal(after.token, undefined, 'the workspace token is gone');
    assert.deepEqual(after.pairings, [], 'the dropped workspace is removed from history');
  });

  it('preserves other paired workspaces in history', () => {
    nodeCfg.saveNode({
      node_key: 'dev-key',
      node_id: 'n1',
      workspace_id: 'w1',
      workspace_slug: 'ws1',
      token: 'secret',
      pairings: [
        { node_id: 'n1', workspace_id: 'w1', workspace_slug: 'ws1', token: 'secret' },
        { node_id: 'n2', workspace_id: 'w2', workspace_slug: 'ws2', token: 'other' },
      ],
    });

    nodeCfg.clearActivePairing();

    const after = nodeCfg.loadNode();
    assert.deepEqual(
      after.pairings.map((p) => p.workspace_id),
      ['w2'],
      'only the active workspace is dropped; the rest stay',
    );
  });

  it('is a no-op when nothing is paired', () => {
    nodeCfg.saveNode({ node_key: 'dev-key' });
    assert.equal(nodeCfg.clearActivePairing(), null);
    assert.equal(nodeCfg.loadNode().node_key, 'dev-key');
  });
});
