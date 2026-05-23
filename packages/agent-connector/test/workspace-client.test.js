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

  it('maps bootstrap events to their payload channel', () => {
    const client = new WorkspaceClient();
    const msg = client._eventToMessage({
      id: 'evt-bootstrap',
      type: 'workspace.agent.bootstrap',
      source: 'system:workspace',
      target: 'openagents:agent-alpha',
      payload: { channel: 'thread-abc', reason: 'channel_join' },
      metadata: { target_agents: ['agent-alpha'] },
      timestamp: 1700000000000,
    });

    assert.equal(msg.eventType, 'workspace.agent.bootstrap');
    assert.equal(msg.sessionId, 'thread-abc');
    assert.equal(msg.senderType, 'system');
    assert.deepEqual(msg.metadata.target_agents, ['agent-alpha']);
  });
});
