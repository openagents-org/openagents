'use strict';

/**
 * Client-side half of per-channel context projection.
 *
 * The server decides whether to project (per channel `context_mode`); the
 * client's job is narrower but not trivial:
 *
 *   - always ask for its own view, so a channel can be switched without
 *     restarting any agent;
 *   - render a digest as visibly a digest, carrying the id needed to expand
 *     it. A summary rendered as if it were the whole turn is the one failure
 *     mode that turns this feature into a liability.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { WorkspaceClient } = require('../src/workspace-client');
const { formatRecapLine, sampleRecap } = require('../src/adapters/decision-log');
const { McpServer, buildToolDefs } = require('../src/mcp-server');
const ClaudeAdapter = require('../src/adapters/claude');

/** Run `fn` against a stub workspace server, recording every request path. */
async function withServer(handler, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const body = handler(req);
    res.writeHead(body.status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body.json));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const client = new WorkspaceClient(`http://127.0.0.1:${server.address().port}`);
    return await fn(client, requests);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const okEvents = (events) => ({ json: { code: 200, data: { events } } });

describe('getRecentMessages — view_for', () => {
  it('sends view_for when a viewer is given', async () => {
    await withServer(() => okEvents([]), async (client, requests) => {
      await client.getRecentMessages('ws-1', 'chan-1', 'tok', 20, { viewFor: 'rd-agent' });
      assert.ok(requests[0].includes('view_for=rd-agent'));
    });
  });

  it('omits view_for entirely when no viewer is given', async () => {
    await withServer(() => okEvents([]), async (client, requests) => {
      await client.getRecentMessages('ws-1', 'chan-1', 'tok', 20);
      assert.ok(!requests[0].includes('view_for'));
    });
  });

  it('url-encodes viewer names', async () => {
    await withServer(() => okEvents([]), async (client, requests) => {
      await client.getRecentMessages('ws-1', 'chan-1', 'tok', 20, { viewFor: 'rd agent&x' });
      assert.ok(requests[0].includes('view_for=rd+agent%26x'));
      assert.ok(!requests[0].includes('&x=')); // not smuggled in as its own param
    });
  });

  it('keeps sort alongside view_for', async () => {
    await withServer(() => okEvents([]), async (client, requests) => {
      await client.getRecentMessages('ws-1', 'chan-1', 'tok', 30, { viewFor: 'rd', sort: 'asc' });
      assert.ok(requests[0].includes('sort=asc'));
      assert.ok(requests[0].includes('view_for=rd'));
    });
  });

  it('marks digested messages as truncated', async () => {
    const events = [{
      id: 'e1',
      source: 'openagents:pm-agent',
      target: 'channel/chan-1',
      payload: { content: 'Settled on CSV', truncated: true },
      timestamp: 1,
      truncated: true,
    }];
    await withServer(() => okEvents(events), async (client) => {
      const [msg] = await client.getRecentMessages('ws-1', 'chan-1', 'tok', 20, { viewFor: 'rd' });
      assert.equal(msg.truncated, true);
      assert.equal(msg.messageId, 'e1', 'the id must survive — it is the way back to the full text');
    });
  });

  it('leaves full messages unmarked', async () => {
    const events = [{
      id: 'e1',
      source: 'human:alice',
      target: 'channel/chan-1',
      payload: { content: 'Build the export' },
      timestamp: 1,
    }];
    await withServer(() => okEvents(events), async (client) => {
      const [msg] = await client.getRecentMessages('ws-1', 'chan-1', 'tok', 20, { viewFor: 'rd' });
      assert.equal(msg.truncated, undefined);
    });
  });
});

