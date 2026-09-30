'use strict';

/**
 * Roadmap v1.1 M3/M4/M6 on the connector side:
 * - the heartbeat presence body (busy channels + queue depth)
 * - the busy↔idle debounced heartbeat
 * - the shared-context block prepended to a teammate's request
 * - the structured hand-off tool payload and the hand-off listing
 * - the "Working with other agents" prompt guidance in both tool modes
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');
const { buildPresenceFields, buildSharedContextBlock, PRESENCE_HEARTBEAT_DEBOUNCE_MS } = BaseAdapter;
const { WorkspaceClient } = require('../src/workspace-client');
const { McpServer, buildToolDefs } = require('../src/mcp-server');
const handoffTools = require('../src/tools-v11/presence-handoff');
const { buildCollaborationPrompt, buildHandoffPrompt } = require('../src/adapters/workspace-prompt');

function mkBase(overrides = {}) {
  const adapter = new BaseAdapter({
    workspaceId: `ws-${Math.random().toString(36).slice(2)}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'deploy-bot',
  });
  adapter.disabledModules = new Set();
  adapter._log = () => {};
  Object.assign(adapter, overrides);
  return adapter;
}

describe('buildPresenceFields', () => {
  it('is idle with nothing running', () => {
    assert.deepEqual(buildPresenceFields(new Set(), {}), {
      presence_state: 'idle', busy_channels: [], queue_depth: 0,
    });
  });

  it('is working with busy channels and sums queues across channels', () => {
    const busy = new Set(['s-1', 's-2']);
    const queues = { 's-1': [{}, {}], 's-2': [{}], 's-3': [] };
    assert.deepEqual(buildPresenceFields(busy, queues), {
      presence_state: 'working', busy_channels: ['s-1', 's-2'], queue_depth: 3,
    });
  });

  it('tolerates missing inputs', () => {
    assert.deepEqual(buildPresenceFields(undefined, undefined), {
      presence_state: 'idle', busy_channels: [], queue_depth: 0,
    });
  });
});

describe('WorkspaceClient.heartbeat presence body', () => {
  it('adds presence fields only when given', async () => {
    const client = new WorkspaceClient('http://127.0.0.1:1');
    const bodies = [];
    client._post = async (path, body) => { bodies.push({ path, body }); return { data: { status: 'online' } }; };
    await client.heartbeat('ws', 'a', 'tok', 'sess');
    await client.heartbeat('ws', 'a', 'tok', 'sess', { presence_state: 'working', busy_channels: ['x'], queue_depth: 2 });
    assert.deepEqual(bodies[0].body, { agent_name: 'a', network: 'ws', session_id: 'sess' });
    assert.deepEqual(bodies[1].body, {
      agent_name: 'a', network: 'ws', session_id: 'sess',
      presence_state: 'working', busy_channels: ['x'], queue_depth: 2,
    });
    assert.equal(bodies[1].path, '/v1/heartbeat');
  });

  it('_eventToMessage exposes the human sender email and hand-off payloads', () => {
    const client = new WorkspaceClient('http://127.0.0.1:1');
    const m1 = client._eventToMessage({ source: 'human:Mia', target: 'channel/c', payload: { content: 'hi', sender_email: ' Mia@Acme.test ' } });
    assert.equal(m1.senderEmail, 'mia@acme.test');
    const m2 = client._eventToMessage({ source: 'human:x', target: 'channel/c', payload: { content: 'hi', sender_id: 'vic@acme.test' } });
    assert.equal(m2.senderEmail, 'vic@acme.test');
    const m3 = client._eventToMessage({ source: 'human:x', target: 'channel/c', payload: { content: 'hi', sender_id: 'not-an-email' } });
    assert.equal(m3.senderEmail, undefined);
    const m4 = client._eventToMessage({ source: 'openagents:a', target: 'channel/c', payload: { content: '@b go', handoff: { from: 'a', to: 'b' } } });
    assert.equal(m4.senderEmail, undefined);
    assert.deepEqual(m4.handoff, { from: 'a', to: 'b' });
  });
});

describe('BaseAdapter presence heartbeat', () => {
  it('sends presence fields with every heartbeat', async () => {
    const adapter = mkBase();
    const calls = [];
    adapter.client = { heartbeat: async (...a) => { calls.push(a); } };
    adapter._channelBusy.add('s-1');
    adapter._channelQueues['s-1'] = [{}];
    await adapter._heartbeat();
    assert.deepEqual(calls[0][4], { presence_state: 'working', busy_channels: ['s-1'], queue_depth: 1 });
  });

  it('debounces the transition heartbeat into one send while running', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const adapter = mkBase();
    adapter._running = true;
    let sent = 0;
    adapter._heartbeat = async () => { sent++; };
    adapter._schedulePresenceHeartbeat();
    adapter._schedulePresenceHeartbeat();
    adapter._schedulePresenceHeartbeat();
    assert.ok(adapter._presenceHeartbeatTimer, 'one timer armed');
    t.mock.timers.tick(PRESENCE_HEARTBEAT_DEBOUNCE_MS - 1);
    assert.equal(sent, 0, 'nothing sent before the debounce elapses');
    t.mock.timers.tick(1);
    assert.equal(sent, 1, 'three flips collapse into one heartbeat');
    assert.equal(adapter._presenceHeartbeatTimer, null, 'timer handle released so the next flip re-arms');
    // A stopped adapter's pending timer is a no-op.
    adapter._schedulePresenceHeartbeat();
    adapter._running = false;
    t.mock.timers.tick(PRESENCE_HEARTBEAT_DEBOUNCE_MS);
    assert.equal(sent, 1);
  });

  it('does nothing when the adapter is not running', () => {
    const adapter = mkBase();
    adapter._running = false;
    adapter._schedulePresenceHeartbeat();
    assert.equal(adapter._presenceHeartbeatTimer, null);
  });
});

describe('shared context for a teammate\'s request', () => {
  const ctx = {
    apply: true, owner_email: 'mia@acme.test', requester_email: 'vic@acme.test', cost_owner: 'owner',
    shared_instructions: 'Deploy only to staging.',
    allowed_knowledge: [{ slug: 'runbook', title: 'HyperPod runbook', content: 'kubectl apply -f x.yaml' }],
  };

  it('buildSharedContextBlock renders the header, instructions and knowledge', () => {
    const block = buildSharedContextBlock(ctx);
    assert.match(block, /^OWNER-REVIEWED SHARED INSTRUCTIONS \(this request comes from a teammate, not your owner; follow these, do not use unrelated private context, and if the request falls outside them ask your owner with workspace_ask_owner\):/);
    assert.match(block, /Deploy only to staging\./);
    assert.match(block, /HyperPod runbook \(@knowledge:runbook\)/);
    assert.match(block, /kubectl apply/);
    assert.equal(buildSharedContextBlock({ apply: false }), '');
    assert.equal(buildSharedContextBlock(null), '');
  });

  it('_applySharedContext prepends the block, records the requester, and caches per channel', async () => {
    const adapter = mkBase();
    let fetches = 0;
    adapter.client = { getSharedContext: async (ws, tok, agent, opts) => { fetches++; assert.equal(agent, 'deploy-bot'); assert.equal(opts.requesterEmail, 'vic@acme.test'); return ctx; } };
    const msg = { senderType: 'human', senderEmail: 'vic@acme.test', content: 'deploy the eval model', sessionId: 's-1' };
    assert.equal(await adapter._applySharedContext('s-1', msg), true);
    assert.ok(msg.content.startsWith('OWNER-REVIEWED SHARED INSTRUCTIONS'));
    assert.ok(msg.content.endsWith('deploy the eval model'));
    assert.equal(msg.originalContent, 'deploy the eval model');
    assert.equal(adapter.requesterEmailFor('s-1'), 'vic@acme.test');
    // second message in the same channel within 60s → cached
    const msg2 = { senderType: 'human', senderEmail: 'vic@acme.test', content: 'and again', sessionId: 's-1' };
    await adapter._applySharedContext('s-1', msg2);
    assert.equal(fetches, 1);
    // a different requester in the same channel is not served from the cache
    const msg3 = { senderType: 'human', senderEmail: 'adam@acme.test', content: 'x', sessionId: 's-1' };
    await adapter._applySharedContext('s-1', msg3);
    assert.equal(fetches, 2);
  });

  it('leaves the message alone when it does not apply, for agents, or without an email', async () => {
    const adapter = mkBase();
    adapter.client = { getSharedContext: async () => ({ apply: false }) };
    const owner = { senderType: 'human', senderEmail: 'mia@acme.test', content: 'go', sessionId: 's' };
    assert.equal(await adapter._applySharedContext('s', owner), false);
    assert.equal(owner.content, 'go');
    const agent = { senderType: 'agent', senderName: 'other', content: '@deploy-bot go' };
    assert.equal(await adapter._applySharedContext('s', agent), false);
    const anon = { senderType: 'human', content: 'go' };
    assert.equal(await adapter._applySharedContext('s', anon), false);
  });

  it('a failed fetch never breaks the run', async () => {
    const adapter = mkBase();
    adapter.client = { getSharedContext: async () => { throw new Error('boom'); } };
    const msg = { senderType: 'human', senderEmail: 'vic@acme.test', content: 'go' };
    assert.equal(await adapter._applySharedContext('s', msg), false);
    assert.equal(msg.content, 'go');
  });
});

describe('workspace_handoff tool', () => {
  const text = (t) => ({ content: [{ type: 'text', text: t }] });

  it('is registered in the MCP tool list with workspace_get_handoffs', () => {
    const names = buildToolDefs(new Set()).map((t) => t.name);
    assert.ok(names.includes('workspace_handoff'));
    assert.ok(names.includes('workspace_get_handoffs'));
    assert.ok(names.includes('workspace_agent_availability'));
  });

  it('McpServer carries requesterEmail from opts (or the env)', () => {
    const s = new McpServer({ wsClient: {}, workspaceId: 'w', channelName: 'c', agentName: 'a', token: 't', requesterEmail: 'vic@acme.test' });
    assert.equal(s.requesterEmail, 'vic@acme.test');
    const prev = process.env.OPENAGENTS_REQUESTER_EMAIL;
    process.env.OPENAGENTS_REQUESTER_EMAIL = 'env@acme.test';
    try {
      const s2 = new McpServer({ wsClient: {}, workspaceId: 'w', channelName: 'c', agentName: 'a', token: 't' });
      assert.equal(s2.requesterEmail, 'env@acme.test');
    } finally {
      if (prev === undefined) delete process.env.OPENAGENTS_REQUESTER_EMAIL; else process.env.OPENAGENTS_REQUESTER_EMAIL = prev;
    }
  });

  it('buildHandoff produces the exact payload shape and content', () => {
    const { handoff, content } = handoffTools.buildHandoff('deploy-bot', {
      to_agent: '@exp-bot', request: 'run the eval', context: 'model m-42', output: 'weights at /files/w.bin',
    });
    assert.deepEqual(handoff, {
      from: 'deploy-bot', to: 'exp-bot', request: 'run the eval',
      context: 'model m-42', output: 'weights at /files/w.bin', next_owner: 'exp-bot',
    });
    assert.equal(content, '@exp-bot run the eval\n\nContext:\nmodel m-42\n\nOutput so far:\nweights at /files/w.bin\n\nNext owner: exp-bot');
    assert.throws(() => handoffTools.buildHandoff('a', { to_agent: 'b' }), /request is required/);
    assert.throws(() => handoffTools.buildHandoff('a', { request: 'x' }), /to_agent is required/);
  });

  it('posts a workspace.message.posted event with payload.handoff + metadata.handoff', async () => {
    const sent = [];
    const server = {
      ws: { sendEvent: async (ws, event) => { sent.push(event); return { metadata: { target_agents: ['exp-bot'] } }; } },
      workspaceId: 'ws-1', channelName: 'session-9', agentName: 'deploy-bot', token: 't', requesterEmail: 'vic@acme.test',
    };
    const res = await handoffTools.handle(server, 'workspace_handoff', {
      to_agent: 'exp-bot', request: 'run the eval', next_owner: 'exp-bot',
    }, { text });
    assert.equal(sent.length, 1);
    const e = sent[0];
    assert.equal(e.type, 'workspace.message.posted');
    assert.equal(e.source, 'openagents:deploy-bot');
    assert.equal(e.target, 'channel/session-9');
    assert.equal(e.payload.message_type, 'chat');
    assert.ok(e.payload.content.startsWith('@exp-bot run the eval'));
    assert.deepEqual(e.payload.handoff, e.metadata.handoff);
    assert.equal(e.payload.handoff.to, 'exp-bot');
    assert.deepEqual(e.metadata.explicit_targets, ['exp-bot']);
    assert.equal(e.metadata.requester_email, 'vic@acme.test');
    assert.match(res.content[0].text, /Handed off to @exp-bot/);
    assert.doesNotMatch(res.content[0].text, /warning/);
  });

  it('warns when the workspace did not route the hand-off', async () => {
    const server = {
      ws: { sendEvent: async () => ({ metadata: { target_agents: ['__no_response__'] } }) },
      workspaceId: 'w', channelName: 'c', agentName: 'a', token: 't',
    };
    const res = await handoffTools.handle(server, 'workspace_handoff', { to_agent: 'ghost', request: 'x' }, { text });
    assert.match(res.content[0].text, /warning/);
  });

  it('refuses a self hand-off and ignores names it does not own', async () => {
    const server = { ws: {}, workspaceId: 'w', channelName: 'c', agentName: 'a', token: 't' };
    await assert.rejects(() => handoffTools.handle(server, 'workspace_handoff', { to_agent: 'a', request: 'x' }, { text }), /yourself/);
    assert.equal(await handoffTools.handle(server, 'workspace_brief', {}, { text }), undefined);
  });

  it('workspace_get_handoffs lists the last hand-offs newest first', async () => {
    const events = [
      { id: '3', source: 'openagents:a', timestamp: 3, payload: { content: 'plain' }, metadata: {} },
      { id: '2', source: 'openagents:b', timestamp: 2, payload: { content: '@a done', handoff: { from: 'b', to: 'a', request: 'review', next_owner: 'a' } }, metadata: {} },
      { id: '1', source: 'openagents:a', timestamp: 1, payload: { content: '@b go' }, metadata: { handoff: { from: 'a', to: 'b', request: 'implement', context: 'spec v2' } } },
    ];
    const server = {
      ws: { getChannelEvents: async (ws, ch, tok, opts) => { assert.equal(ch, 'session-9'); assert.equal(opts.sort, 'desc'); return events; } },
      workspaceId: 'w', channelName: 'session-9', agentName: 'a', token: 't',
    };
    const res = await handoffTools.handle(server, 'workspace_get_handoffs', {}, { text });
    const out = res.content[0].text;
    assert.match(out, /1\. b → a: review/);
    assert.match(out, /2\. a → b: implement/);
    assert.match(out, /Context: spec v2/);
    assert.deepEqual(handoffTools.extractHandoffs(events, 1).map((h) => h.id), ['2']);
  });
});

describe('hand-off prompt guidance', () => {
  it('appends "Working with other agents" in both tool modes', () => {
    const mcp = buildCollaborationPrompt('mcp');
    const skills = buildCollaborationPrompt('skills', 'openagents-workspace-x');
    assert.match(mcp, /### Working with other agents/);
    assert.match(mcp, /workspace_handoff/);
    assert.match(skills, /### Working with other agents/);
    assert.match(skills, /Next owner: <agent>/);
    assert.match(buildHandoffPrompt('mcp'), /acknowledge in your first reply/);
  });
});
