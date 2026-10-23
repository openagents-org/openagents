'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { probeAgentType, classifyFailure, buildGuidance, authFlavor, scrub, CODE } = require('../src/probe');

// A minimal fake connector: registry entry + health + env are all injectable
// so no real CLI or network is touched.
function fakeConnector({ entry, health, env = {}, signedInHealth }) {
  return {
    registry: { getEntry: (t) => (entry && entry.name === t ? entry : null) },
    healthCheck: (t, opts) => (opts && opts.cliLogin && signedInHealth ? signedInHealth : health),
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

  it('reads the wordings seen in the field', () => {
    // CodeBuddy signed out.
    assert.equal(classifyFailure('Authentication required. Please use /login command to sign in to your account'), CODE.NOT_LOGGED_IN);
    // A one-api style relay with no channel for the model.
    assert.equal(
      classifyFailure('HTTP 503: {"error":{"code":"model_not_found","message":"No available channel for model"}}'),
      CODE.BAD_MODEL,
    );
    // A Claude Code sign-in that ran out.
    assert.equal(
      classifyFailure('Failed to authenticate: OAuth session expired and could not be refreshed'),
      CODE.SESSION_EXPIRED,
    );
    // A LiteLLM-style relay rejecting the model.
    assert.equal(
      classifyFailure('HTTP 400: {"error":{"message":"/chat/completions: Invalid model name passed in model=gpt-4o-mini"}}'),
      CODE.BAD_MODEL,
    );
    // A provider having a bad minute.
    assert.equal(
      classifyFailure('504 {"error_description":"API key **** service temporarily unavailable"}'),
      CODE.SERVICE_UNAVAILABLE,
    );
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

  it('reads an agent on its own type key as keyed, not signed in', () => {
    const kimi = {
      name: 'kimi', label: 'Kimi Code CLI',
      check_ready: { login_command: 'kimi login', env_vars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'], saved_env_key: 'KIMI_API_KEY' },
      env_config: [{ name: 'KIMI_API_KEY', password: true }],
    };
    assert.equal(authFlavor(kimi, { KIMI_API_KEY: 'sk-x' }), 'api_key');
    assert.equal(authFlavor(kimi, {}), 'cli_login');
    const lines = buildGuidance(CODE.INVALID_API_KEY, kimi, { KIMI_API_KEY: 'sk-x' });
    assert.ok(!lines.some((l) => l.includes('kimi login')), lines.join('\n'));
  });

  it('points API-key agents at reconfiguration', () => {
    const keyed = { name: 'openclaw', label: 'OpenClaw', env_config: [{ name: 'LLM_API_KEY' }] };
    const lines = buildGuidance(CODE.INVALID_API_KEY, keyed, { LLM_API_KEY: 'x' });
    assert.ok(lines.some((l) => /API key/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('agn test-llm openclaw')));
  });

  // The catalog API flattens install commands macOS -> Linux -> Windows with no
  // idea which platform is asking, so a Windows user chasing a missing hermes
  // was handed a `curl … | bash` one-liner that cannot run there.
  it('offers the install command for THIS platform, not the catalog default', () => {
    const hermes = {
      name: 'hermes',
      label: 'Hermes Agent',
      install_command: 'curl -fsSL https://example.test/install.sh | bash',
      install: {
        binary: 'hermes',
        macos: 'curl -fsSL https://example.test/install.sh | bash',
        linux: 'curl -fsSL https://example.test/install.sh | bash',
        windows: 'powershell -NoProfile -Command "irm https://example.test/install.ps1 | iex"',
      },
    };
    const lines = buildGuidance(CODE.NOT_INSTALLED, hermes, {});
    const manual = lines.find((l) => l.startsWith('Or install manually: '));
    assert.ok(manual, lines.join('\n'));
    const expected = process.platform === 'win32' ? hermes.install.windows
      : process.platform === 'darwin' ? hermes.install.macos
        : hermes.install.linux;
    assert.equal(manual, `Or install manually: ${expected}`);
  });

  it('falls back to the flat catalog field when the entry has no install block', () => {
    const lines = buildGuidance(CODE.NOT_INSTALLED, { name: 'x', label: 'X', install_command: 'npm i -g x' }, {});
    assert.ok(lines.some((l) => l === 'Or install manually: npm i -g x'), lines.join('\n'));
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

  it('probes a signed-in agent without the key saved for its type', async () => {
    const entry = {
      name: 'claude', label: 'Claude',
      probe: { args: ['-e', 'console.log(process.env.LLM_API_KEY || "no-key")'], timeout_s: 30 },
    };
    const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath }, env: { LLM_API_KEY: 'sk-type' } });
    const keyed = await probeAgentType(c, 'claude', { agentEnv: {} });
    assert.notEqual(keyed.reply, 'no-key');
    const signedIn = await probeAgentType(c, 'claude', { agentEnv: { OPENAGENTS_AUTH_MODE: 'cli_login' } });
    assert.equal(signedIn.reply, 'no-key');
  });

  it('judges readiness on the agent\'s own env, not the type\'s alone', async () => {
    // Kimi keyed from the workspace: the key lives on the agent, <type>.env is
    // empty, and the smoke test said "run: kimi login" while chat worked.
    const entry = { name: 'kimi', label: 'Kimi Code CLI', check_ready: { login_command: 'kimi login' } };
    const agentEnv = { LLM_API_KEY: 'sk-agent' };
    let seen;
    const c = fakeConnector({ entry, health: { installed: true, ready: true, auth_mode: 'api_key' } });
    c.healthCheck = (t, opts) => {
      seen = opts && opts.agentEnv;
      return seen && seen.LLM_API_KEY
        ? { installed: true, ready: true, auth_mode: 'api_key' }
        : { installed: true, ready: false, auth_status: 'no_credentials', message: 'run: kimi login' };
    };
    c.resolveAgentEnv = () => ({});
    const r = await probeAgentType(c, 'kimi', { agentEnv, timeoutMs: 50 });
    assert.deepEqual(seen, agentEnv);
    assert.notEqual(r.code, CODE.NOT_READY, JSON.stringify(r));
  });

  it('does not pass a signed-in agent with no live probe on the type key', async () => {
    // Codex declares no probe: the static verdict must be its sign-in's.
    const entry = { name: 'codex', label: 'Codex' };
    const c = fakeConnector({
      entry,
      health: { installed: true, ready: true, auth_mode: 'api_key' },
      signedInHealth: { installed: true, ready: false, auth_status: 'unknown', message: 'Not configured' },
      env: { LLM_API_KEY: 'sk-type' },
    });
    const r = await probeAgentType(c, 'codex', { agentEnv: { OPENAGENTS_AUTH_MODE: 'cli_login' } });
    assert.notEqual(r.ok, true);
    assert.equal(r.method, 'none');
  });

  it('reports a sign-in it could not check as unverified, not failed', async () => {
    const entry = { name: 'codex', label: 'Codex' };
    const c = fakeConnector({
      entry,
      health: { installed: true, ready: false, auth_status: 'unknown', message: 'Not configured' },
    });
    const r = await probeAgentType(c, 'codex');
    assert.equal(r.ok, null);
    assert.equal(r.code, CODE.STATIC_ONLY);
    assert.equal(r.auth_status, 'unknown');
  });

  it('lets the declared live check overrule a static "not logged in"', async () => {
    // Claude signed in where the static checks cannot look (a keychain, a
    // relay set in its own settings.json) answers fine.
    const entry = {
      name: 'claude', label: 'Claude', check_ready: { login_command: 'claude login' },
      probe: { args: ['-e', 'console.log("hello")'], timeout_s: 30 },
    };
    const c = fakeConnector({
      entry,
      health: { installed: true, ready: false, auth_status: 'no_credentials', binary: process.execPath, message: 'Not logged in' },
    });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.method, 'cli');
  });

  it('keeps the static verdict when the live check explains nothing', async () => {
    const entry = {
      name: 'claude', label: 'Claude', check_ready: { login_command: 'claude login' },
      probe: { args: ['-e', 'process.exit(1)'], timeout_s: 30 },
    };
    const c = fakeConnector({
      entry,
      health: { installed: true, ready: false, auth_status: 'no_credentials', binary: process.execPath, message: 'Not logged in. Run: claude login' },
    });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.NOT_READY);
    assert.equal(r.message, 'Not logged in. Run: claude login');
  });

  it('reports the CLI\'s own sign-in error over the static verdict', async () => {
    const entry = {
      name: 'claude', label: 'Claude', check_ready: { login_command: 'claude login' },
      probe: { args: ['-e', 'console.log("Not logged in · Please run /login"); process.exit(1)'], timeout_s: 30 },
    };
    const c = fakeConnector({
      entry,
      health: { installed: true, ready: false, auth_status: 'no_credentials', binary: process.execPath },
    });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.code, CODE.NOT_LOGGED_IN);
    assert.equal(r.message, 'Not logged in · Please run /login');
  });

  it('reports an unsupported version as such, with reinstall guidance', async () => {
    const entry = {
      name: 'deepseek', label: 'DeepSeek Harness',
      install: { supported_version: '0.1.0-rc.6', windows: 'npm install -g @deepseek-ai/dsh@0.1.0-rc.6', macos: 'npm install -g @deepseek-ai/dsh@0.1.0-rc.6', linux: 'npm install -g @deepseek-ai/dsh@0.1.0-rc.6' },
    };
    const c = fakeConnector({
      entry,
      health: {
        installed: true, ready: false, compatible: false, reason: 'version_incompatible',
        auth_status: 'no_credentials', message: 'DeepSeek Harness 0.2.0-rc.2 is not supported',
      },
    });
    const r = await probeAgentType(c, 'deepseek');
    assert.equal(r.code, CODE.VERSION_INCOMPATIBLE);
    assert.ok(r.guidance.some((l) => l.includes('@deepseek-ai/dsh@0.1.0-rc.6')), JSON.stringify(r.guidance));
  });

  it('hands a keyed agent to the API tier when its CLI probe cannot see the key', async () => {
    // Codex reaches a relay through launch flags the bare probe run lacks: the
    // CLI probe would test OpenAI's default endpoint instead of the relay.
    const path = require.resolve('../src/utils');
    const saved = require.cache[path];
    require.cache[path] = {
      id: path, filename: path, loaded: true,
      exports: { testLLMConnection: async () => ({ success: true, response: 'from-api' }) },
    };
    try {
      const entry = {
        name: 'codex', label: 'Codex',
        probe: { args: ['-e', 'console.log("from-cli")'], timeout_s: 30, skip_cli_with_key: true },
      };
      const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath } });
      const keyed = await probeAgentType(c, 'codex', { agentEnv: { OPENAI_API_KEY: 'sk-relay' } });
      assert.equal(keyed.method, 'llm_api', JSON.stringify(keyed));
      const signedIn = await probeAgentType(c, 'codex', { agentEnv: { OPENAGENTS_AUTH_MODE: 'cli_login' } });
      assert.equal(signedIn.method, 'cli', JSON.stringify(signedIn));
      assert.equal(signedIn.reply, 'from-cli');
    } finally {
      if (saved) require.cache[path] = saved; else delete require.cache[path];
    }
  });

  it('skips the API call for an agent whose key is not a model API key', async () => {
    const path = require.resolve('../src/utils');
    const saved = require.cache[path];
    let called = false;
    require.cache[path] = {
      id: path, filename: path, loaded: true,
      exports: { testLLMConnection: async () => { called = true; return { success: false, error: 'getaddrinfo ENOTFOUND api.openai.com' }; } },
    };
    try {
      const entry = { name: 'cursor', label: 'Cursor', probe: { api_test: false } };
      const c = fakeConnector({ entry, health: { installed: true, ready: true }, env: { LLM_API_KEY: 'key_cursor' } });
      const r = await probeAgentType(c, 'cursor');
      assert.equal(called, false);
      assert.equal(r.code, CODE.STATIC_ONLY);
      assert.equal(r.ok, true);
    } finally {
      if (saved) require.cache[path] = saved; else delete require.cache[path];
    }
  });

  it('reports the error line, not a harmless warning on stderr', async () => {
    const entry = {
      name: 'claude', label: 'Claude',
      probe: {
        args: ['-e', 'console.error("⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set"); console.log("API Error: 403 insufficient_quota"); process.exit(1)'],
        timeout_s: 30,
      },
    };
    const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath } });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.code, CODE.OUT_OF_CREDIT);
    assert.equal(r.message, 'API Error: 403 insufficient_quota');
  });

  it('looks past Claude Code\'s unknown-model notice to the real error', async () => {
    // A relay model Claude Code does not know makes it print a long notice
    // ending "…auto-compact keeps this session within 200k tokens (the context
    // window it assumes)…". That notice was all the dashboard ever showed.
    const notice = 'Claude Code doesn\'t recognize the model "glm-5", so it assumes a context window of 200000 tokens. '
      + 'Until then auto-compact keeps this session within 200k tokens (the context window it assumes); '
      + 'CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1 restores the previous wait-for-the-API behavior.';
    const entry = {
      name: 'claude', label: 'Claude', check_ready: { login_command: 'claude login' },
      probe: {
        args: ['-e', `console.log("Failed to authenticate: OAuth session expired and could not be refreshed"); console.error(${JSON.stringify(notice)}); process.exit(1)`],
        timeout_s: 30,
      },
    };
    const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath } });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.code, CODE.SESSION_EXPIRED);
    assert.equal(r.message, 'Failed to authenticate: OAuth session expired and could not be refreshed');
    assert.ok(r.guidance.some((l) => /expired/.test(l) && /claude login/.test(l)), JSON.stringify(r.guidance));
  });

  it('does not count the unknown-model notice alone as a reply', async () => {
    const entry = {
      name: 'claude', label: 'Claude',
      probe: { args: ['-e', 'console.log("Until then auto-compact keeps this session within 200k tokens (the context window it assumes)")'], timeout_s: 30 },
    };
    const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: process.execPath } });
    const r = await probeAgentType(c, 'claude');
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.EMPTY_RESPONSE);
  });

  it('runs a Windows .cmd shim from a folder with a space in it', { skip: process.platform !== 'win32' }, async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe space '));
    try {
      const shim = path.join(dir, 'agent.cmd');
      fs.writeFileSync(shim, '@echo off\r\necho hello %1\r\n');
      const entry = { name: 'codebuddy', label: 'CodeBuddy', probe: { args: ['hi'], timeout_s: 30 } };
      const c = fakeConnector({ entry, health: { installed: true, ready: true, binary: shim } });
      const r = await probeAgentType(c, 'codebuddy');
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.reply, 'hello hi');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
