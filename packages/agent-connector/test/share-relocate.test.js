'use strict';

/**
 * OpenAgents Share: a shared conversation added to one of the person's
 * workspaces takes its agent along. The launcher collects the new connection
 * once and the daemon rebinds and restarts the agent there.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BaseAdapter = require('../src/adapters/base');

function mk(opts = {}) {
  const a = new BaseAdapter({ workspaceId: 'ws-old', channelName: 'general', token: 'old-token',
    agentName: 'pr-reviewer', endpoint: 'https://oa.example.test', ...opts });
  a._log = () => {};
  return a;
}

describe('share relocate', () => {
  it('advertises relocate only when the daemon can move it', async () => {
    for (const [adapter, has] of [[mk({ onRelocate: () => {} }), true], [mk(), false]]) {
      let caps;
      adapter.client.joinNetwork = async (n, t, o) => { caps = o.capabilities; return { session_id: 's1' }; };
      adapter._reportStatus = () => {};
      await adapter._joinWorkspace();
      assert.equal(caps.includes('relocate'), has);
    }
  });

  it('collects the new connection with its session id and hands it to the daemon', async () => {
    const moves = [];
    const a = mk({ onRelocate: async (t) => { moves.push(t); } });
    a._sessionId = 'sess-9';
    let sent;
    a.client._post = async (url, body, headers) => {
      sent = { url, body, headers };
      return { code: 0, data: { workspace_id: 'ws-new', slug: 'team', token: 'node-token' } };
    };
    await a._onControlAction('relocate', { relocation_id: 'r1', name: 'Team' });
    assert.equal(sent.url, '/v1/guest-links/relocation/accept');
    assert.deepEqual(sent.body, { network: 'ws-old', agent_name: 'pr-reviewer', relocation_id: 'r1', session_id: 'sess-9' });
    assert.equal(sent.headers['X-Workspace-Token'], 'old-token');
    assert.deepEqual(moves, [{ workspaceId: 'ws-new', slug: 'team', name: 'Team', token: 'node-token', endpoint: 'https://oa.example.test' }]);
  });

  it('stays put when collecting fails', async () => {
    const moves = [];
    const a = mk({ onRelocate: async (t) => { moves.push(t); } });
    a.client._post = async () => { throw new Error('HTTP 404'); };
    await a._onControlAction('relocate', { relocation_id: 'r1' });
    assert.equal(moves.length, 0);
  });

  it('the daemon rebinds the agent to the new workspace and restarts it', async () => {
    const { Daemon } = require('../src/daemon');
    const { Config } = require('../src/config');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relocate-'));
    const cfg = new Config(dir);
    cfg.addAgent({ name: 'pr-reviewer', type: 'claude', role: 'worker', path: dir });
    cfg.addNetwork({ id: 'ws-old', slug: 'old', name: 'Old', endpoint: 'https://oa.example.test', token: 'old-token' });
    cfg.setAgentNetwork('pr-reviewer', 'old');
    const d = Object.create(Daemon.prototype);
    d.config = cfg;
    d._log = () => {};
    const restarted = [];
    d.restartAgent = async (n) => { restarted.push(n); };
    d._relocateAgent('pr-reviewer', { workspaceId: 'ws-new', slug: 'team', name: 'Team', token: 'node-token', endpoint: 'https://oa.example.test' });
    await new Promise((r) => setTimeout(r, 5));
    cfg.load();
    assert.equal(cfg.getAgent('pr-reviewer').network, 'team');
    assert.equal(cfg.getNetworks().find((n) => n.slug === 'team').token, 'node-token');
    assert.deepEqual(restarted, ['pr-reviewer']);

    // Never to another server.
    d._relocateAgent('pr-reviewer', { workspaceId: 'x', slug: 'evil', name: 'Evil', token: 't', endpoint: 'https://evil.example.test' });
    cfg.load();
    assert.equal(cfg.getAgent('pr-reviewer').network, 'team');
  });
});

describe('share relocate on join', () => {
  it('a move reported in the join reply is collected right after joining', async () => {
    const moves = [];
    const a = mk({ onRelocate: async (t) => { moves.push(t); } });
    a.client.joinNetwork = async () => ({ session_id: 's2', relocation: { relocation_id: 'r9', workspace_id: 'ws-new', slug: 'team' } });
    a._reportStatus = () => {};
    let sent;
    a.client._post = async (url, body) => { sent = body; return { data: { workspace_id: 'ws-new', slug: 'team', token: 'nt' } }; };
    await a._joinWorkspace();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(sent.relocation_id, 'r9');
    assert.equal(sent.session_id, 's2');
    assert.equal(moves[0].slug, 'team');
  });
});
