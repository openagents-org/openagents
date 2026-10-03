'use strict';

/**
 * Permission model v1.1 — agent identity on machine calls.
 *
 * A WorkspaceClient built for one agent sends `X-Agent-Name: <agent>` on EVERY
 * request (events poll/post, files, knowledge, tools, ...) because the header is
 * added in the transport helpers, not per call site. A machine-level client
 * (daemon device heartbeat, pairing redeem) sends none.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { WorkspaceClient } = require('../src/workspace-client');

/** One-shot JSON server that records every request's method, url, headers. */
function makeServer() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 200, data: { ok: true, events: [], items: [] } }));
    });
  });
  return { server, seen };
}

describe('X-Agent-Name header', () => {
  let server, seen, endpoint;
  before(async () => {
    ({ server, seen } = makeServer());
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const last = () => seen[seen.length - 1];

  it('constructor normalises agentName; withAgent derives a per-agent client', () => {
    assert.equal(new WorkspaceClient(endpoint).agentName, null);
    assert.equal(new WorkspaceClient(endpoint, {}).agentName, null);
    assert.equal(new WorkspaceClient(endpoint, { agentName: '  ' }).agentName, null);
    assert.equal(new WorkspaceClient(endpoint, { agentName: ' yumi ' }).agentName, 'yumi');
    const machine = new WorkspaceClient(endpoint);
    const agent = machine.withAgent('yumi');
    assert.equal(agent.agentName, 'yumi');
    assert.equal(agent.endpoint, machine.endpoint);
    assert.equal(machine.agentName, null, 'withAgent must not mutate the source client');
  });

  it('is sent by all six transport helpers for an agent client', async () => {
    const c = new WorkspaceClient(endpoint, { agentName: 'yumi' });
    await c._get('/v1/x', c._wsHeaders('tok'));
    assert.equal(last().headers['x-agent-name'], 'yumi');
    assert.equal(last().headers['x-workspace-token'], 'tok');
    await c._getRaw('/v1/x', c._wsHeaders('tok'));
    assert.equal(last().headers['x-agent-name'], 'yumi');
    await c._post('/v1/x', { a: 1 }, c._wsHeaders('tok'));
    assert.equal(last().headers['x-agent-name'], 'yumi');
    await c._put('/v1/x', { a: 1 }, c._wsHeaders('tok'));
    assert.equal(last().headers['x-agent-name'], 'yumi');
    await c._patch('/v1/x', { a: 1 }, c._wsHeaders('tok'));
    assert.equal(last().headers['x-agent-name'], 'yumi');
    await c._delete('/v1/x', c._wsHeaders('tok'), 'ws');
    assert.equal(last().headers['x-agent-name'], 'yumi');
    assert.equal(last().method, 'DELETE');
  });

  it('is sent even when the call site passes no headers at all', async () => {
    const c = new WorkspaceClient(endpoint, { agentName: 'yumi' });
    await c._post('/v1/x', { a: 1 });
    assert.equal(last().headers['x-agent-name'], 'yumi');
    assert.equal(last().headers['content-type'], 'application/json');
  });

  it('does not mutate the caller\'s header object', async () => {
    const c = new WorkspaceClient(endpoint, { agentName: 'yumi' });
    const mine = { 'X-Workspace-Token': 'tok' };
    await c._post('/v1/x', {}, mine);
    assert.deepEqual(mine, { 'X-Workspace-Token': 'tok' });
  });

  it('rides along on representative per-agent API methods', async () => {
    const c = new WorkspaceClient(endpoint, { agentName: 'yumi' });
    const calls = [
      () => c.pollPending('ws', 'yumi', 'tok', { after: null, limit: 5 }),
      () => c.sendMessage('ws', 'general', 'tok', 'hi', { agentName: 'yumi' }),
      () => c.listFiles('ws', 'tok'),
      () => c.listKnowledge('ws', 'tok'),
      () => c.getAgents('ws', 'tok'),
      () => c.getBrief('ws', 'tok', 'general'),
      () => c.getApproval('ws', 'tok', 'a1'),
      () => c.browserListTabs('ws', 'tok'),
      () => c.heartbeat('ws', 'yumi', 'tok', 's1'),
    ];
    for (const call of calls) {
      try { await call(); } catch (_) { /* response shape may not satisfy the method; the request was still made */ }
      assert.equal(last().headers['x-agent-name'], 'yumi', `missing on ${last().method} ${last().url}`);
    }
  });

  it('is absent on machine-level calls (device heartbeat, pairing redeem)', async () => {
    const machine = new WorkspaceClient(endpoint);
    await machine.redeemPairingCode('ABCD-EFGH', { nodeKey: 'k' });
    assert.equal(last().url, '/v1/nodes/redeem');
    assert.equal(last().headers['x-agent-name'], undefined);
    await machine.nodeHeartbeat('n1', 'tok', { hostname: 'h' });
    assert.equal(last().url, '/v1/nodes/heartbeat');
    assert.equal(last().headers['x-agent-name'], undefined);
    await machine.nodeCommandResult('c1', 'tok', { ok: true });
    assert.equal(last().headers['x-agent-name'], undefined);
  });

  it('an explicit X-Agent-Name in call headers is not overridden', async () => {
    const c = new WorkspaceClient(endpoint, { agentName: 'yumi' });
    await c._post('/v1/x', {}, { 'X-Agent-Name': 'other' });
    assert.equal(last().headers['x-agent-name'], 'other');
  });
});
