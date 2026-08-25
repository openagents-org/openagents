'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { probeAgentType, classifyFailure, buildGuidance, scrub, CODE } = require('../src/probe');

// A minimal fake connector: registry entry + health + env are all injectable
// so no real CLI or network is touched.
function fakeConnector({ entry, health, env = {} }) {
  return {
    registry: { getEntry: (t) => (entry && entry.name === t ? entry : null) },
    healthCheck: () => health,
    getAgentEnv: () => env,
    resolveAgentEnv: () => ({}),
  };
}

describe('classifyFailure', () => {
  it('maps provider auth errors to invalid_api_key', () => {
    assert.equal(classifyFailure('API Error: 401 authentication_error invalid x-api-key'), CODE.INVALID_API_KEY);
    assert.equal(classifyFailure('Error: Unauthorized'), CODE.INVALID_API_KEY);
  });

  it('maps missing-key wording to missing_api_key', () => {
    assert.equal(classifyFailure('ANTHROPIC_API_KEY environment variable is not set'), CODE.MISSING_API_KEY);
    assert.equal(classifyFailure('No API key provided'), CODE.MISSING_API_KEY);
  });

  it('maps login prompts to not_logged_in', () => {
    assert.equal(classifyFailure('You are not logged in. Please run /login'), CODE.NOT_LOGGED_IN);
    assert.equal(classifyFailure('Not authenticated. Run: claude login'), CODE.NOT_LOGGED_IN);
  });

  it('maps credit / rate / network problems distinctly', () => {
    assert.equal(classifyFailure('Your credit balance is too low'), CODE.OUT_OF_CREDIT);
    assert.equal(classifyFailure('429 Too Many Requests'), CODE.RATE_LIMITED);
    assert.equal(classifyFailure('getaddrinfo ENOTFOUND api.anthropic.com'), CODE.NETWORK);
  });

  it('prefers credit/rate/network over the generic 4xx auth match', () => {
    // "402 payment required" contains no auth wording; make sure the order
    // holds even when both families of patterns could fire.
    assert.equal(classifyFailure('401 unauthorized: rate limit exceeded'), CODE.RATE_LIMITED);
  });

  it('flags timeouts and dead binaries via flags, not text', () => {
    assert.equal(classifyFailure('', { timedOut: true }), CODE.TIMEOUT);
    assert.equal(classifyFailure('', { spawnError: 'spawn claude ENOENT' }), CODE.NOT_INSTALLED);
  });

  it('a timeout whose output names a real API error classifies as THAT error', () => {
    // Claude Code retries hard API failures until the probe clock runs out —
    // observed live: invalid key → the relay's 429 sat in the output while the
    // probe said "may be waiting for interactive input".
    assert.equal(
      classifyFailure('API Error: Request rejected (429) · wait 120s', { timedOut: true }),
      CODE.RATE_LIMITED,
    );
    assert.equal(
      classifyFailure('[claude-code:unrecognized_model] {"model":"claude-x"}', { timedOut: true }),
      CODE.BAD_MODEL,
    );
    // No recognizable error in the output → still a genuine timeout.
    assert.equal(classifyFailure('still working...', { timedOut: true }), CODE.TIMEOUT);
  });

  it('classifies unknown-model errors without a timeout too', () => {
    assert.equal(
      classifyFailure("There's an issue with the selected model (claude-opus-4-6)."),
      CODE.BAD_MODEL,
    );
  });

  it('falls back to cli_error for unrecognized output', () => {
    assert.equal(classifyFailure('segmentation fault'), CODE.CLI_ERROR);
  });
});

describe('scrub', () => {
  it('redacts key-shaped strings from diagnostics', () => {
    const out = scrub('using api key sk-ant-abc123def456ghi789 for request');
    assert.ok(!out.includes('abc123def456'), out);
    assert.ok(out.includes('sk-****'));
    assert.ok(!scrub('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload').includes('eyJhbGci'));
  });
});

describe('buildGuidance', () => {
  const entry = {
    name: 'claude', label: 'Claude Code CLI',
    check_ready: { login_command: 'claude login' },
    env_config: [],
  };

  it('points CLI-login agents at their login command', () => {
    const lines = buildGuidance(CODE.NOT_LOGGED_IN, entry, {});
    assert.ok(lines.some((l) => l.includes('claude login')), lines.join('\n'));
  });

  it('points API-key agents at reconfiguration', () => {
    const keyed = { name: 'openclaw', label: 'OpenClaw', env_config: [{ name: 'LLM_API_KEY' }] };
    const lines = buildGuidance(CODE.INVALID_API_KEY, keyed, { LLM_API_KEY: 'x' });
    assert.ok(lines.some((l) => /API key/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('agn test-llm openclaw')));
  });
});

describe('probeAgentType', () => {
  const baseEntry = { name: 'claude', label: 'Claude Code CLI', check_ready: { login_command: 'claude login' } };

  it('fails fast when the type is unknown', async () => {
    const c = fakeConnector({ entry: null, health: {} });
    const r = await probeAgentType(c, 'nope');
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.UNKNOWN_TYPE);
  });

  it('fails fast with install guidance when not installed', async () => {
    const c = fakeConnector({ entry: baseEntry, health: { installed: false, ready: false } });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.NOT_INSTALLED);
    assert.ok(r.guidance.length > 0);
  });

  it('fails with auth guidance when definitively unconfigured', async () => {
    const c = fakeConnector({
      entry: baseEntry,
      health: { installed: true, ready: false, auth_status: 'no_credentials', message: 'Not logged in. Run: claude login' },
    });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.NOT_READY);
    assert.ok(r.guidance.length > 0);
    assert.equal(r.method, 'none');
  });

  it('runs the declared CLI probe and succeeds on stdout', async () => {
    const entry = {
      name: 'claude', label: 'Claude Code CLI',
      probe: { args: ['hi there'], timeout_s: 30 },
    };
    const c = fakeConnector({
      entry,
      health: { installed: true, ready: true, binary: 'echo' },
    });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.method, 'cli');
    assert.equal(r.reply, 'hi there');
  });

  it('classifies a failing CLI probe and returns guidance', async () => {
    // `node -e` prints an auth-looking error and exits 1 — a realistic stand-in
    // for a CLI whose key was rejected.
    const entry = {
      name: 'claude', label: 'Claude Code CLI',
      check_ready: { login_command: 'claude login' },
      probe: { args: ['-e', 'console.error("API Error: 401 authentication_error"); process.exit(1)'], timeout_s: 30 },
    };
    const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath } });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.INVALID_API_KEY);
    assert.ok(r.guidance.length > 0);
  });

  it('treats exit-0-with-no-output as empty_response', async () => {
    const entry = { name: 'claude', label: 'Claude', probe: { args: ['-e', ''], timeout_s: 30 } };
    const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath } });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.EMPTY_RESPONSE);
  });

  it('kills and reports a hanging CLI as timeout', async () => {
    const entry = { name: 'claude', label: 'Claude', probe: { args: ['-e', 'setTimeout(()=>{}, 60000)'] } };
    const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath } });
    const r = await probeAgentType(c, 'claude', { timeoutMs: 500 });
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.TIMEOUT);
    assert.ok(r.guidance.some((l) => /interactive/.test(l)));
  });

  it('reports static_only when no live probe is possible', async () => {
    const entry = { name: 'mystery', label: 'Mystery' };
    const c = fakeConnector({ entry, health: { installed: true, ready: true } });
    const r = await probeAgentType(c, 'mystery');
    assert.equal(r.ok, true);
    assert.equal(r.code, CODE.STATIC_ONLY);
    assert.equal(r.method, 'none');
  });
});
