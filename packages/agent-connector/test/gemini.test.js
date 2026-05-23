'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const GeminiAdapter = require('../src/adapters/gemini');

describe('GeminiAdapter', () => {
  it('builds runtime env for Gemini subprocesses', () => {
    const adapter = new GeminiAdapter({
      workspaceId: 'workspace-123',
      channelName: 'general',
      token: 'token-123',
      agentName: 'gemini-agent',
      agentType: 'gemini',
      agentEnv: { GEMINI_API_KEY: 'key-123' },
    });

    const env = adapter._buildGeminiEnv('thread-abc');

    assert.equal(env.GEMINI_API_KEY, 'key-123');
    assert.equal(env.OPENAGENTS_WORKSPACE_ID, 'workspace-123');
    assert.equal(env.OPENAGENTS_CHANNEL_NAME, 'thread-abc');
    assert.equal(env.OPENAGENTS_AGENT_NAME, 'gemini-agent');
    assert.equal(env.OPENAGENTS_AGENT_TYPE, 'gemini');
    assert.equal(env.OA_WORKSPACE_TOKEN, 'token-123');
  });
});
