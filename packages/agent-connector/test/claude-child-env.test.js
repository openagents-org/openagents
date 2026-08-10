const { test, describe } = require('node:test');
const assert = require('node:assert');

const ClaudeAdapter = require('../src/adapters/claude');

const build = (env) => ClaudeAdapter._buildChildEnv(env);

describe('ClaudeAdapter._buildChildEnv — SDK-harness stripping', () => {
  test('drops the variables that push the CLI onto the org-scoped auth path', () => {
    const env = build({
      CLAUDECODE: '1',
      AI_AGENT: 'openagents',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      PATH: '/usr/bin',
    });
    assert.strictEqual(env.CLAUDECODE, undefined);
    assert.strictEqual(env.AI_AGENT, undefined);
    assert.strictEqual(env.CLAUDE_CODE_ENTRYPOINT, undefined);
    assert.strictEqual(env.PATH, '/usr/bin');
  });

  test('keeps the cloud-provider and model config the child needs', () => {
    const env = build({
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_MODEL: 'claude-sonnet-4-6',
      CLAUDE_API_KEY: 'k',
      CLAUDE_CODE_MAX_TURNS: '10',
    });
    assert.strictEqual(env.CLAUDE_CODE_USE_VERTEX, '1');
    assert.strictEqual(env.CLAUDE_CODE_USE_BEDROCK, '1');
    assert.strictEqual(env.CLAUDE_MODEL, 'claude-sonnet-4-6');
    assert.strictEqual(env.CLAUDE_API_KEY, 'k');
    assert.strictEqual(env.CLAUDE_CODE_MAX_TURNS, '10');
  });

  // The credential a Pro/Max user pastes in from `claude setup-token`. It was
  // being swept up by the CLAUDE_* strip, so the CLI ran with no credential at
  // all and failed as if nothing had been configured.
  test('keeps the subscription token — it IS the credential, not harness noise', () => {
    const env = build({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abc' });
    assert.strictEqual(env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-abc');
  });

  test('does not mutate the env it was handed', () => {
    const input = { CLAUDECODE: '1', ANTHROPIC_API_KEY: 'k' };
    build(input);
    assert.strictEqual(input.CLAUDECODE, '1');
  });
});

describe('ClaudeAdapter._buildChildEnv — relay Bearer auth', () => {
  test('mirrors the key into ANTHROPIC_AUTH_TOKEN for a third-party relay', () => {
    const env = build({
      ANTHROPIC_API_KEY: 'sk-relay',
      ANTHROPIC_BASE_URL: 'https://yinli.one',
    });
    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, 'sk-relay');
  });

  test('leaves the official endpoint on x-api-key', () => {
    const env = build({
      ANTHROPIC_API_KEY: 'sk-official',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    });
    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, undefined);
  });

  test('never overwrites an auth token the user set themselves', () => {
    const env = build({
      ANTHROPIC_API_KEY: 'sk-relay',
      ANTHROPIC_BASE_URL: 'https://relay.example',
      ANTHROPIC_AUTH_TOKEN: 'explicit',
    });
    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, 'explicit');
  });

  test('a malformed base URL is treated as non-official, not as a crash', () => {
    const env = build({
      ANTHROPIC_API_KEY: 'sk-relay',
      ANTHROPIC_BASE_URL: 'not a url',
    });
    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, 'sk-relay');
  });

  test('no key means nothing to mirror', () => {
    const env = build({ ANTHROPIC_BASE_URL: 'https://relay.example' });
    assert.strictEqual(env.ANTHROPIC_AUTH_TOKEN, undefined);
  });
});
