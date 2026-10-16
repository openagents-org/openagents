'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const BaseAdapter = require('../src/adapters/base');
test('applies only the current agent thread instructions once and preserves original content', () => {
  const adapter = Object.create(BaseAdapter.prototype); adapter.agentName = 'reviewer';
  const message = { content: 'Result', metadata: { thread_agent_instructions: { reviewer: 'Review citations', executor: 'Build' } } };
  adapter._applyThreadCollaboration('one', message);
  assert.match(message.content, /Review citations/); assert.doesNotMatch(message.content, /Build/);
  assert.equal(message.originalContent, 'Result');
  const once = message.content; adapter._applyThreadCollaboration('one', message); assert.equal(message.content, once);
  const next = { content: 'Another task', metadata: {} }; adapter._applyThreadCollaboration('two', next);
  assert.equal(next.content, 'Another task');
  const dm = { content: 'Direct', metadata: message.metadata }; adapter._applyThreadCollaboration('dm:someone', dm);
  assert.equal(dm.content, 'Direct');
});

test('completed replies correlate with the exact queued request, independently by channel', async () => {
  const adapter = new BaseAdapter({ workspaceId: 'ws', agentName: 'worker', token: 'test' });
  const sent = [];
  adapter.disabledModules = new Set(['files']);
  adapter.client = { sendMessage: async (_ws, channel, _token, content, options) => sent.push({ channel, content, ...options }) };
  adapter._schedulePresenceHeartbeat = () => {};
  adapter._prefetchPinnedContext = async () => {};
  adapter._channelQueues.one = [{ messageId: 'second', content: 'Second' }];
  adapter._handleMessage = async msg => {
    await adapter.sendThinking(msg.content === 'Other' ? 'two' : 'one', 'working');
    await adapter.sendResponse(msg.content === 'Other' ? 'two' : 'one', 'Finished');
  };
  await Promise.all([
    adapter._channelWorker('one', { messageId: 'first', content: 'First' }),
    adapter._channelWorker('two', { messageId: 'other', content: 'Other' }),
  ]);
  const final = sent.filter(m => m.metadata.status_kind === 'completed');
  assert.deepEqual(final.filter(m => m.channel === 'one').map(m => m.metadata.in_reply_to), ['first', 'second']);
  assert.equal(final.find(m => m.channel === 'two').metadata.in_reply_to, 'other');
  assert.ok(sent.filter(m => m.messageType === 'thinking').every(m => !m.metadata.status_kind));
  await adapter.sendResponse('one', 'Unsolicited background result');
  assert.equal(sent.at(-1).metadata.in_reply_to, undefined);
});

test('a stopped request cannot publish a correlated completion', async () => {
  const adapter = new BaseAdapter({ workspaceId: 'ws', agentName: 'worker', token: 'test' });
  const sent = [];
  adapter.client = { sendMessage: async (...args) => sent.push(args) };
  adapter._channelTriggerId.one = 'request';
  adapter._mutedChannels.add('one');
  await adapter.sendResponse('one', 'Finished');
  assert.deepEqual(sent, []);
});

test('handoffs preserve requester restrictions without trusting an agent-supplied sender email', () => {
  const adapter = Object.create(BaseAdapter.prototype);
  const msg = { senderType: 'agent', senderEmail: 'wrong@example.com', metadata: {
    orchestration: { action: 'next' }, requester_email: 'requester@example.com',
  } };
  assert.equal(adapter._sharedContextEmail(msg), 'requester@example.com');
  assert.equal(adapter._sharedContextCandidate(msg), true);
  assert.equal(adapter._sharedContextEmail({ senderType: 'agent', senderEmail: 'wrong@example.com' }), null);
  assert.equal(adapter._sharedContextEmail({ ...msg, metadata: { orchestration: { action: 'next' } } }), null);
});

test('failed Claude output stays visible without marking a successful completion', async () => {
  const ClaudeAdapter = require('../src/adapters/claude');
  const adapter = new ClaudeAdapter({ workspaceId: 'ws', agentName: 'worker', token: 'test' });
  const sent = [];
  adapter.disabledModules = new Set(['files']);
  adapter._channelTriggerId.one = 'request';
  adapter.client = { sendMessage: async (_ws, _ch, _token, content, options) => sent.push({ content, ...options }) };
  await adapter._postTurnOutcome({ lastErrorText: 'CLI failed' }, 'one', 'Partial answer');
  assert.equal(sent[0].content, 'Partial answer');
  assert.equal(sent[0].metadata.status_kind, 'error');
  assert.equal(sent[0].metadata.in_reply_to, 'request');
  await adapter._postTurnOutcome({ lastErrorText: '' }, 'one', 'Successful result');
  assert.equal(sent[1].metadata.status_kind, 'completed');
});
