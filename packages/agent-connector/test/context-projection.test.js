'use strict';

/**
 * Client-side half of per-channel context projection.
 *
 * The server decides whether to project (per channel `context_mode`); the
 * client's job is narrower but not trivial:
 *
 *   - always ask for its own view, so a channel can be switched without
 *     restarting any agent;
 *   - render an excerpt as visibly an excerpt, carrying the id needed to expand
 *     it. An excerpt rendered as if it were the whole turn is the one failure
 *     mode that turns this feature into a liability.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { WorkspaceClient } = require('../src/workspace-client');
const { formatRecapLine, sampleRecap } = require('../src/adapters/decision-log');
const { McpServer, buildToolDefs } = require('../src/mcp-server');
const ClaudeAdapter = require('../src/adapters/claude');
const ClineAdapter = require('../src/adapters/cline');
const CursorAdapter = require('../src/adapters/cursor');
const { buildApiSkillsPrompt } = require('../src/adapters/workspace-prompt');

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

describe('formatRecapLine — excerpts must read as excerpts', () => {
  it('labels a digest and shows its id', () => {
    const line = formatRecapLine({
      senderType: 'agent', senderName: 'pm-agent', messageId: 'e1',
      content: 'Settled on CSV', truncated: true,
    });
    assert.equal(line, '[pm-agent] (excerpt id=e1) Settled on CSV');
  });

  it('still labels a digest that arrived without an id', () => {
    const line = formatRecapLine({
      senderType: 'agent', senderName: 'pm-agent',
      content: 'Settled on CSV', truncated: true,
    });
    assert.equal(line, '[pm-agent] (excerpt) Settled on CSV');
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
      '[pm-agent] (excerpt id=e2) Settled on CSV',
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

    assert.match(recap, /first line of a turn/);
    assert.match(recap, /not a summary of it/,
      'the label must not oversell what an excerpt is');
    assert.match(recap, /workspace_expand_message/);
    assert.match(recap, /\[pm-agent\] \(excerpt id=e2\) Settled on CSV/);
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
// Expansion capability gate
// ---------------------------------------------------------------------------

describe('contextViewFor — only readers that can expand get excerpts', () => {
  const mk = (Cls, opts = {}) => new Cls({
    workspaceId: 'ws-1', channelName: 'general', token: 'tok',
    agentName: 'rd-agent', ...opts,
  });

  it('Claude opts in — both tool modes can pull a message back in full', () => {
    assert.equal(mk(ClaudeAdapter, { toolMode: 'mcp' }).contextViewFor(), 'rd-agent');
    assert.equal(mk(ClaudeAdapter, { toolMode: 'skills' }).contextViewFor(), 'rd-agent');
  });

  it('Cursor opts in — its SKILL.md carries the expand curl', () => {
    assert.equal(mk(CursorAdapter).contextViewFor(), 'rd-agent');
  });

  it('Cline does not — it has no MCP server and no workspace skill', () => {
    const cline = mk(ClineAdapter);
    assert.equal(cline.supportsContextExpansion, false);
    assert.equal(cline.contextViewFor(), null,
      'an excerpt it cannot expand would be deletion, not reduction');
  });

  it('defaults to no expansion, so a new adapter is not silently opted in', () => {
    const BaseAdapter = require('../src/adapters/base');
    assert.equal(mk(BaseAdapter).contextViewFor(), null);
  });

  it('Cline therefore asks for the unprojected stream', async () => {
    const calls = [];
    const cline = mk(ClineAdapter);
    cline.client = {
      getRecentMessages: async (ws, ch, tok, limit, opts = {}) => { calls.push(opts); return []; },
    };

    await cline._buildChannelRecap('general', 'now');

    assert.deepEqual(calls, [{ viewFor: null }]);
  });
});

// ---------------------------------------------------------------------------
// Context policy switch
// ---------------------------------------------------------------------------

describe('context policy change detection', () => {
  const mkBase = () => {
    const BaseAdapter = require('../src/adapters/base');
    const a = new BaseAdapter({
      workspaceId: `ws-${Math.random().toString(36).slice(2)}`,
      channelName: 'general', token: 'tok', agentName: 'rd-agent',
    });
    // Keep the baseline in memory — these tests are about the comparison,
    // not about the file.
    a._contextPolicy = {};
    a._saveContextPolicy = () => {};
    return a;
  };

  it('a channel with no recorded baseline is not a change', () => {
    const a = mkBase();
    assert.equal(a.contextPolicyChanged('general', 'projected'), false);
  });

  it('detects a switch in both directions', () => {
    const a = mkBase();
    a.recordContextPolicy('general', 'shared');
    assert.equal(a.contextPolicyChanged('general', 'projected'), true);
    a.recordContextPolicy('general', 'projected');
    assert.equal(a.contextPolicyChanged('general', 'shared'), true);
  });

  it('is not a change when the mode is unchanged', () => {
    const a = mkBase();
    a.recordContextPolicy('general', 'projected');
    assert.equal(a.contextPolicyChanged('general', 'projected'), false);
  });

  it('treats an unknown mode as unchanged so a hiccup keeps the session', () => {
    const a = mkBase();
    a.recordContextPolicy('general', 'projected');
    assert.equal(a.contextPolicyChanged('general', null), false);
  });

  it('tracks channels independently', () => {
    const a = mkBase();
    a.recordContextPolicy('chan-a', 'shared');
    assert.equal(a.contextPolicyChanged('chan-b', 'projected'), false);
    assert.equal(a.contextPolicyChanged('chan-a', 'projected'), true);
  });

  it('fetchContextMode reports null (unknown) when the lookup fails', async () => {
    const a = mkBase();
    a.client = { getContextMode: async () => { throw new Error('offline'); } };
    assert.equal(await a.fetchContextMode('general'), null);
  });

  it('fetchContextMode defaults to shared when the server omits the field', async () => {
    const a = mkBase();
    a.client = { getContextMode: async () => 'shared' };
    assert.equal(await a.fetchContextMode('general'), 'shared');
  });

  // Regression: this used to go through getSession, which swallows failures
  // and returns a fallback object with no contextMode on it. Reading the
  // field off that fallback yielded 'shared', so on a projected channel a
  // single dropped request looked like a switch and threw away a healthy
  // session. Exercised against the real client + a dead server, because
  // stubbing fetchContextMode is exactly what hid the bug before.
  it('a network failure does not masquerade as a switch to shared', async () => {
    const BaseAdapter = require('../src/adapters/base');
    const a = new BaseAdapter({
      workspaceId: 'ws-1', channelName: 'general', token: 'tok', agentName: 'rd-agent',
      endpoint: 'http://127.0.0.1:1',  // nothing listening
    });
    a._contextPolicy = {};
    a._saveContextPolicy = () => {};
    a.recordContextPolicy('general', 'projected');

    const mode = await a.fetchContextMode('general');

    assert.equal(mode, null, 'an unreachable server is unknown, not shared');
    assert.equal(a.contextPolicyChanged('general', mode), false,
      'a dropped packet must not cost the channel its session');
  });

  it('getContextMode propagates failures instead of returning a fallback', async () => {
    const client = new WorkspaceClient('http://127.0.0.1:1');
    await assert.rejects(() => client.getContextMode('ws-1', 'general', 'tok'));
    // ...while getSession still swallows, which is why they are separate.
    const info = await client.getSession('ws-1', 'general', 'tok');
    assert.equal(info.contextMode, undefined);
  });

  it('getContextMode reads the field and defaults to shared', async () => {
    await withServer(() => ({ json: { code: 200, data: { contextMode: 'projected' } } }),
      async (client) => {
        assert.equal(await client.getContextMode('ws-1', 'general', 'tok'), 'projected');
      });
    await withServer(() => ({ json: { code: 200, data: { title: 't' } } }),
      async (client) => {
        assert.equal(await client.getContextMode('ws-1', 'general', 'tok'), 'shared');
      });
  });
});

describe('CursorAdapter rebuilds context when the policy switches', () => {
  function mkCursor() {
    const adapter = new CursorAdapter({
      workspaceId: `ws-${Math.random().toString(36).slice(2)}`,
      channelName: 'general', token: 'tok', agentName: 'rd-agent',
    });
    adapter._saveSessions = () => {};
    adapter._contextPolicy = {};
    adapter._saveContextPolicy = () => {};
    adapter._titledSessions.add('general');
    adapter.sendStatus = async () => {};
    adapter.sendResponse = async () => {};
    adapter.sendError = async () => {};
    adapter.getRemainingTodos = async () => [];
    adapter._writeSkillFile = () => {};
    adapter._buildChannelRecap = async () => 'RECAP';
    adapter.prompts = [];
    adapter._buildCursorCmd = (prompt) => { adapter.prompts.push(prompt); return ['cursor']; };
    adapter._resolveToNodeCmd = () => null;
    adapter._runProcess = async () => ({ ok: true });
    adapter._spawnAndStream = async () => ({ ok: true });
    return adapter;
  }

  // Regression: the session was dropped on a policy switch, but Cursor only
  // builds a recap on a RETRY (attempt > 0). The first attempt therefore
  // started a blank session with just the incoming message — the switch cost
  // the thread its context instead of rebuilding it under the new policy.
  it('injects a recap on the first attempt after a switch', async () => {
    const adapter = mkCursor();
    adapter.recordContextPolicy('general', 'shared');
    adapter._channelSessions.general = 'sess-1';
    adapter.fetchContextMode = async () => 'projected';

    try {
      await adapter._handleMessage({ content: 'hi', sessionId: 'general' });
    } catch { /* the spawn path is stubbed out; only the prompt matters */ }

    assert.equal(adapter._channelSessions.general, undefined, 'session dropped');
    assert.ok(adapter.prompts.length > 0, 'a command was built');
    assert.ok(adapter.prompts[0].startsWith('RECAP'),
      'the first attempt must carry rebuilt context, not start blank');
  });

  it('leaves the first attempt alone when the policy did not change', async () => {
    const adapter = mkCursor();
    adapter.recordContextPolicy('general', 'projected');
    adapter._channelSessions.general = 'sess-1';
    adapter.fetchContextMode = async () => 'projected';

    try {
      await adapter._handleMessage({ content: 'hi', sessionId: 'general' });
    } catch { /* as above */ }

    assert.equal(adapter._channelSessions.general, 'sess-1');
    assert.ok(adapter.prompts.length > 0);
    assert.ok(!adapter.prompts[0].startsWith('RECAP'));
  });
});

