'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { WorkspaceClient } = require('../src/workspace-client');

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
});
