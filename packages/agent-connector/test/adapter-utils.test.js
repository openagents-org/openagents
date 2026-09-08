'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');
const { redactSensitiveHeaders } = require('../src/adapters/utils');

describe('redactSensitiveHeaders', () => {
  it('redacts workspace tokens in quoted curl headers', () => {
    const command = 'curl -H "X-Workspace-Token: workspace-secret" https://example.test';
    assert.equal(
      redactSensitiveHeaders(command),
      'curl -H "X-Workspace-Token: [REDACTED]" https://example.test'
    );
  });

  it('redacts authorization schemes and credentials', () => {
    assert.equal(
      redactSensitiveHeaders("curl -H 'Authorization: Bearer bearer-secret'"),
      "curl -H 'Authorization: [REDACTED]'"
    );
    assert.equal(
      redactSensitiveHeaders('Authorization: Basic dXNlcjpwYXNz'),
      'Authorization: [REDACTED]'
    );
  });

  it('redacts generic token and key headers case-insensitively', () => {
    assert.equal(
      redactSensitiveHeaders('X-Auth-Token: abc X-API-Key: def'),
      'X-Auth-Token: [REDACTED] X-API-Key: [REDACTED]'
    );
  });

  it('leaves non-sensitive headers unchanged', () => {
    const command = 'curl -H "Content-Type: application/json" -H "Accept: */*"';
    assert.equal(redactSensitiveHeaders(command), command);
  });

  it('passes through empty and non-string values', () => {
    assert.equal(redactSensitiveHeaders(''), '');
    assert.equal(redactSensitiveHeaders(null), null);
  });

  it('redacts status content before sending it to the workspace', async () => {
    const adapter = new BaseAdapter({
      workspaceId: 'ws',
      channelName: 'main',
      token: 'workspace-token',
      agentName: 'codex',
    });
    let sentContent;
    adapter.client = {
      sendMessage: async (_workspaceId, _channel, _token, content) => {
        sentContent = content;
      },
    };

    await adapter.sendStatus(
      'main',
      '**Running:** `curl -H "X-Workspace-Token: workspace-secret"`'
    );

    assert.equal(
      sentContent,
      '**Running:** `curl -H "X-Workspace-Token: [REDACTED]"`'
    );
  });
});