describe('getEvent — the expand escape hatch', () => {
  const fullEvent = {
    id: 'e1',
    source: 'openagents:pm-agent',
    target: 'channel/chan-1',
    payload: { content: 'The whole product discussion, verbatim.' },
    timestamp: 1,
  };

  it('reads one event by id and returns it as a message', async () => {
    await withServer(() => ({ json: { code: 200, data: fullEvent } }), async (client, requests) => {
      const msg = await client.getEvent('ws-1', 'tok', 'e1');
      assert.equal(msg.content, 'The whole product discussion, verbatim.');
      assert.equal(msg.senderName, 'pm-agent');
      assert.ok(requests[0].startsWith('/v1/events/e1?'));
      assert.ok(requests[0].includes('network=ws-1'));
    });
  });

  it('encodes the id into the path', async () => {
    await withServer(() => ({ json: { code: 200, data: fullEvent } }), async (client, requests) => {
      await client.getEvent('ws-1', 'tok', 'a/b?c');
      assert.ok(requests[0].startsWith('/v1/events/a%2Fb%3Fc?'));
    });
  });

  it('returns null for a missing event rather than throwing', async () => {
    await withServer(() => ({ status: 404, json: { code: 404, message: 'Event not found' } }),
      async (client) => {
        assert.equal(await client.getEvent('ws-1', 'tok', 'nope'), null);
      });
  });

  it('returns null when the server answers without an event', async () => {
    await withServer(() => ({ json: { code: 200, data: {} } }), async (client) => {
      assert.equal(await client.getEvent('ws-1', 'tok', 'e1'), null);
    });
  });
});