describe('ClaudeAdapter drops a session polluted under the old policy', () => {
  function mkClaude() {
    const adapter = new ClaudeAdapter({
      workspaceId: `ws-${Math.random().toString(36).slice(2)}`,
      channelName: 'general', token: 'tok', agentName: 'rd-agent',
    });
    adapter._saveSessions = () => {};
    adapter._contextPolicy = {};
    adapter._saveContextPolicy = () => {};
    adapter.statuses = [];
    adapter.sendStatus = async (ch, t) => { adapter.statuses.push(t); };
    adapter.sendResponse = async () => {};
    adapter.sendError = async () => {};
    adapter.sendThinking = async () => {};
    adapter.getRemainingTodos = async () => [];
    adapter.getBrowserEnabled = async () => false;
    adapter._resetIdleTimer = () => {};
    adapter._titledSessions.add('general');
    adapter._fetchDecisionLog = async () => ({
      available: false, state: 'unknown', entryId: null, content: null, error: false,
    });
    adapter._buildChannelRecap = async () => 'RECAP';
    adapter._buildClaudeCmd = () => ({ cmd: ['claude'], mcpConfigFile: null });
    adapter._killPersistentProc = (ch) => { delete adapter._persistentProcs[ch]; };
    adapter._spawnPersistentProc = () => ({
      alive: true, msgChannel: 'general', lastResponseText: ['ok'],
      everPostedAnything: true, userStopped: false, lastErrorText: '',
    });
    adapter._sendToPersistentProc = async () => ({ resultEvent: {} });
    adapter._postTurnOutcome = async () => {};
    adapter._queueTodoNudge = async () => {};
    return adapter;
  }

  it('drops the session and announces it when the channel switches', async () => {
    const adapter = mkClaude();
    adapter.recordContextPolicy('general', 'shared');
    adapter._channelSessions.general = 'sess-1';
    adapter.fetchContextMode = async () => 'projected';

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(adapter._channelSessions.general, undefined,
      'the resumed transcript predates the switch and must not survive it');
    assert.ok(adapter.statuses.some((s) => /Context isolation enabled/i.test(s)));
  });

  it('keeps the session when the policy is unchanged', async () => {
    const adapter = mkClaude();
    adapter.recordContextPolicy('general', 'projected');
    adapter._channelSessions.general = 'sess-1';
    adapter.fetchContextMode = async () => 'projected';

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(adapter._channelSessions.general, 'sess-1');
  });

  it('keeps the session when the mode lookup fails', async () => {
    const adapter = mkClaude();
    adapter.recordContextPolicy('general', 'projected');
    adapter._channelSessions.general = 'sess-1';
    adapter.fetchContextMode = async () => null;

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(adapter._channelSessions.general, 'sess-1');
  });

  it('announces the reverse switch too', async () => {
    const adapter = mkClaude();
    adapter.recordContextPolicy('general', 'projected');
    adapter._channelSessions.general = 'sess-1';
    adapter.fetchContextMode = async () => 'shared';

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(adapter._channelSessions.general, undefined);
    assert.ok(adapter.statuses.some((s) => /Context isolation disabled/i.test(s)));
  });
});

