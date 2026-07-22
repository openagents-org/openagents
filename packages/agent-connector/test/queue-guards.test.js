'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');

function makeAdapter() {
  const adapter = new BaseAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'agent',
  });
  adapter._statusEvents = [];
  adapter.sendStatus = async (channel, content, extraMeta) => {
    adapter._statusEvents.push({ channel, content, meta: extraMeta || {} });
  };
  return adapter;
}

describe('channel queue guards (issue #492)', () => {
  it('drops new messages once the per-channel queue is full, with a single overflow notice', async () => {
    const adapter = makeAdapter();
    adapter._channelBusy.add('thread');

    for (let i = 0; i < 30; i++) {
      await adapter._dispatchMessage({ content: `msg ${i}`, sessionId: 'thread' });
    }

    assert.equal(adapter._channelQueues.thread.length, 20);
    const queuedEvents = adapter._statusEvents.filter((e) => e.meta.queue_id && e.meta.queued_message);
    assert.equal(queuedEvents.length, 20);
    const overflowEvents = adapter._statusEvents.filter((e) => e.meta.queue_status === 'overflow');
    assert.equal(overflowEvents.length, 1);
  });

  it('expires stale queued messages at drain time with a terminal expired event', async () => {
    const adapter = makeAdapter();
    const handled = [];
    adapter._handleMessage = async (msg) => handled.push(msg.content);

    adapter._channelQueues.thread = [
      { content: 'stale', sessionId: 'thread', _queueId: 'q-old', _queuedAt: Date.now() - 11 * 60 * 1000 },
      { content: 'fresh', sessionId: 'thread', _queueId: 'q-new', _queuedAt: Date.now() },
    ];

    await adapter._channelWorker('thread', { content: 'first', sessionId: 'thread' });

    assert.deepEqual(handled, ['first', 'fresh']);
    const expired = adapter._statusEvents.filter((e) => e.meta.queue_status === 'expired');
    assert.equal(expired.length, 1);
    assert.equal(expired[0].meta.queue_id, 'q-old');
  });

  it('clears the overflow notice flag once the channel drains', async () => {
    const adapter = makeAdapter();
    adapter._handleMessage = async () => {};
    adapter._queueOverflowNotified.add('thread');

    await adapter._channelWorker('thread', { content: 'work', sessionId: 'thread' });

    assert.equal(adapter._queueOverflowNotified.has('thread'), false);
  });

  it('emits a terminal cancelled event when a queued message is cancelled', async () => {
    const adapter = makeAdapter();
    adapter._channelQueues.thread = [{ content: 'x', _queueId: 'q-1' }];

    const removed = adapter._cancelQueuedMessage('thread', 'q-1');
    await Promise.resolve();

    assert.equal(removed, true);
    const cancelled = adapter._statusEvents.filter((e) => e.meta.queue_status === 'cancelled');
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].meta.queue_id, 'q-1');
  });

  it('_clearChannelQueue drops the queue and emits terminal events for advertised entries', async () => {
    const adapter = makeAdapter();
    adapter._channelQueues.thread = [
      { content: 'a', _queueId: 'q-1' },
      { content: 'b' }, // internal entry, never advertised — no terminal event needed
    ];
    adapter._queueOverflowNotified.add('thread');

    adapter._clearChannelQueue('thread', 'cancelled');
    await Promise.resolve();

    assert.equal(adapter._channelQueues.thread, undefined);
    assert.equal(adapter._queueOverflowNotified.has('thread'), false);
    const cancelled = adapter._statusEvents.filter((e) => e.meta.queue_status === 'cancelled');
    assert.deepEqual(cancelled.map((e) => e.meta.queue_id), ['q-1']);
  });

  it('_flushQueues emits a terminal event per advertised entry across all channels', async () => {
    const adapter = makeAdapter();
    adapter._channelQueues.a = [{ content: '1', _queueId: 'q-a' }];
    adapter._channelQueues.b = [{ content: '2', _queueId: 'q-b' }, { content: '3' }];

    await adapter._flushQueues('cancelled');

    assert.deepEqual(adapter._channelQueues, {});
    const cancelled = adapter._statusEvents.filter((e) => e.meta.queue_status === 'cancelled');
    assert.deepEqual(cancelled.map((e) => e.meta.queue_id).sort(), ['q-a', 'q-b']);
  });
});
