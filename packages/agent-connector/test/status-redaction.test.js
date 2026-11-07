'use strict';

/**
 * Status messages ("Bash › curl ...") quote the tool call the CLI is making,
 * and that call can carry this agent's own workspace token. sendStatus is the
 * single path to the channel for them, so it has to redact.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');

const TOKEN = 'wsTokenValue1234567890';

function makeAdapter() {
  const sent = [];
  const adapter = new BaseAdapter({
    workspaceId: 'ws1',
    channelName: 'general',
    endpoint: 'https://example.test',
    token: TOKEN,
    agentName: 'agent',
    disabledModules: new Set(),
  });
  adapter.client = { sendMessage: async (_ws, _ch, _tok, content) => { sent.push(content); } };
  return { adapter, sent };
}

describe('BaseAdapter.sendStatus redaction', () => {
  it('masks the workspace token in a tool-call preview', async () => {
    const { adapter, sent } = makeAdapter();
    await adapter.sendStatus('ch', `Bash › curl -H "X-Workspace-Token: ${TOKEN}" https://example.test/v1`);
    assert.equal(sent.length, 1);
    assert.ok(!sent[0].includes(TOKEN), sent[0]);
    assert.match(sent[0], /\[REDACTED\]/);
  });

  it('leaves ordinary status text alone', async () => {
    const { adapter, sent } = makeAdapter();
    await adapter.sendStatus('ch', 'thinking...');
    assert.deepEqual(sent, ['thinking...']);
  });
});