describe('formatRecapLine — digests must read as digests', () => {
  it('labels a digest and shows its id', () => {
    const line = formatRecapLine({
      senderType: 'agent', senderName: 'pm-agent', messageId: 'e1',
      content: 'Settled on CSV', truncated: true,
    });
    assert.equal(line, '[pm-agent] (summary id=e1) Settled on CSV');
  });

  it('still labels a digest that arrived without an id', () => {
    const line = formatRecapLine({
      senderType: 'agent', senderName: 'pm-agent',
      content: 'Settled on CSV', truncated: true,
    });
    assert.equal(line, '[pm-agent] (summary) Settled on CSV');
  });

  it('leaves a full message exactly as before', () => {
    const line = formatRecapLine({
      senderType: 'human', senderName: 'alice', messageId: 'e1',
      content: 'Build the export',
    });
    assert.equal(line, '[alice] Build the export');
  });

  it('carries the marker through sampleRecap', () => {
    const lines = sampleRecap(
      [{ messageId: 'e1', senderType: 'human', senderName: 'alice', content: 'Build the export' }],
      [{ messageId: 'e2', senderType: 'agent', senderName: 'pm-agent', content: 'Settled on CSV', truncated: true }],
      'current message',
    );
    assert.deepEqual(lines, [
      '[alice] Build the export',
      '[… earlier messages omitted …]',
      '[pm-agent] (summary id=e2) Settled on CSV',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ClaudeAdapter._buildChannelRecap
// ---------------------------------------------------------------------------

function mkAdapter(overrides = {}) {
  const adapter = new ClaudeAdapter({
    workspaceId: 'ws-1',
    channelName: 'general',
    token: 'tok',
    agentName: 'rd-agent',
    ...overrides,
  });
  adapter._saveSessions = () => {};
  return adapter;
}

/** Stub client returning `head` for the asc window and `tail` for the desc one. */
function stubClient(head, tail, calls = []) {
  return {
    getRecentMessages: async (ws, ch, tok, limit, opts = {}) => {
      calls.push(opts);
      return opts.sort === 'asc' ? head : tail;
    },
  };
}

describe('ClaudeAdapter._buildChannelRecap', () => {
  it('asks for its own view on both history windows', async () => {
    const calls = [];
    const adapter = mkAdapter();
    adapter.client = stubClient([], [{ messageId: 'e1', senderName: 'alice', senderType: 'human', content: 'hi' }], calls);

    await adapter._buildChannelRecap('general', 'now');

    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.viewFor === 'rd-agent'));
    assert.ok(calls.some((c) => c.sort === 'asc'), 'the opening window must stay ascending');
  });

  it('explains digests when any turn came back digested', async () => {
    const adapter = mkAdapter({ toolMode: 'mcp' });
    adapter.client = stubClient([], [
      { messageId: 'e1', senderName: 'alice', senderType: 'human', content: 'Build the export' },
      { messageId: 'e2', senderName: 'pm-agent', senderType: 'agent', content: 'Settled on CSV', truncated: true },
    ]);

    const recap = await adapter._buildChannelRecap('general', 'now');

    assert.match(recap, /one-line digests/);
    assert.match(recap, /workspace_expand_message/);
    assert.match(recap, /\[pm-agent\] \(summary id=e2\) Settled on CSV/);
  });

  it('says nothing about digests when nothing was digested', async () => {
    const adapter = mkAdapter();
    adapter.client = stubClient([], [
      { messageId: 'e1', senderName: 'alice', senderType: 'human', content: 'Build the export' },
    ]);

    const recap = await adapter._buildChannelRecap('general', 'now');

    assert.doesNotMatch(recap, /digest/i);
    assert.doesNotMatch(recap, /workspace_expand_message/);
  });

  // `skills` is the adapter default, so this is the common path: no MCP server
  // is spawned and naming an MCP tool would send the agent after something
  // that does not exist.
  it('points skills-mode agents at curl, not at an MCP tool they do not have', async () => {
    const adapter = mkAdapter({ toolMode: 'skills' });
    adapter.client = stubClient([], [
      { messageId: 'e2', senderName: 'pm-agent', senderType: 'agent', content: 'Settled on CSV', truncated: true },
    ]);

    const recap = await adapter._buildChannelRecap('general', 'now');

    assert.match(recap, /workspace skill/);
    assert.doesNotMatch(recap, /workspace_expand_message/);
  });

  it('still returns null when there is nothing to recap', async () => {
    const adapter = mkAdapter();
    adapter.client = stubClient([], []);
    assert.equal(await adapter._buildChannelRecap('general', 'now'), null);
  });
});

// ---------------------------------------------------------------------------
// MCP surface
// ---------------------------------------------------------------------------

function mkMcp(wsClient) {
  return new McpServer({
    wsClient, workspaceId: 'ws-1', channelName: 'general',
    agentName: 'rd-agent', token: 'tok',
  });
}

const textOf = (result) => result.content.map((c) => c.text).join('\n');

describe('MCP workspace_get_history / workspace_expand_message', () => {
  it('exposes workspace_expand_message as a core tool', () => {
    const names = buildToolDefs(new Set()).map((t) => t.name);
    assert.ok(names.includes('workspace_expand_message'));
  });

  it('requests its own view', async () => {
    const calls = [];
    const mcp = mkMcp({
      getRecentMessages: async (ws, ch, tok, limit, opts = {}) => { calls.push(opts); return []; },
    });

    await mcp._dispatch('workspace_get_history', {});

    assert.deepEqual(calls, [{ viewFor: 'rd-agent' }]);
  });

  it('labels digests, keeps their ids, and says how to expand them', async () => {
    const mcp = mkMcp({
      getRecentMessages: async () => ([
        { messageId: 'e1', senderName: 'alice', senderType: 'human', content: 'Build the export' },
        { messageId: 'e2', senderName: 'pm-agent', senderType: 'agent', content: 'Settled on CSV', truncated: true },
      ]),
    });

    const out = textOf(await mcp._dispatch('workspace_get_history', {}));

    assert.match(out, /\[alice\] Build the export/);
    assert.match(out, /\[pm-agent\] \(summary id=e2\) Settled on CSV/);
    assert.match(out, /workspace_expand_message/);
  });

  it('adds no digest footer when nothing was digested', async () => {
    const mcp = mkMcp({
      getRecentMessages: async () => ([
        { messageId: 'e1', senderName: 'alice', senderType: 'human', content: 'Build the export' },
      ]),
    });

    const out = textOf(await mcp._dispatch('workspace_get_history', {}));

    assert.equal(out, '[alice] Build the export');
  });

  it('expands a message by id', async () => {
    const mcp = mkMcp({
      getEvent: async (ws, tok, id) => (id === 'e2'
        ? { messageId: 'e2', senderName: 'pm-agent', senderType: 'agent', content: 'The full text.' }
        : null),
    });

    const out = textOf(await mcp._dispatch('workspace_expand_message', { message_id: 'e2' }));

    assert.equal(out, '[pm-agent] The full text.');
  });

  it('reports a missing message instead of returning nothing', async () => {
    const mcp = mkMcp({ getEvent: async () => null });
    const out = textOf(await mcp._dispatch('workspace_expand_message', { message_id: 'gone' }));
    assert.match(out, /No message found with id gone/);
  });

  it('requires a message id', async () => {
    const mcp = mkMcp({ getEvent: async () => null });
    const out = textOf(await mcp._dispatch('workspace_expand_message', {}));
    assert.match(out, /message_id is required/);
  });
});