// ---------------------------------------------------------------------------
// Skill docs
// ---------------------------------------------------------------------------

describe('workspace skill curl docs', () => {
  const build = (agentName) => buildApiSkillsPrompt({
    endpoint: 'https://api.example.com', workspaceId: 'ws-1',
    token: 'tok', agentName, channelName: 'general',
    disabledModules: new Set(), isWindows: false,
  });

  it('percent-encodes the agent name into view_for', () => {
    // Agent names are only pattern-validated on the cloud-agent path, so a
    // name with `&` or a space can reach here and must not be able to
    // truncate the identity or graft on another query parameter.
    const doc = build('rd agent&limit=1');
    assert.ok(doc.includes('view_for=rd%20agent%26limit%3D1'));
    assert.ok(!doc.includes('view_for=rd agent&limit=1'));
  });

  it('leaves an ordinary name readable', () => {
    assert.ok(build('rd-agent').includes('view_for=rd-agent'));
  });

  it('documents how to expand an excerpt', () => {
    const doc = build('rd-agent');
    assert.ok(doc.includes('/v1/events/EVENT_ID'));
    assert.match(doc, /an excerpt is the first line, not a\s+summary/i);
    assert.match(doc, /never treat it as the whole turn/i);
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
    assert.match(out, /\[pm-agent\] \(excerpt id=e2\) Settled on CSV/);
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
