'use strict';

/**
 * BaseAdapter's half of durable consumption.
 *
 * The store is covered separately; what matters here is that the adapter
 * settles every message it takes ownership of. An outstanding claim blocks the
 * cursor by design, so any path that drops a message without settling it
 * freezes that agent permanently — the interesting failures are all in the
 * paths that *don't* end in a normal reply.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BaseAdapter = require('../src/adapters/base');
const { ConsumptionStore } = require('../src/adapters/consumption-store');

function adapter({ durable = true } = {}) {
  const a = new BaseAdapter({
    workspaceId: 'ws-1',
    token: 't',
    agentName: 'agent-a',
    durableConsumption: durable,
  });
  if (durable) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-durable-'));
    a._store = new ConsumptionStore('ws-1', 'agent-a', { dir });
  }
  a._log = () => {};
  a.sendStatus = async () => {};
  return a;
}

test('durable consumption is off unless asked for', () => {
  delete process.env.OPENAGENTS_DURABLE_CONSUMPTION;
  const a = new BaseAdapter({ workspaceId: 'w', token: 't', agentName: 'a' });
  assert.strictEqual(a._durable, false, 'the shared poll loop must not change by default');
});

test('an explicit option overrides the environment', () => {
  process.env.OPENAGENTS_DURABLE_CONSUMPTION = '1';
  try {
    const a = new BaseAdapter({
      workspaceId: 'w', token: 't', agentName: 'a', durableConsumption: false,
    });
    assert.strictEqual(a._durable, false);
  } finally {
    delete process.env.OPENAGENTS_DURABLE_CONSUMPTION;
  }
});

test('a dropped routine fire settles its claim', async () => {
  // Routine fires are dropped while the previous run is still going. Left
  // claimed, one of them would pin the cursor for the life of the agent.
  const a = adapter();
  a._channelBusy.add('c1');
  a._store.claim('msg-1');

  await a._dispatchMessage({
    id: 'msg-1', sessionId: 'c1', senderName: 'system:routine', content: 'tick',
  });

  assert.strictEqual(a._store.hasInflight(), false);
  assert.strictEqual(a._store.advanceCursor('evt-9'), true, 'cursor is free to move');
});

test('a cancelled queued message settles its claim', async () => {
  const a = adapter();
  a._channelBusy.add('c1');
  a._store.claim('msg-1');

  await a._dispatchMessage({ id: 'msg-1', sessionId: 'c1', content: 'later' });
  assert.strictEqual(a._store.hasInflight(), true, 'queued, still owed work');

  const queued = a._channelQueues.c1[0];
  assert.strictEqual(a._cancelQueuedMessage('c1', queued._queueId), true);
  assert.strictEqual(a._store.hasInflight(), false);
});

test('a handled message is settled even when the agent errors', async () => {
  // The failure already produced a visible reply; replaying it on restart
  // would just repeat the same failure.
  const a = adapter();
  a._store.claim('msg-1');
  a._handleMessage = async () => { throw new Error('boom'); };
  a.sendError = async () => {};

  await a._runOne('c1', { id: 'msg-1', sessionId: 'c1', content: 'hi' });

  assert.strictEqual(a._store.hasInflight(), false);
  assert.strictEqual(a._store.isSettled('msg-1'), true);
});

test('replies name the message they answer', async () => {
  // What lets the backend collapse the duplicate a replay can produce.
  const a = adapter();
  let sent = null;
  a.client = { sendMessage: async (_w, _c, _t, content, opts) => { sent = { content, opts }; } };
  a._handleMessage = async (msg) => { await a.sendResponse(msg.sessionId, 'the answer'); };

  await a._runOne('c1', { id: 'msg-1', sessionId: 'c1', content: 'question' });

  assert.strictEqual(sent.content, 'the answer');
  assert.deepStrictEqual(sent.opts.metadata, { in_reply_to: 'msg-1', reply_seq: 0 });
});

test('replies outside a turn carry no in_reply_to', async () => {
  // Slash-command output and similar answer nothing in particular.
  const a = adapter();
  let sent = null;
  a.client = { sendMessage: async (_w, _c, _t, content, opts) => { sent = { content, opts }; } };

  await a.sendResponse('c1', 'unprompted');

  assert.strictEqual(sent.opts.metadata, undefined);
});

test('with durable consumption off nothing is tracked', async () => {
  const a = adapter({ durable: false });
  let sent = null;
  a.client = { sendMessage: async (_w, _c, _t, content, opts) => { sent = { content, opts }; } };
  a._handleMessage = async (msg) => { await a.sendResponse(msg.sessionId, 'ok'); };

  await a._runOne('c1', { id: 'msg-1', sessionId: 'c1', content: 'hi' });

  assert.strictEqual(a._store, null);
  // The turn is still tracked in memory, so the reply can still name its
  // question — that part costs nothing and is useful on its own.
  assert.deepStrictEqual(sent.opts.metadata, { in_reply_to: 'msg-1', reply_seq: 0 });
});

test('several replies in one turn are numbered, not collapsed', async () => {
  // cline and cursor both do this: a question or an interruption notice goes
  // out mid-run, and the conclusion follows. Sharing one identity would make
  // the backend swallow everything after the first.
  const a = adapter();
  const sent = [];
  a.client = { sendMessage: async (_w, _c, _t, content, opts) => { sent.push({ content, opts }); } };
  a._handleMessage = async (msg) => {
    await a.sendResponse(msg.sessionId, 'a question first');
    await a.sendResponse(msg.sessionId, 'and the conclusion');
  };

  await a._runOne('c1', { id: 'msg-1', sessionId: 'c1', content: 'do a thing' });

  assert.deepStrictEqual(sent.map((s) => s.opts.metadata), [
    { in_reply_to: 'msg-1', reply_seq: 0 },
    { in_reply_to: 'msg-1', reply_seq: 1 },
  ]);
});

test('a replayed turn re-emits the same sequence numbers', async () => {
  // Which is what makes the collision happen at the backend, reply for reply.
  const a = adapter();
  const runs = [];
  a.client = { sendMessage: async (_w, _c, _t, _content, opts) => { runs.push(opts.metadata); } };
  a._handleMessage = async (msg) => {
    await a.sendResponse(msg.sessionId, 'one');
    await a.sendResponse(msg.sessionId, 'two');
  };

  const msg = { id: 'msg-1', sessionId: 'c1', content: 'do a thing' };
  await a._runOne('c1', msg);
  await a._runOne('c1', msg);   // the replay after a restart

  assert.deepStrictEqual(runs.slice(0, 2), runs.slice(2, 4));
});
