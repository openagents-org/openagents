'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const {
  AcpClient, AcpRpcError, AcpClosedError, AcpTimeoutError, METHOD_NOT_FOUND,
} = require('../src/adapters/acp-client');

/** A child-process stand-in whose stdio the test drives directly. */
function fakeAgent() {
  const proc = new EventEmitter();
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  const sent = [];
  let buf = '';
  proc.stdin.on('data', (c) => {
    buf += c.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      sent.push(JSON.parse(buf.slice(0, nl)));
      buf = buf.slice(nl + 1);
    }
  });
  const say = (obj) => proc.stdout.write(`${JSON.stringify(obj)}\n`);
  const tick = () => new Promise((r) => setImmediate(r));
  return { proc, sent, say, tick };
}

describe('AcpClient', () => {
  it('matches responses to requests by id', async () => {
    const a = fakeAgent();
    const client = new AcpClient(a.proc);
    const p1 = client.request('initialize', { protocolVersion: 1 });
    const p2 = client.request('session/new', { cwd: '/x', mcpServers: [] });
    await a.tick();
    assert.deepEqual(a.sent.map((m) => [m.id, m.method]), [[1, 'initialize'], [2, 'session/new']]);
    a.say({ jsonrpc: '2.0', id: 2, result: { sessionId: 's1' } });
    a.say({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } });
    assert.deepEqual(await p1, { protocolVersion: 1 });
    assert.deepEqual(await p2, { sessionId: 's1' });
  });

  it('rejects with the agent\'s JSON-RPC error, keeping code and data', async () => {
    const a = fakeAgent();
    const client = new AcpClient(a.proc);
    const p = client.request('session/load', { sessionId: 'gone' });
    await a.tick();
    a.say({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error', data: 'Session not found: gone' } });
    await assert.rejects(p, (e) => e instanceof AcpRpcError && e.code === -32603 && e.data === 'Session not found: gone'
      && e.method === 'session/load');
  });

  it('delivers notifications, frames split across chunks, and survives non-JSON lines', async () => {
    const a = fakeAgent();
    const seen = [];
    const junk = [];
    const client = new AcpClient(a.proc, {
      onNotification: (method, params) => seen.push([method, params]),
      onUnparsed: (line) => junk.push(line),
    });
    assert.ok(client);
    const frame = JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk' } } });
    a.proc.stdout.write(frame.slice(0, 20));
    a.proc.stdout.write(`${frame.slice(20)}\nnot json at all\n`);
    await a.tick();
    assert.deepEqual(seen, [['session/update', { update: { sessionUpdate: 'agent_message_chunk' } }]]);
    assert.deepEqual(junk, ['not json at all']);
  });

  it('answers agent requests with the handler\'s result', async () => {
    const a = fakeAgent();
    // eslint-disable-next-line no-new
    new AcpClient(a.proc, {
      onRequest: (method) => (method === 'session/request_permission'
        ? { outcome: { outcome: 'selected', optionId: 'allow_once' } } : undefined),
    });
    a.say({ jsonrpc: '2.0', id: 'req-1', method: 'session/request_permission', params: { options: [] } });
    a.say({ jsonrpc: '2.0', id: 'req-2', method: 'fs/read_text_file', params: { path: '/etc/passwd' } });
    await a.tick();
    await a.tick();
    const byId = Object.fromEntries(a.sent.map((m) => [m.id, m]));
    assert.deepEqual(byId['req-1'].result, { outcome: { outcome: 'selected', optionId: 'allow_once' } });
    assert.equal(byId['req-2'].error.code, METHOD_NOT_FOUND, 'an unsupported request is refused, never left hanging');
  });

  it('answers with method-not-found when there is no request handler at all', async () => {
    const a = fakeAgent();
    // eslint-disable-next-line no-new
    new AcpClient(a.proc);
    a.say({ jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: {} });
    await a.tick();
    assert.equal(a.sent[0].error.code, METHOD_NOT_FOUND);
  });

  it('turns a throwing handler into a JSON-RPC error', async () => {
    const a = fakeAgent();
    // eslint-disable-next-line no-new
    new AcpClient(a.proc, { onRequest: () => { throw new Error('boom'); } });
    a.say({ jsonrpc: '2.0', id: 9, method: 'x', params: {} });
    await a.tick();
    await a.tick();
    assert.equal(a.sent[0].error.message, 'boom');
  });

  it('sends notifications without an id', async () => {
    const a = fakeAgent();
    const client = new AcpClient(a.proc);
    assert.equal(client.notify('session/cancel', { sessionId: 's1' }), true);
    await a.tick();
    assert.deepEqual(a.sent, [{ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's1' } }]);
  });

  it('fails pending requests when the process exits, and refuses new ones', async () => {
    const a = fakeAgent();
    const client = new AcpClient(a.proc);
    const p = client.request('session/prompt', {});
    a.proc.emit('exit', 1, null);
    await assert.rejects(p, AcpClosedError);
    assert.equal(client.closed, true);
    await assert.rejects(client.request('session/new', {}), AcpClosedError);
    assert.equal(client.notify('session/cancel', {}), false);
  });

  it('times a request out when asked to', async () => {
    const a = fakeAgent();
    const client = new AcpClient(a.proc);
    await assert.rejects(client.request('initialize', {}, { timeoutMs: 20 }), AcpTimeoutError);
  });

  it('reports activity for every parsed frame', async () => {
    const a = fakeAgent();
    let n = 0;
    // eslint-disable-next-line no-new
    new AcpClient(a.proc, { onActivity: () => { n++; } });
    a.say({ jsonrpc: '2.0', method: '_kiro.dev/metadata', params: {} });
    a.say({ jsonrpc: '2.0', method: 'session/update', params: {} });
    await a.tick();
    assert.equal(n, 2);
  });
});
