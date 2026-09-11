'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { probeAgentType, classifyFailure, buildGuidance, scrub, killTree, CODE } = require('../src/probe');

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

/**
 * The timeout is the only thing that ends a probe's child. On Windows a plain
 * kill ended just the shell a .cmd probe runs under, so whatever that shell had
 * started lived on — once, an endless chain of pwsh processes.
 */
describe('killTree', () => {
  it('takes the whole process tree on Windows, not just the shell', () => {
    const calls = [];
    let signalled = false;
    killTree({ pid: 4242, kill: () => { signalled = true; } }, 'win32', (file, args) => { calls.push([file, ...args]); });
    assert.deepEqual(calls, [['taskkill', '/F', '/T', '/PID', '4242']]);
    assert.equal(signalled, false);
  });

  it('falls back to killing the child when taskkill fails', () => {
    let signal = null;
    killTree({ pid: 4242, kill: (s) => { signal = s; } }, 'win32', () => { throw new Error('no taskkill'); });
    assert.equal(signal, 'SIGKILL');
  });

  it('signals the child directly off Windows', () => {
    let signal = null;
    killTree({ pid: 4242, kill: (s) => { signal = s; } }, 'linux', () => { throw new Error('must not run'); });
    assert.equal(signal, 'SIGKILL');
  });
});

/**
 * A CLI that hangs tells you nothing. The endpoint always knows why.
 *
 * Seen live: a relay answering 403 "预扣费额度失败" made Claude Code retry in
 * silence for its whole 120s, leaving the probe with a timeout and an
 * unrelated stderr warning — which the guidance read as "it may be waiting for
 * a login prompt", sending the user to a terminal to fix a working install.
 */
describe('a CLI verdict that explains nothing defers to the endpoint', () => {
  // `sleep 5` stands in for a CLI that hangs: the probe's clock is set well
  // below it, so every case here starts from a genuine timeout.
  const ENTRY = {
    name: 'claude',
    label: 'Claude Code CLI',
    probe: { args: ['5'], timeout_s: 1 },
  };

  /** Stand in for the HTTP client probe.js lazily requires. */
  function withLLM(answer, run) {
    const path = require.resolve('../src/utils');
    const original = require.cache[path];
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: { testLLMConnection: async () => answer },
    };
    return run().finally(() => {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    });
  }

  const hanging = fakeConnector({
    entry: ENTRY,
    health: { installed: true, ready: true, binary: 'sleep' },
    env: { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BASE_URL: 'https://relay.example' },
  });

  it('reports the real reason the endpoint gives, not the timeout', async () => {
    const answer = {
      success: false,
      error: 'HTTP 403: 预扣费额度失败, 用户剩余额度: $1.73, 需要预扣费额度: $3.50',
    };
    const r = await withLLM(answer, () => probeAgentType(hanging, 'claude', { timeoutMs: 400 }));

    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.OUT_OF_CREDIT);
    assert.equal(r.method, 'llm_api');
    // The guidance the user acts on must be about money, not about terminals.
    assert.match(r.guidance.join(' '), /credit|quota/i);
    assert.doesNotMatch(r.guidance.join(' '), /interactive input|waiting/i);
  });

  it('keeps the CLI verdict when the endpoint is healthy', async () => {
    // The endpoint answering means the CLI's own trouble is real and still
    // unexplained; "everything is fine" would be a worse answer than vague.
    const r = await withLLM({ success: true, response: 'hi' }, () =>
      probeAgentType(hanging, 'claude', { timeoutMs: 400 }),
    );

    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.TIMEOUT);
    assert.equal(r.method, 'cli');
  });

  it('keeps the CLI verdict when the endpoint fails just as vaguely', async () => {
    const r = await withLLM({ success: false, error: 'something went wrong' }, () =>
      probeAgentType(hanging, 'claude', { timeoutMs: 400 }),
    );

    assert.equal(r.method, 'cli');
    assert.equal(r.code, CODE.TIMEOUT);
  });

  it('does not call the endpoint for an agent with no key', async () => {
    let called = false;
    const keyless = fakeConnector({
      entry: ENTRY,
      health: { installed: true, ready: true, binary: 'sleep' },
      env: {},
    });
    const path = require.resolve('../src/utils');
    const original = require.cache[path];
    require.cache[path] = {
      id: path, filename: path, loaded: true,
      exports: { testLLMConnection: async () => { called = true; return { success: false }; } },
    };
    try {
      const r = await probeAgentType(keyless, 'claude', { timeoutMs: 400 });
      assert.equal(called, false);
      assert.equal(r.method, 'cli');
    } finally {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
  });
});

describe('out-of-credit is not only an English 402', () => {
  it('reads a relay saying it in Chinese, and at 403', () => {
    // The relay this came from answers 403 with its own wording; the original
    // pattern matched neither, so it fell through to "invalid credentials" —
    // which sends the user to re-authenticate a key that works.
    assert.equal(
      classifyFailure('HTTP 403: 预扣费额度失败, 用户剩余额度: $1.73'),
      CODE.OUT_OF_CREDIT,
    );
    assert.equal(classifyFailure('余额不足，请充值'), CODE.OUT_OF_CREDIT);
    assert.equal(classifyFailure('You exceeded your current quota'), CODE.OUT_OF_CREDIT);
  });

  it('still reads the English wording it always did', () => {
    assert.equal(classifyFailure('Your credit balance is too low'), CODE.OUT_OF_CREDIT);
    assert.equal(classifyFailure('402 payment required'), CODE.OUT_OF_CREDIT);
  });
});
