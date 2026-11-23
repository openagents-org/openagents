'use strict';

/**
 * Agent wake-up stream (GET /v1/events/agent-stream):
 *   - client: 404 → 'disabled', wake events → onWake, `reconnect` → 'ended',
 *     silence → 'error'; credentials and agent identity are sent
 *   - adapter: a live stream stretches idle polls to the safety interval and
 *     wakes the right loop; a lost stream returns to timed polling; a 404 is
 *     rechecked later rather than retried hot
 *
 * Run: node --test test/agent-stream.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { WorkspaceClient } = require('../src/workspace-client');
const BaseAdapter = require('../src/adapters/base');

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('WorkspaceClient.openAgentStream', () => {
  let server;
  let mode;
  let seen;
  before(async () => {
    server = await serve((req, res) => {
      seen = { url: req.url, headers: req.headers };
      if (mode === 'disabled') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"code":404,"data":{"reason":"agent_stream_disabled"}}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      if (mode === 'silent') return;
      res.write('event: wake\ndata: {"kinds":["message"]}\n\n');
      res.write('event: wake\r\ndata: {"kinds":["control","message"]}\r\n\r\n');
      res.write(': keepalive\n\n');
      res.write('event: reconnect\ndata: {}\n\n');
      res.end();
    });
  });
  after(() => server.close());

  const client = () => new WorkspaceClient(`http://127.0.0.1:${server.address().port}`, { agentName: 'bot' });

  it('reports a backend without the stream as disabled', async () => {
    mode = 'disabled';
    const { done } = client().openAgentStream('w1', 'bot', 'tok');
    assert.equal((await done).reason, 'disabled');
  });

  it('delivers wake kinds and ends on reconnect', async () => {
    mode = 'wake';
    const wakes = [];
    let opened = false;
    const { done } = client().openAgentStream('w1', 'bot', 'tok', {
      onOpen: () => { opened = true; },
      onWake: (kinds) => wakes.push(kinds),
    });
    assert.equal((await done).reason, 'ended');
    assert.equal(opened, true);
    assert.deepEqual(wakes, [['message'], ['control', 'message']]);
    assert.equal(seen.headers['x-workspace-token'], 'tok');
    assert.equal(seen.headers['x-agent-name'], 'bot');
    assert.match(seen.url, /^\/v1\/events\/agent-stream\?network=w1&agent=bot$/);
  });

  it('treats a silent stream as dead', async () => {
    mode = 'silent';
    const { done } = client().openAgentStream('w1', 'bot', 'tok', { idleMs: 150 });
    const result = await done;
    assert.equal(result.reason, 'error');
    assert.match(result.error.message, /silent/);
  });

  it('close() settles at once', async () => {
    mode = 'silent';
    const stream = client().openAgentStream('w1', 'bot', 'tok');
    stream.close();
    assert.equal((await stream.done).reason, 'closed');
  });
});

function makeAdapter(client) {
  const a = new BaseAdapter({
    workspaceId: 'w', channelName: 'general', token: 't', agentName: 'bot', endpoint: 'http://127.0.0.1:0',
  });
  a._log = () => {};
  if (client) a.client = client;
  return a;
}

describe('adapter with the wake-up stream', () => {
  it('stretches control polls only while the stream is live', () => {
    const a = makeAdapter();
    assert.equal(a._controlPollDelayMs(), 2000);
    a._streamLive = true;
    assert.equal(a._controlPollDelayMs(), 30000);
  });

  it('does not lose a wake that arrives while a poll is in flight', async () => {
    const a = makeAdapter();
    a._wakePollLoop();           // nobody sleeping yet
    const t0 = Date.now();
    await a._sleepUntilPollDue(60000);
    assert.ok(Date.now() - t0 < 100);
    a._wakeControlPoller();
    const t1 = Date.now();
    await a._sleepUntilControlPollDue(60000);
    assert.ok(Date.now() - t1 < 100);
  });

  it('wakes the matching loop and falls back to polling when the stream ends', async () => {
    let handlers;
    let finish;
    const a = makeAdapter({
      openAgentStream: (_w, _n, _t, h) => {
        handlers = h;
        return { done: new Promise((r) => { finish = r; }), close: () => finish({ reason: 'closed' }) };
      },
    });
    a._running = true;
    const loop = a._eventStreamLoop();
    handlers.onOpen();
    assert.equal(a._streamLive, true);
    // onOpen asks both loops for a catch-up poll.
    assert.equal(a._pollWakePending, true);
    assert.equal(a._controlWakePending, true);
    a._pollWakePending = false;
    a._controlWakePending = false;
    handlers.onWake(['control']);
    assert.equal(a._controlWakePending, true);
    assert.notEqual(a._pollWakePending, true);
    a._running = false;
    finish({ reason: 'closed' });
    await loop;
    assert.equal(a._streamLive, false);
  });

  it('rechecks a disabled stream after minutes, not seconds', async () => {
    const sleeps = [];
    const a = makeAdapter({ openAgentStream: () => ({ done: Promise.resolve({ reason: 'disabled' }), close() {} }) });
    a._running = true;
    a._streamSleep = async (ms) => { sleeps.push(ms); a._running = false; };
    await a._eventStreamLoop();
    assert.deepEqual(sleeps, [10 * 60 * 1000]);
  });

  it('can be turned off with OPENAGENTS_AGENT_STREAM=0', async () => {
    let opened = false;
    const a = makeAdapter({ openAgentStream: () => { opened = true; return { done: new Promise(() => {}), close() {} }; } });
    a._running = true;
    process.env.OPENAGENTS_AGENT_STREAM = '0';
    try {
      await a._eventStreamLoop();
    } finally {
      delete process.env.OPENAGENTS_AGENT_STREAM;
    }
    assert.equal(opened, false);
  });
});
