'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');

/** An adapter with its network calls captured instead of sent. */
function makeAdapter({ agentName = 'agentA' } = {}) {
  const adapter = new BaseAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName,
  });
  adapter._log = () => {};
  const reports = [];
  adapter.client.reportAgentState = async (workspaceId, channel, token, payload) => {
    reports.push({ channel, ...payload });
  };
  return { adapter, reports };
}

describe('per-agent busy reporting', () => {
  it('brackets a turn with a busy report and an idle report', async () => {
    const { adapter, reports } = makeAdapter();
    adapter._handleMessage = async () => {};

    await adapter._channelWorker('thread', { content: 'hi' });

    assert.deepEqual(reports, [
      { channel: 'thread', agentName: 'agentA', busy: true, busyChannels: ['thread'] },
      { channel: 'thread', agentName: 'agentA', busy: false, busyChannels: [] },
    ]);
  });

  it('reports the full busy set so a lost report is self-correcting', async () => {
    const { adapter, reports } = makeAdapter();
    // Another channel is mid-turn while this one starts.
    adapter._channelBusy.add('other');
    adapter._handleMessage = async () => {};

    await adapter._channelWorker('thread', { content: 'hi' });

    assert.deepEqual(reports[0].busyChannels.sort(), ['other', 'thread']);
    assert.deepEqual(reports[1].busyChannels, ['other']);
  });

  it('still reports idle when the turn throws', async () => {
    const { adapter, reports } = makeAdapter();
    adapter._handleMessage = async () => { throw new Error('boom'); };
    adapter.sendError = async () => {};

    await adapter._channelWorker('thread', { content: 'hi' });

    assert.equal(reports.at(-1).busy, false);
    assert.equal(adapter._channelBusy.has('thread'), false);
  });

  it('reports idle even when the drain loop itself throws', async () => {
    const { adapter, reports } = makeAdapter();
    adapter._handleMessage = async () => {};
    // The drain loop guards each message it processes, but not its own queue
    // bookkeeping. Anything that escapes there used to leave the channel busy
    // forever in the UI — hence the report in a finally.
    Object.defineProperty(adapter._channelQueues, 'thread', {
      get() { throw new Error('queue read failed'); },
    });

    await assert.rejects(() => adapter._channelWorker('thread', { content: 'hi' }));

    assert.equal(adapter._channelBusy.has('thread'), false);
    assert.equal(reports.at(-1).busy, false);
    assert.deepEqual(reports.at(-1).busyChannels, []);
  });

  it('a failing report never breaks the turn', async () => {
    const { adapter } = makeAdapter();
    adapter.client.reportAgentState = async () => { throw new Error('network down'); };
    let handled = false;
    adapter._handleMessage = async () => { handled = true; };

    await adapter._channelWorker('thread', { content: 'hi' });

    assert.equal(handled, true);
  });

  it('puts the busy set on every heartbeat', async () => {
    const { adapter } = makeAdapter();
    const beats = [];
    adapter.client.heartbeat = async (workspaceId, agentName, token, sessionId, busyChannels) => {
      beats.push(busyChannels);
    };
    adapter._reportStatus = () => {};

    await adapter._heartbeat();
    adapter._channelBusy.add('thread');
    await adapter._heartbeat();

    assert.deepEqual(beats, [[], ['thread']]);
  });
});
