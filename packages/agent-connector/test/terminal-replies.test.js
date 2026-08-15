'use strict';

/**
 * Tests for the terminal-reply (delegation receipt) APIs in BaseAdapter:
 * - sendFinalResult/Error/NeedsInput/Cancelled stamp reply_kind + in_reply_to
 * - synthetic triggers (system:* senders, missing event id) are NOT stamped
 *   with in_reply_to, so they can never be mistaken for receipts
 * - the inflight-turn registry follows the strict set/clear lifecycle across
 *   the queue drain, and is available to cancellation paths
 * - error-kind failures are swallowed, result-kind failures propagate
 *   (matching sendError/sendResponse semantics)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');

function mkAdapter(overrides = {}) {
  const adapter = new BaseAdapter({
    workspaceId: `test-ws-${Math.random().toString(36).slice(2)}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'tester',
    ...overrides,
  });
  adapter.sent = [];
  adapter.client = {
    sendMessage: async (wsId, channel, token, content, opts) => {
      adapter.sent.push({ channel, content, opts });
    },
  };
  return adapter;
}

// A server-marked delegation trigger: the backend wrote delegated_by/to onto
// the routed event, naming this agent ('tester') as the delegate.
const TRIGGER = {
  messageId: 'evt-123', senderType: 'agent', senderName: 'delegator-a', content: 'do X',
  metadata: { delegated_by: 'delegator-a', delegated_to: ['tester'] },
};

describe('terminal reply metadata', () => {
  it('stamps reply_kind and in_reply_to for a real trigger', async () => {
    const a = mkAdapter();
    await a.sendFinalResult(TRIGGER, 'general', 'all done');
    assert.equal(a.sent.length, 1);
    const meta = a.sent[0].opts.metadata;
    assert.equal(meta.reply_kind, 'result');
    assert.equal(meta.in_reply_to, 'evt-123');
  });

  it('covers all four kinds', async () => {
    const a = mkAdapter();
    await a.sendFinalResult(TRIGGER, 'general', 'r');
    await a.sendFinalError(TRIGGER, 'general', 'e');
    await a.sendNeedsInput(TRIGGER, 'general', 'q');
    await a.sendCancelled(TRIGGER, 'general', 'c');
    assert.deepEqual(
      a.sent.map((s) => s.opts.metadata.reply_kind),
      ['result', 'error', 'needs_input', 'cancelled'],
    );
    for (const s of a.sent) assert.equal(s.opts.metadata.in_reply_to, 'evt-123');
  });

  it('stamps nothing for synthetic system triggers', async () => {
    const a = mkAdapter();
    await a.sendFinalResult(
      { messageId: 'evt-9', senderName: 'system:todos', content: 'nudge' },
      'general', 'done',
    );
    const meta = a.sent[0].opts.metadata;
    assert.equal(meta.reply_kind, undefined);
    assert.equal(meta.in_reply_to, undefined);
  });

  it('stamps nothing when the trigger is missing or has no event id', async () => {
    const a = mkAdapter();
    await a.sendCancelled(null, 'general', 'stopped');
    await a.sendFinalError({ senderName: 'someone' }, 'general', 'boom');
    for (const s of a.sent) {
      assert.equal(s.opts.metadata.in_reply_to, undefined);
      assert.equal(s.opts.metadata.reply_kind, undefined);
    }
  });

  it('keeps in_reply_to but omits reply_kind for non-delegated triggers', async () => {
    // Ordinary human-triggered turns must not render as delegation receipts
    // in the UI (the badge keys off reply_kind alone), but the correlation
    // id is still useful.
    const a = mkAdapter();
    await a.sendFinalResult(
      { messageId: 'evt-h1', senderType: 'human', senderName: 'alice', content: 'hi' },
      'general', 'hello',
    );
    const meta = a.sent[0].opts.metadata;
    assert.equal(meta.in_reply_to, 'evt-h1');
    assert.equal(meta.reply_kind, undefined);
  });

  it('omits reply_kind when the delegation names a different agent', async () => {
    const a = mkAdapter();
    await a.sendFinalResult(
      {
        messageId: 'evt-x', senderType: 'agent', senderName: 'delegator-a', content: 'do X',
        metadata: { delegated_by: 'delegator-a', delegated_to: ['someone-else'] },
      },
      'general', 'done',
    );
    const meta = a.sent[0].opts.metadata;
    assert.equal(meta.in_reply_to, 'evt-x');
    assert.equal(meta.reply_kind, undefined);
  });

  it('swallows send failures for error kind but propagates for result kind', async () => {
    const a = mkAdapter();
    a.client.sendMessage = async () => { throw new Error('network down'); };
    await a.sendFinalError(TRIGGER, 'general', 'e'); // must not throw
    await assert.rejects(() => a.sendFinalResult(TRIGGER, 'general', 'r'), /network down/);
  });
});

describe('claude build failure', () => {
  it('posts an error receipt when _buildClaudeCmd throws on a delegated turn', async () => {
    const ClaudeAdapter = require('../src/adapters/claude');
    const a = new ClaudeAdapter({
      workspaceId: 'ws-x', channelName: 'general', token: 'tok', agentName: 'tester',
      disabledModules: new Set(['knowledge']),
    });
    const sent = [];
    // Any client method the pre-build path touches resolves benignly; only
    // sendMessage records what actually got posted.
    a.client = new Proxy({}, {
      get: (_t, prop) => prop === 'sendMessage'
        ? async (_w, _c, _tok, content, opts) => { sent.push({ content, opts }); }
        : async () => [],
    });
    a._saveSessions = () => {};
    a.sendStatus = async () => {};
    a.sendThinking = async () => {};
    a.getRemainingTodos = async () => [];
    a.getBrowserEnabled = async () => false;
    a._resetIdleTimer = () => {};
    a._titledSessions.add('general');
    a._buildClaudeCmd = () => { throw new Error('Claude CLI not found'); };

    await a._handleMessage({
      messageId: 'evt-del-1', senderType: 'agent', senderName: 'delegator-a',
      sessionId: 'general', content: 'do X',
      metadata: { delegated_by: 'delegator-a', delegated_to: ['tester'] },
    });

    const receipt = sent.find((s) => s.opts && s.opts.metadata && s.opts.metadata.reply_kind);
    assert.ok(receipt, 'expected a stamped terminal message');
    assert.equal(receipt.opts.metadata.reply_kind, 'error');
    assert.equal(receipt.opts.metadata.in_reply_to, 'evt-del-1');
    assert.match(receipt.content, /Claude CLI not found/);
  });
});

describe('inflight turn registry', () => {
  it('tracks the current message across the queue drain and clears at the end', async () => {
    const a = mkAdapter();
    const seen = [];
    a._handleMessage = async (msg) => {
      seen.push({ msg: msg.messageId, inflight: a._inflightTurns['general'].messageId });
      if (msg.messageId === 'first') {
        a._channelQueues['general'] = [
          { messageId: 'second', senderName: 'human-user', sessionId: 'general' },
        ];
      }
    };
    await a._channelWorker('general', { messageId: 'first', senderName: 'human-user', sessionId: 'general' });
    // Each turn saw ITS OWN message as the inflight entry.
    assert.deepEqual(seen, [
      { msg: 'first', inflight: 'first' },
      { msg: 'second', inflight: 'second' },
    ]);
    assert.equal(a._inflightTurns['general'], undefined);
    assert.equal(a._channelBusy.has('general'), false);
  });

  it('worker failure posts a terminal error receipt tied to the failing message', async () => {
    const a = mkAdapter();
    a._handleMessage = async () => { throw new Error('adapter exploded'); };
    await a._channelWorker('general', TRIGGER);
    assert.equal(a.sent.length, 1);
    assert.equal(a.sent[0].opts.metadata.reply_kind, 'error');
    assert.equal(a.sent[0].opts.metadata.in_reply_to, 'evt-123');
    assert.match(a.sent[0].content, /adapter exploded/);
  });
});
