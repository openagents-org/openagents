'use strict';

/**
 * OpenCode adapter stability + preflight tests.
 *
 * These cover the four reliability fixes (no @latest / version gate, structured
 * stdout-error preservation, failure classification, empty/tool-event handling)
 * and the send-time preflight. All fixtures are synthetic — no network, no CLI.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const OpenCodeAdapter = require('../src/adapters/opencode');

function makeAdapter(overrides = {}) {
  const adapter = new OpenCodeAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'opencode-test',
    ...overrides,
  });
  // Neutralize network/IO side effects for unit scope.
  adapter._log = () => {};
  return adapter;
}

// ---------------------------------------------------------------------------
// 8.1 Version pin & compatibility
// ---------------------------------------------------------------------------

describe('OpenCode — version pin & install (8.1)', () => {
  const registry = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'),
  );
  const entry = (registry.agents || registry).find((a) => a.name === 'opencode');

  it('install commands pin an exact version and never use @latest', () => {
    assert.ok(entry, 'opencode entry exists');
    for (const os of ['macos', 'linux', 'windows']) {
      const cmd = entry.install[os];
      assert.ok(/opencode-ai@\d+\.\d+\.\d+/.test(cmd), `${os} pins a version: ${cmd}`);
      assert.ok(!cmd.includes('@latest'), `${os} does not use @latest`);
    }
  });

  it('declares a min_version so the compatibility gate is active', () => {
    assert.equal(entry.check_ready.min_version, '1.17.0');
  });

  it('marks LLM_MODEL as required (model is a real ready condition)', () => {
    const model = entry.env_config.find((f) => f.name === 'LLM_MODEL');
    assert.equal(model.required, true);
  });

  it('classifies versions: too-old=unsupported, in-range=ok, newer=degraded, junk=unknown', () => {
    assert.equal(OpenCodeAdapter._classifyVersion('1.0.0'), 'unsupported');
    assert.equal(OpenCodeAdapter._classifyVersion('1.16.9'), 'unsupported');
    assert.equal(OpenCodeAdapter._classifyVersion('1.17.0'), 'ok');
    assert.equal(OpenCodeAdapter._classifyVersion('1.17.11'), 'ok');
    assert.equal(OpenCodeAdapter._classifyVersion('1.18.0'), 'degraded');
    assert.equal(OpenCodeAdapter._classifyVersion('2.0.0'), 'degraded');
    assert.equal(OpenCodeAdapter._classifyVersion(null), 'unknown');
    assert.equal(OpenCodeAdapter._classifyVersion('opencode-dev'), 'unknown');
  });

  // Regression: _detectCliVersion uses getEnhancedEnv() for the `--version`
  // probe. It must be imported from ../paths — a missing import throws a
  // ReferenceError that the method's own try/catch swallows, silently degrading
  // EVERY probe to { version: null, executable: true } and disabling the
  // version/executability preflight. The other preflight tests stub
  // _detectCliVersion, so only a real spawn (against node as a stand-in binary)
  // exercises this path.
  it('_detectCliVersion actually spawns and parses a version (getEnhancedEnv wired)', () => {
    const adapter = Object.create(OpenCodeAdapter.prototype);
    adapter._log = () => {};
    const probe = adapter._detectCliVersion(process.execPath); // `node --version`
    assert.equal(probe.executable, true);
    assert.match(probe.version, /^\d+\.\d+\.\d+$/, 'a real version was parsed, not null');
  });
});

// ---------------------------------------------------------------------------
// 8.2 Preflight — blocks before spawn, conservative
// ---------------------------------------------------------------------------

describe('OpenCode — preflight (8.2)', () => {
  function preflightWith({ binary = '/fake/opencode', probe = { version: '1.17.11', executable: true }, env = {} }) {
    const adapter = makeAdapter();
    adapter._opencodeBinary = binary;
    adapter._findOpencodeBinary = () => binary;
    adapter._detectCliVersion = () => probe;
    adapter.agentEnv = env;
    return adapter._preflight('thread');
  }

  it('cli_not_found when no binary', () => {
    const r = preflightWith({ binary: null });
    assert.equal(r.ok, false);
    assert.equal(r.category, 'cli_not_found');
  });

  it('cli_not_executable when --version cannot run', () => {
    const r = preflightWith({ probe: { version: null, executable: false } });
    assert.equal(r.ok, false);
    assert.equal(r.category, 'cli_not_executable');
  });

  it('unsupported_version when too old', () => {
    const r = preflightWith({
      probe: { version: '1.2.3', executable: true },
      env: { LLM_MODEL: 'gpt-4o', OPENAI_API_KEY: 'x' },
    });
    assert.equal(r.ok, false);
    assert.equal(r.category, 'unsupported_version');
  });

  it('model_missing when no model resolvable', () => {
    const r = preflightWith({ env: { OPENAI_API_KEY: 'x' } });
    assert.equal(r.ok, false);
    assert.equal(r.category, 'model_missing');
  });

  it('credential_missing when nothing present', () => {
    const r = preflightWith({ env: { LLM_MODEL: 'gpt-4o' } });
    assert.equal(r.ok, false);
    assert.equal(r.category, 'credential_missing');
  });

  it('does NOT hard-block when a custom endpoint / unknown key is present', () => {
    const r = preflightWith({ env: { LLM_MODEL: 'gpt-4o', LLM_BASE_URL: 'https://proxy.example/v1', SOME_CUSTOM_API_KEY: 'k' } });
    assert.equal(r.ok, true);
    assert.equal(r.credential, 'unknown');
  });

  it('passes with binary + supported version + model + key', () => {
    const r = preflightWith({ env: { LLM_MODEL: 'gpt-4o', OPENAI_API_KEY: 'x' } });
    assert.equal(r.ok, true);
    assert.equal(r.versionClass, 'ok');
  });

  it('_runOpencode rejects (without spawning) when preflight fails', async () => {
    const adapter = makeAdapter();
    adapter._preflight = () => ({ ok: false, category: 'model_missing' });
    // If spawn were reached it would throw a different error; assert the category.
    await assert.rejects(
      () => adapter._runOpencode('hi', 'thread'),
      (e) => e.category === 'model_missing',
    );
  });
});

// ---------------------------------------------------------------------------
// 8.3 stdout / stderr / structured error classification
// ---------------------------------------------------------------------------

describe('OpenCode — failure classification (8.3)', () => {
  it('extracts a structured error event from stdout JSONL', () => {
    const raw = '{"type":"step_start"} {"type":"error","error":{"name":"APIError","message":"Unauthorized","status":401}} {"type":"step-finish"}';
    const err = OpenCodeAdapter._extractErrorFromStdout(raw);
    assert.equal(err.name, 'APIError');
    assert.equal(err.status, '401');
    assert.match(err.message, /Unauthorized/);
  });

  it('code=1 + empty stderr + stdout 401 error → auth_failed (not generic exit 1)', () => {
    const stdout = '{"type":"error","error":{"message":"Invalid API key","status":401}}';
    const cls = OpenCodeAdapter._classifyFailure({ code: 1, signal: null, stdout, stderr: '' });
    assert.equal(cls.category, 'auth_failed');
  });

  it('code=1 + stdout model-not-found error → model_not_found', () => {
    const stdout = '{"type":"error","error":{"name":"NotFoundError","message":"The model `gpt-5` does not exist","status":404}}';
    const cls = OpenCodeAdapter._classifyFailure({ code: 1, stdout, stderr: '' });
    assert.equal(cls.category, 'model_not_found');
  });

  it('code=1 + stderr network error (empty stdout) → network_error', () => {
    const cls = OpenCodeAdapter._classifyFailure({ code: 1, stdout: '', stderr: 'Error: connect ECONNREFUSED 127.0.0.1:443' });
    assert.equal(cls.category, 'network_error');
  });

  it('code=1 + 429 → rate_limited', () => {
    const cls = OpenCodeAdapter._classifyFailure({ code: 1, stdout: '{"type":"error","error":{"message":"rate limit exceeded","status":429}}', stderr: '' });
    assert.equal(cls.category, 'rate_limited');
  });

  it('code=1 + nothing usable → process_crashed (with exit diagnostic)', () => {
    const cls = OpenCodeAdapter._classifyFailure({ code: 1, stdout: '', stderr: '' });
    assert.equal(cls.category, 'process_crashed');
    assert.match(cls.diagnostic, /exit code 1/);
  });

  it('exit code alone is never auth — an opaque non-zero exit is not auth_failed', () => {
    const cls = OpenCodeAdapter._classifyFailure({ code: 1, stdout: 'some unparseable noise', stderr: '' });
    assert.notEqual(cls.category, 'auth_failed');
    assert.notEqual(cls.category, 'credential_missing');
  });

  it('code=0 + stdout error event → classified, NOT empty_response', () => {
    const stdout = '{"type":"error","error":{"message":"forbidden","status":403}}';
    const stdoutErr = OpenCodeAdapter._extractErrorFromStdout(stdout);
    assert.ok(stdoutErr);
    const cls = OpenCodeAdapter._classifyFailure({ code: 0, stdout, stderr: '', stdoutErr });
    assert.equal(cls.category, 'auth_failed');
  });

  it('redacts secrets from diagnostics/details', () => {
    const raw = 'Authorization: Bearer sk-abcdef0123456789abcdef0123456789 failed; api_key=SUPERSECRETVALUE1234567890ABalthough';
    const red = OpenCodeAdapter._redact(raw);
    assert.ok(!red.includes('sk-abcdef0123456789abcdef0123456789'));
    assert.ok(!red.includes('SUPERSECRETVALUE1234567890AB'));
    assert.match(red, /REDACTED/);
  });
});

// ---------------------------------------------------------------------------
// 8.4 text & tool event handling
// ---------------------------------------------------------------------------

describe('OpenCode — text/tool events (8.4)', () => {
  async function runEvents(events) {
    const adapter = makeAdapter();
    adapter.sendThinking = async () => {};
    adapter.sendStatus = async () => {};
    const state = { finalText: '', allText: '', seenText: false };
    for (const ev of events) await adapter._handleStreamEvent(ev, 'thread', state);
    const raw = events.map((e) => JSON.stringify(e)).join(' ');
    return { state, text: OpenCodeAdapter._finalTextFromStdout(raw, state) };
  }

  it('text -> final text -> exit: returns the text', async () => {
    const { text } = await runEvents([{ type: 'text', part: { text: 'Answer: 42.' } }]);
    assert.equal(text, 'Answer: 42.');
  });

  it('text -> tool -> final text: returns post-tool text', async () => {
    const { text } = await runEvents([
      { type: 'text', part: { text: 'Let me check. ' } },
      { type: 'tool_use', item: { name: 'Read', input: { path: '/x' } } },
      { type: 'text', part: { text: 'Done.' } },
    ]);
    assert.equal(text, 'Done.');
  });

  it('text -> tool -> exit (no closing text): does NOT report empty', async () => {
    const { text } = await runEvents([
      { type: 'text', part: { text: 'The result is 7.' } },
      { type: 'tool_use', item: { name: 'Bash', input: { command: 'echo done' } } },
    ]);
    // earlier text recovered via allText fallback — not an empty "produced no response"
    assert.equal(text, 'The result is 7.');
  });

  it('only control/tool events -> empty_response category', async () => {
    const stdout = '{"type":"step_start"} {"type":"tool_use","item":{"name":"Bash"}}';
    assert.equal(OpenCodeAdapter._finalTextFromStdout(stdout), '');
    assert.equal(OpenCodeAdapter._emptyExitCategory(stdout), 'empty_response');
  });

  it('step_finish and step-finish are both treated as control (no text leak)', () => {
    assert.equal(OpenCodeAdapter._extractTextFromEvent({ type: 'step_finish', tokens: 5 }), null);
    assert.equal(OpenCodeAdapter._extractTextFromEvent({ type: 'step-finish', cost: 0.01 }), null);
  });

  it('detects tool events across shapes (tool_use / part.type=tool / message.part.updated)', () => {
    assert.equal(OpenCodeAdapter._isToolEvent({ type: 'tool_use' }), true);
    assert.equal(OpenCodeAdapter._isToolEvent({ type: 'message.part.updated', part: { type: 'tool' } }), true);
    assert.equal(OpenCodeAdapter._isToolEvent({ type: 'text', part: { text: 'hi' } }), false);
  });

  it('error events carry no assistant text', () => {
    assert.equal(OpenCodeAdapter._extractTextFromEvent({ type: 'error', error: { message: 'boom' } }), null);
  });
});

// ---------------------------------------------------------------------------
// 8.5 _handleMessage routing — classified error, no generic fallback
// ---------------------------------------------------------------------------

describe('OpenCode — message routing (8.5)', () => {
  it('routes a thrown classified failure to a classified error (no "produced no response")', async () => {
    const adapter = makeAdapter();
    const sent = [];
    const responses = [];
    adapter._autoTitleChannel = async () => {};
    adapter.sendStatus = async () => {};
    adapter.sendResponse = async (_c, content) => responses.push(content);
    adapter._sendClassifiedError = async (channel, category, detail) => sent.push({ channel, category, detail });
    adapter._runOpencode = async () => { throw adapter._failure('auth_failed', 'APIError 401', 'Invalid API key'); };

    await adapter._handleMessage({ content: 'hi', sessionId: 'thread', senderName: 'human:user' });

    assert.equal(responses.length, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].category, 'auth_failed');
  });

  it('classifies a raw spawn ENOENT as cli_not_found', () => {
    const adapter = makeAdapter();
    assert.equal(adapter._classifyErrno({ code: 'ENOENT' }), 'cli_not_found');
    assert.equal(adapter._classifyErrno({ code: 'EACCES' }), 'cli_not_executable');
    assert.equal(adapter._classifyErrno(new Error('weird')), 'unknown_error');
  });

  async function renderClassified(category, detail) {
    const adapter = makeAdapter();
    let captured = null;
    adapter._mode = 'autonomous';
    adapter._sessionId = 's1';
    adapter.client = {
      sendMessage: async (_w, _c, _t, content, opts) => { captured = { content, opts }; },
    };
    await adapter._sendClassifiedError('thread', category, detail);
    return captured;
  }

  it('classified errors are tagged (messageType=error + error_category) and visibly not a normal reply', async () => {
    const cap = await renderClassified('model_not_found', 'The model `gpt-5` does not exist');
    assert.equal(cap.opts.messageType, 'error');
    assert.equal(cap.opts.metadata.error_category, 'model_not_found');
    assert.match(cap.content, /OpenCode couldn't run/);
  });

  it('does NOT tell the user to run auth login for non-auth failures', async () => {
    for (const cat of ['model_missing', 'network_error', 'timeout', 'empty_response', 'unsupported_version']) {
      const cap = await renderClassified(cat);
      assert.ok(!/auth login/i.test(cap.content), `${cat} must not mention auth login`);
    }
  });

  it('DOES guide auth only for auth/credential failures', async () => {
    const cred = await renderClassified('credential_missing');
    assert.match(cred.content, /API key|auth login/i);
  });

  it('redacts secrets that appear in the surfaced detail', async () => {
    const cap = await renderClassified('auth_failed', 'rejected key sk-abcdef0123456789abcdef0123456789');
    assert.ok(!cap.content.includes('sk-abcdef0123456789abcdef0123456789'));
  });
});
