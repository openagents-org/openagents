'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');

function makeAdapter() {
  const adapter = new BaseAdapter({
    workspaceId: 'workspace-123',
    channelName: 'general',
    token: 'token-123',
    agentName: 'agent-1',
    agentType: 'cursor',
  });
  adapter._log = () => {};
  return adapter;
}

describe('workspace.agent.bootstrap events', () => {
  it('requires concrete adapters to implement bootstrap', async () => {
    const adapter = makeAdapter();

    await assert.rejects(
      () => adapter._processChannelItem('thread-abc', { _bootstrap: true }),
      /must implement _bootstrapChannel/
    );
  });

  it('dispatches bootstrap before a same-batch message in the same channel', async () => {
    const adapter = makeAdapter();
    const calls = [];

    adapter.client.pollPending = async () => ({
      cursor: 'event-2',
      messages: [
        {
          messageId: 'event-2',
          eventType: 'workspace.message.posted',
          sessionId: 'thread-abc',
          senderType: 'human',
          senderName: 'user',
          content: 'do the task',
          messageType: 'chat',
          metadata: { target_agents: ['agent-1'] },
        },
        {
          messageId: 'event-1',
          eventType: 'workspace.agent.bootstrap',
          sessionId: 'thread-abc',
          senderType: 'system',
          content: '',
          metadata: { target_agents: ['agent-1'] },
        },
      ],
    });
    adapter.client.pollToolResults = async () => ({ events: [], cursor: null });
    adapter._bootstrapChannel = async (channel) => {
      calls.push(`bootstrap:${channel}`);
    };
    adapter._handleMessage = async (msg) => {
      calls.push(`message:${msg.sessionId}:${msg.content}`);
      adapter.stop();
    };
    adapter._sleep = async () => {
      await new Promise((resolve) => setImmediate(resolve));
    };
    adapter._running = true;

    await adapter._pollLoop();

    assert.deepEqual(calls, [
      'bootstrap:thread-abc',
      'message:thread-abc:do the task',
    ]);
  });
});
