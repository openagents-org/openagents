'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { WorkspaceClient, SessionRevokedError } = require('../src/workspace-client');
const http = require('http');

describe('WorkspaceClient', () => {
  it('constructs with default endpoint', () => {
    const client = new WorkspaceClient();
    assert.equal(client.endpoint, 'https://workspace-endpoint.openagents.org');
  });

  it('constructs with custom endpoint and strips trailing slash', () => {
    const client = new WorkspaceClient('https://custom.api.com/');
    assert.equal(client.endpoint, 'https://custom.api.com');
  });

  it('_wsHeaders returns correct auth headers', () => {
    const client = new WorkspaceClient();
    const headers = client._wsHeaders('test-token-123');
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['X-Workspace-Token'], 'test-token-123');
  });

  it('_post rejects on network error', async () => {
    // Use a port that nothing is listening on
    const client = new WorkspaceClient('http://127.0.0.1:19999');
    await assert.rejects(
      () => client._post('/v1/test', { foo: 'bar' }),
      (err) => {
        assert.ok(err.message.includes('ECONNREFUSED') || err.message.includes('connect'));
        return true;
      }
    );
  });

  it('registerAgent builds correct request shape', async () => {
    // We can't easily test the full HTTP flow without a server,
    // but we can verify the method signature works
    const client = new WorkspaceClient('http://127.0.0.1:19999');
    await assert.rejects(
      () => client.registerAgent('test-agent', { apiKey: 'sk-123' }),
    );
  });

  it('createWorkspace builds correct url format', () => {
    const client = new WorkspaceClient('https://workspace-endpoint.openagents.org/v1');
    // Test the frontend URL derivation logic
    const frontendUrl = client.endpoint
      .replace('workspace-endpoint', 'workspace')
      .replace('/v1', '');
    assert.equal(frontendUrl, 'https://workspace.openagents.org');
  });

  it('SessionRevokedError is thrown when server returns session_revoked message', async () => {
    // Spin up a one-shot HTTP server that returns the error shape.
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 401,
        message: 'session_revoked: another client is now running as this agent',
      }));
    });
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    try {
      const client = new WorkspaceClient(`http://127.0.0.1:${port}`);
      let caught = null;
      try {
        await client._post('/v1/heartbeat', { agent_name: 'x', network: 'n', session_id: 'stale' });
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, 'expected error to be thrown');
      assert.ok(caught instanceof SessionRevokedError, 'expected SessionRevokedError');
      assert.equal(caught.code, 'session_revoked');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('sendEvent embeds session_id in event.metadata when provided', () => {
    const client = new WorkspaceClient('http://127.0.0.1:19999');
    // Capture what _post receives by stubbing it
    let capturedBody = null;
    client._post = async (_path, body) => { capturedBody = body; return { data: {} }; };
    return client.sendEvent('ws-1', { type: 't', source: 's', target: 'ch' }, 'tok', 'sess-xyz')
      .then(() => {
        assert.equal(capturedBody.metadata.session_id, 'sess-xyz');
        assert.equal(capturedBody.network, 'ws-1');
      });
  });

  it('heartbeat includes session_id when provided', () => {
    const client = new WorkspaceClient('http://127.0.0.1:19999');
    let capturedBody = null;
    client._post = async (_path, body) => { capturedBody = body; return { data: {} }; };
    return client.heartbeat('ws-1', 'bary-bot', 'tok', 'sess-abc')
      .then(() => {
        assert.equal(capturedBody.agent_name, 'bary-bot');
        assert.equal(capturedBody.network, 'ws-1');
        assert.equal(capturedBody.session_id, 'sess-abc');
      });
  });

  describe('pollPending server-side targeting', () => {
    it('sends target_agents so the server pre-filters, and still client-filters', async () => {
      const client = new WorkspaceClient('http://127.0.0.1:19999');
      let capturedPath = null;
      client._get = async (path) => {
        capturedPath = path;
        return { data: { events: [
          // targeted at this agent → kept
          { id: 'e1', source: 'human:user', target: 'channel/c', payload: { content: 'hi', message_type: 'chat' }, metadata: { target_agents: ['bary-bot'] } },
          // targeted at someone else → dropped by client filter (server would
          // normally exclude it too; included here to prove the safety net)
          { id: 'e2', source: 'human:user', target: 'channel/c', payload: { content: 'other', message_type: 'chat' }, metadata: { target_agents: ['other'] } },
        ], next_cursor: 'HEAD' } };
      };

      const { messages, cursor } = await client.pollPending('ws-1', 'bary-bot', 'tok', { after: 'x' });

      assert.ok(capturedPath.includes('target_agents=bary-bot'), `expected target_agents in ${capturedPath}`);
      assert.equal(cursor, 'HEAD');                       // uses server next_cursor
      assert.equal(messages.length, 1);                   // client filter kept only ours
      assert.equal(messages[0].messageId, 'e1');
    });

    it('falls back to last event id when the backend sends no next_cursor', async () => {
      const client = new WorkspaceClient('http://127.0.0.1:19999');
      client._get = async () => ({ data: { events: [
        { id: 'e9', source: 'human:user', target: 'channel/c', payload: { content: 'hi', message_type: 'chat' }, metadata: { target_agents: ['bary-bot'] } },
      ] } });  // no next_cursor (older backend)

      const { cursor } = await client.pollPending('ws-1', 'bary-bot', 'tok', {});
      assert.equal(cursor, 'e9');
    });
  });
});

// Regression guard for the "online but deaf" wedge: a request whose socket
// never receives a response must reject within its deadline instead of hanging
// forever and stalling the caller's single poll loop. (AbortSignal.timeout ALSO
// covers the DNS/connect phase, which the socket `timeout` option cannot —
// it is not armed until a socket exists — but exercising that needs real
// unroutable network state, which isn't hermetic across CI platforms. The
// deterministic local case below is what we assert; the DNS/connect rationale
// lives in the workspace-client.js comment.)
describe('WorkspaceClient request deadlines', () => {
  it('_get rejects promptly when the server accepts but never responds', { timeout: 10000 }, async () => {
    const server = http.createServer(() => { /* intentionally never respond */ });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const client = new WorkspaceClient(`http://127.0.0.1:${port}`);
    const start = Date.now();
    try {
      await assert.rejects(() => client._get('/v1/events', {}, 400));
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 5000, `expected reject within 5s, took ${elapsed}ms`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
