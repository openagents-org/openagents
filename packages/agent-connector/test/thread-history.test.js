'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const BaseAdapter = require('../src/adapters/base');
const { WorkspaceClient } = require('../src/workspace-client');
const { buildThreadHistory, MAX_CONTEXT_CHARS } = require('../src/adapters/thread-history');
const current = { messageId: 'request', sessionId: 'general', senderType: 'human', senderName: 'Maya', content: '@bot summarize', createdAt: '2026-10-11T23:00:00Z' };
const message = (id, who, content, extra = {}) => ({ messageId: id, sessionId: 'general', senderType: 'human', senderName: who, content, ...extra });
function adapter(history) {
  const a = new BaseAdapter({ workspaceId: 'ws', channelName: 'general', agentName: 'bot', token: 'token' });
  a._log = () => {};
  a._schedulePresenceHeartbeat = () => {};
  a._prefetchPinnedContext = async () => {};
  a.client = { getRecentMessages: async () => history };
  a.handled = [];
  a._handleMessage = async (msg) => a.handled.push({ ...msg });
  return a;
}
describe('recent shared thread history', () => {
  it('includes everyone in order and excludes noise, duplicate events, the trigger and other threads', () => {
    const text = buildThreadHistory([
      message('1', 'maya@example.com', '@Sam check this', { senderDisplayName: 'Maya Chen' }),
      message('2', 'Sam', 'I checked it'), message('3', 'bot', 'Earlier result', { senderType: 'agent' }),
      message('3', 'bot', 'duplicate'), current,
      message('x', 'Sam', 'private DM', { sessionId: 'dm:human:Sam' }),
      message('y', 'bot', 'thinking', { messageType: 'status' }),
      message('z', 'Sam', 'future', { createdAt: '2026-10-11T23:01:00Z' }),
    ], 'general', current);
    assert.ok(text.indexOf('Maya Chen') < text.indexOf('I checked it'));
    assert.ok(text.indexOf('I checked it') < text.indexOf('Earlier result'));
    assert.match(text, /CURRENT REQUEST from "Maya"/);
    for (const hidden of ['duplicate', 'private DM', 'thinking', 'future', '@bot summarize']) assert.ok(!text.includes(hidden));
  });
  it('keeps distinct identical messages and attachment-only messages', () => {
    const text = buildThreadHistory([message('1', 'Maya', 'yes'), message('2', 'Sam', 'yes'),
      message('3', 'Sam', '', { attachments: [{ filename: 'plan.pdf', fileId: 'f1' }] })], 'general', current);
    assert.equal((text.match(/"text":"yes"/g) || []).length, 2);
    assert.match(text, /plan.pdf/);
  });
  it('bounds large histories, retaining the newest messages', () => {
    const text = buildThreadHistory(Array.from({ length: 100 }, (_, i) => message(String(i), 'Sam', `message-${i}:` + 'x'.repeat(5000))), 'general', current);
    assert.ok(text.length < MAX_CONTEXT_CHARS + 700);
    assert.match(text, /message-99/);
    assert.ok(!text.includes('message-0:'));
    assert.match(text, /truncated/);
  });
  it('refreshes before every turn and preserves the original request', async () => {
    const a = adapter([]);
    let calls = 0;
    a.client.getRecentMessages = async (ws, channel, token, limit, opts) => {
      calls++; assert.equal(channel, 'general'); assert.equal(opts.before, current.messageId);
      assert.equal(opts.timeout, 5000); return [message(String(calls), 'Sam', `update ${calls}`)];
    };
    await a._channelWorker('general', { ...current });
    await a._channelWorker('general', { ...current });
    assert.match(a.handled[0].content, /update 1/); assert.match(a.handled[1].content, /update 2/);
    assert.ok(a.handled[0].content.endsWith(current.content));
    assert.equal(a.handled[0].originalContent, current.content);
  });
  it('does not load shared history for DMs or synthetic nudges', async () => {
    const a = adapter([]);
    a.client.getRecentMessages = async () => assert.fail('unexpected read');
    await a._channelWorker('dm:human:Maya', { ...current, sessionId: 'dm:human:Maya' });
    await a._channelWorker('general', { ...current, messageId: '' });
    assert.equal(a.handled[0].content, current.content); assert.equal(a.handled[1].content, current.content);
  });
  it('honors a stop that arrives during the history fetch', async () => {
    const a = adapter([]);
    a.client.getRecentMessages = async () => { a._stopGeneration++; return [message('1', 'Sam', 'earlier')]; };
    await a._channelWorker('general', { ...current });
    assert.equal(a.handled.length, 0);
  });
  it('continues with the request when history is unavailable', async () => {
    const a = adapter([]);
    a.client.getRecentMessages = async () => { throw new Error('offline'); };
    await a._channelWorker('general', { ...current });
    assert.equal(a.handled[0].content, current.content);
  });
  it('keeps owner instructions ahead of history and titles from the original request', async () => {
    const a = adapter([message('1', 'Sam', 'earlier')]);
    a.client.getSharedContext = async () => ({ apply: true, shared_instructions: 'Only staging' });
    a.client.getSession = async () => ({ title: 'Session 1' });
    let title;
    a.client.updateSession = async (ws, channel, token, body) => { title = body.title; };
    a._handleMessage = async (msg) => {
      assert.ok(msg.content.startsWith('OWNER-REVIEWED SHARED INSTRUCTIONS'));
      assert.equal(msg.originalContent, current.content);
      await a._autoTitleChannel('general', msg.content);
    };
    await a._channelWorker('general', { ...current, senderEmail: 'maya@example.com' });
    assert.ok(title && !title.includes('RECENT') && !title.includes('OWNER-REVIEWED'));
  });
});
it('requests history before the trigger and retains display names', async () => {
  const client = new WorkspaceClient('http://localhost');
  client._get = async (url, headers, timeout) => {
    const query = new URL(url, 'http://localhost').searchParams;
    assert.equal(query.get('before'), 'trigger'); assert.equal(query.get('channel'), 'general');
    assert.equal(query.get('limit'), '100'); assert.equal(timeout, 5000);
    return { data: { events: [{ id: '1', source: 'human:maya@example.com', target: 'channel/general', payload: { content: 'hi', sender_display_name: 'Maya Chen' } }] } };
  };
  const messages = await client.getRecentMessages('ws', 'general', 'token', 100, { before: 'trigger', timeout: 5000 });
  assert.equal(messages[0].senderDisplayName, 'Maya Chen');
});
