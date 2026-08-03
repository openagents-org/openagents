'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeClaudeEnv } = require('../src/adapters/claude');

describe('sanitizeClaudeEnv', () => {
  it('strips the harness markers that trigger the org-scoped auth path', () => {
    const out = sanitizeClaudeEnv({
      CLAUDECODE: '1',
      AI_AGENT: 'claude',
      CLAUDE_CODE_ENTRYPOINT: 'sdk',
      PATH: '/usr/bin',
    });
    assert.equal(out.CLAUDECODE, undefined);
    assert.equal(out.AI_AGENT, undefined);
    assert.equal(out.CLAUDE_CODE_ENTRYPOINT, undefined);
    assert.equal(out.PATH, '/usr/bin');
  });

  it('keeps cloud provider and model configuration', () => {
    const out = sanitizeClaudeEnv({
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_MODEL: 'claude-sonnet-4-5',
      CLAUDE_API_KEY: 'sk-test',
      CLAUDE_CODE_MAX_TURNS: '10',
    });
    assert.equal(out.CLAUDE_CODE_USE_VERTEX, '1');
    assert.equal(out.CLAUDE_CODE_USE_BEDROCK, '1');
    assert.equal(out.CLAUDE_MODEL, 'claude-sonnet-4-5');
    assert.equal(out.CLAUDE_API_KEY, 'sk-test');
    assert.equal(out.CLAUDE_CODE_MAX_TURNS, '10');
  });

  it('keeps CLAUDE_CODE_OAUTH_TOKEN so subscription auth reaches the agent', () => {
    const out = sanitizeClaudeEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-test' });
    assert.equal(out.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-test');
  });

  it('leaves unrelated variables alone', () => {
    const out = sanitizeClaudeEnv({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_AUTH_TOKEN: 'bearer-test',
      ANTHROPIC_BASE_URL: 'https://relay.example.com',
      HOME: '/home/agent',
    });
    assert.deepEqual(out, {
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_AUTH_TOKEN: 'bearer-test',
      ANTHROPIC_BASE_URL: 'https://relay.example.com',
      HOME: '/home/agent',
    });
  });

  it('does not mutate the source object', () => {
    const source = { CLAUDECODE: '1', PATH: '/usr/bin' };
    sanitizeClaudeEnv(source);
    assert.equal(source.CLAUDECODE, '1');
  });
});
