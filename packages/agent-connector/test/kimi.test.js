'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KimiAdapter = require('../src/adapters/kimi');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');
const { testLLMConnection } = require('../src/utils');
const {
  classifyKimiVersion,
  KimiStreamParser,
  interpretKimiMessage,
  toolPreview,
  buildKimiArgs,
  buildKimiEnv,
  encodeKimiWorkDirKey,
  extractStderrError,
  classifyKimiError,
  redactArgs,
} = require('../src/adapters/kimi-stream');

function makeAdapter(env) {
  return new KimiAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'kimi-bot',
    agentEnv: env,
  });
}

describe('KimiAdapter', () => {
  it('is registered under the kimi agent type', () => {
    assert.equal(ADAPTER_MAP.kimi, KimiAdapter);
    const inst = createAdapter('kimi', {
      workspaceId: 'ws',
      channelName: 'thread',
      token: 'token',
      agentName: 'kimi-bot',
      agentEnv: {},
    });
    assert.ok(inst instanceof KimiAdapter);
  });

  it('applies Moonshot defaults when only an API key is configured', () => {
    const adapter = makeAdapter({ KIMI_API_KEY: 'sk-test' });
    assert.equal(adapter._apiKey, 'sk-test');
    assert.equal(adapter._baseUrl, 'https://api.moonshot.ai/v1');
    assert.equal(adapter._model, 'kimi-k2.6');
    assert.equal(adapter._directMode, true);
  });

  it('honors MOONSHOT_API_KEY and KIMI_API_KEY aliases', () => {
    const a = makeAdapter({ MOONSHOT_API_KEY: 'sk-moon' });
    assert.equal(a._apiKey, 'sk-moon');
    assert.equal(a._directMode, true);

    // KIMI_API_KEY wins over MOONSHOT_API_KEY (UI > env alias)
    const b = makeAdapter({ MOONSHOT_API_KEY: 'sk-moon', KIMI_API_KEY: 'sk-ui' });
    assert.equal(b._apiKey, 'sk-ui');
  });

  it('lets users override base URL and model', () => {
    const adapter = makeAdapter({
      KIMI_API_KEY: 'sk-test',
      KIMI_BASE_URL: 'https://example.test/v1/',
      KIMI_MODEL: 'kimi-k2.6-preview',
    });
    assert.equal(adapter._baseUrl, 'https://example.test/v1');
    assert.equal(adapter._model, 'kimi-k2.6-preview');
  });

  it('reports not-direct mode when no API key is set', () => {
    const adapter = makeAdapter({});
    assert.equal(adapter._apiKey, '');
    assert.equal(adapter._directMode, false);
    // Defaults still applied so the user can ship a key later without restart logic
    assert.equal(adapter._baseUrl, 'https://api.moonshot.ai/v1');
    assert.equal(adapter._model, 'kimi-k2.6');
  });

  it('constructs an OpenAI-compatible streaming chat completion request', async () => {
    let seenRequest = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seenRequest = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(body),
        };
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end([
          'data: {"choices":[{"delta":{"content":"hello"}}]}',
          '',
          'data: {"choices":[{"delta":{"content":" kimi"}}]}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'));
      });
    });

    await listen(server);
    try {
      const { port } = server.address();
      const adapter = makeAdapter({
        KIMI_API_KEY: 'sk-test',
        KIMI_BASE_URL: `http://127.0.0.1:${port}/v1`,
        KIMI_MODEL: 'kimi-k2.6',
      });

      const text = await adapter._callCompletionApi('ping', 'thread');

      assert.equal(text, 'hello kimi');
      assert.equal(seenRequest.method, 'POST');
      assert.equal(seenRequest.url, '/v1/chat/completions');
      assert.equal(seenRequest.authorization, 'Bearer sk-test');
      assert.equal(seenRequest.body.model, 'kimi-k2.6');
      assert.equal(seenRequest.body.stream, true);
      assert.ok(seenRequest.body.messages.some((m) => m.role === 'user' && m.content === 'ping'));
    } finally {
      await close(server);
    }
  });

  it('aborts an in-flight completion request on stop', async () => {
    let releaseRequest;
    const requestStarted = new Promise((resolve) => { releaseRequest = resolve; });
    const server = http.createServer((req, res) => {
      releaseRequest();
      req.resume();
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    });

    await listen(server);
    try {
      const { port } = server.address();
      const adapter = makeAdapter({
        KIMI_API_KEY: 'sk-test',
        KIMI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      });

      const pending = adapter._callCompletionApi('please wait', 'thread');
      await requestStarted;
      adapter.stop();

      await assert.rejects(pending, /stopped|socket hang up|aborted/i);
    } finally {
      await close(server);
    }
  });

  it('tests Kimi connection using KIMI_* env fields', async () => {
    let seenRequest = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seenRequest = {
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(body),
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          model: 'kimi-k2.6',
          choices: [{ message: { content: 'hi there' } }],
        }));
      });
    });

    await listen(server);
    try {
      const { port } = server.address();
      const result = await testLLMConnection({
        KIMI_API_KEY: 'sk-test',
        KIMI_BASE_URL: `http://127.0.0.1:${port}/v1`,
        KIMI_MODEL: 'kimi-k2.6',
      });

      assert.equal(result.success, true);
      assert.equal(result.model, 'kimi-k2.6');
      assert.equal(result.response, 'hi there');
      assert.equal(seenRequest.url, '/v1/chat/completions');
      assert.equal(seenRequest.authorization, 'Bearer sk-test');
      assert.equal(seenRequest.body.model, 'kimi-k2.6');
      assert.equal(seenRequest.body.max_tokens, 32);
    } finally {
      await close(server);
    }
  });
});

describe('kimi-stream helpers', () => {
  it('classifies Kimi Code (0.x) vs the legacy Python kimi-cli (1.x)', () => {
    assert.deepEqual(classifyKimiVersion('0.39.1'), { version: '0.39.1', product: 'kimi-code' });
    assert.deepEqual(classifyKimiVersion('1.44.0'), { version: '1.44.0', product: 'legacy' });
    assert.deepEqual(classifyKimiVersion('nonsense'), { version: null, product: null });
    assert.deepEqual(classifyKimiVersion(''), { version: null, product: null });
  });

  it('parses JSONL across chunk boundaries and flushes the tail', () => {
    const p = new KimiStreamParser();
    const a = p.push('{"role":"meta","type":"system.version","ver');
    assert.equal(a.length, 0);
    const b = p.push('sion":"0.39.1"}\n{"role":"assistant","con');
    assert.equal(b.length, 1);
    assert.equal(b[0].type, 'system.version');
    const c = p.push('tent":"hi"}');
    assert.equal(c.length, 0);
    const d = p.flush();
    assert.equal(d.length, 1);
    assert.equal(d[0].content, 'hi');
  });

  it('skips non-JSON diagnostic lines without dying', () => {
    const p = new KimiStreamParser();
    const msgs = p.push('not json\n{"role":"assistant","content":"ok"}\n{broken\n');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].content, 'ok');
  });

  it('interprets assistant text and tool calls', () => {
    const events = interpretKimiMessage({
      role: 'assistant',
      content: ' The answer. ',
      tool_calls: [
        { type: 'function', id: 'functions.Bash:1', function: { name: 'Bash', arguments: '{"command":"ls -la"}' } },
      ],
    });
    assert.deepEqual(events[0], { kind: 'text', text: 'The answer.' });
    assert.equal(events[1].kind, 'tool_start');
    assert.equal(events[1].name, 'Bash');
    assert.equal(events[1].preview, 'ls -la');
  });

  it('ignores whitespace-only assistant filler between tool calls', () => {
    const events = interpretKimiMessage({
      role: 'assistant',
      content: ' ',
      tool_calls: [{ type: 'function', id: 't', function: { name: 'Write', arguments: '{"path":"a.txt"}' } }],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'tool_start');
  });

  it('extracts session ids and retry notices from meta messages', () => {
    const sess = interpretKimiMessage({
      role: 'meta', type: 'session.resume_hint', session_id: 'session_abc', command: 'kimi -r session_abc',
    });
    assert.deepEqual(sess, [{ kind: 'session', sessionId: 'session_abc' }]);

    const retry = interpretKimiMessage({
      role: 'meta', type: 'turn.step.retrying',
      failed_attempt: 2, next_attempt: 3, max_attempts: 10, error_message: 'Backend API error sk-secret12345678',
    });
    assert.equal(retry[0].kind, 'retrying');
    assert.equal(retry[0].attempt, 2);
    assert.equal(retry[0].maxAttempts, 10);
    assert.ok(!retry[0].message.includes('sk-secret12345678'));
  });

  it('ignores tool results, user echoes and unknown meta types', () => {
    assert.equal(interpretKimiMessage({ role: 'tool', tool_call_id: 'x', content: 'out' })[0].kind, 'tool_result');
    assert.deepEqual(interpretKimiMessage({ role: 'user', content: 'hi' }), []);
    assert.deepEqual(interpretKimiMessage({ role: 'meta', type: 'something.new' }), []);
    assert.deepEqual(interpretKimiMessage(null), []);
  });

  it('builds tool previews with redaction and truncation', () => {
    assert.equal(toolPreview('{"path":"src/app.ts"}'), 'src/app.ts');
    assert.ok(toolPreview(`{"command":"x ${'y'.repeat(200)}"}`).length <= 81);
    assert.ok(!toolPreview('{"command":"curl -H \'Authorization: Bearer abcdefgh12345678\'"}').includes('abcdefgh12345678'));
    assert.equal(toolPreview('not json'), '');
  });

  it('builds print-mode args, with -S only when resuming', () => {
    assert.deepEqual(
      buildKimiArgs({ prompt: 'do it' }),
      ['-p', 'do it', '--output-format', 'stream-json'],
    );
    assert.deepEqual(
      buildKimiArgs({ prompt: 'again', sessionId: 'session_1' }),
      ['-S', 'session_1', '-p', 'again', '--output-format', 'stream-json'],
    );
    // Print mode auto-approves; --yolo/--auto/--plan are REJECTED with -p.
    for (const forbidden of ['--yolo', '--auto', '--plan']) {
      assert.ok(!buildKimiArgs({ prompt: 'x', sessionId: 's' }).includes(forbidden));
    }
  });

  it('redacts the prompt from logged argv', () => {
    const logged = redactArgs(['kimi', '-S', 's1', '-p', 'secret prompt text', '--output-format', 'stream-json']);
    assert.ok(!logged.join(' ').includes('secret prompt text'));
    assert.ok(logged.includes('«prompt»'));
  });

  it('maps launcher KIMI_* fields onto the CLI env-provider contract', () => {
    const { env, viaEnvProvider } = buildKimiEnv({
      KIMI_API_KEY: 'sk-test',
      KIMI_BASE_URL: 'https://gw.example/v1/',
      KIMI_MODEL: 'kimi-k2.6',
      PATH: '/usr/bin',
    });
    assert.equal(viaEnvProvider, true);
    assert.equal(env.KIMI_MODEL_API_KEY, 'sk-test');
    assert.equal(env.KIMI_MODEL_NAME, 'kimi-k2.6');
    assert.equal(env.KIMI_MODEL_BASE_URL, 'https://gw.example/v1');
    assert.equal(env.KIMI_MODEL_PROVIDER_TYPE, 'kimi');
    assert.equal(env.KIMI_MODEL_MAX_COMPLETION_TOKENS, '32768');
    assert.equal(env.PATH, '/usr/bin');
  });

  it('accepts MOONSHOT_API_KEY and applies the default model', () => {
    const { env } = buildKimiEnv({ MOONSHOT_API_KEY: 'sk-moon' });
    assert.equal(env.KIMI_MODEL_API_KEY, 'sk-moon');
    assert.equal(env.KIMI_MODEL_NAME, 'kimi-k2.6');
    assert.equal(env.KIMI_MODEL_BASE_URL, undefined);
  });

  it('never overrides explicit KIMI_MODEL_* variables', () => {
    const { env } = buildKimiEnv({
      KIMI_API_KEY: 'sk-a',
      KIMI_MODEL_API_KEY: 'sk-explicit',
      KIMI_MODEL_NAME: 'kimi-k3',
      KIMI_MODEL_PROVIDER_TYPE: 'openai',
      KIMI_MODEL_MAX_COMPLETION_TOKENS: '4096',
    });
    assert.equal(env.KIMI_MODEL_API_KEY, 'sk-explicit');
    assert.equal(env.KIMI_MODEL_NAME, 'kimi-k3');
    assert.equal(env.KIMI_MODEL_PROVIDER_TYPE, 'openai');
    assert.equal(env.KIMI_MODEL_MAX_COMPLETION_TOKENS, '4096');
  });

  it('passes the env through untouched when no key is configured (kimi login path)', () => {
    const { env, viaEnvProvider } = buildKimiEnv({ PATH: '/usr/bin' });
    assert.equal(viaEnvProvider, false);
    assert.equal(env.KIMI_MODEL_NAME, undefined);
    assert.equal(env.KIMI_MODEL_PROVIDER_TYPE, undefined);
  });

  it('extracts and strips the CLI error wrapper from stderr', () => {
    const raw = 'error: failed to run prompt: provider.auth_error: 401 status code (no body)\nSee log: /x/y.log\n';
    assert.equal(extractStderrError(raw), 'provider.auth_error: 401 status code (no body)');
    assert.equal(extractStderrError(''), '');
  });

  it('classifies auth, config, transient and generic failures', () => {
    const auth = classifyKimiError({
      code: 1, signal: null, retryMessage: '',
      stderrText: 'error: failed to run prompt: provider.auth_error: 401 status code (no body)',
    });
    assert.equal(auth.kind, 'auth');
    assert.match(auth.userMessage, /KIMI_API_KEY|kimi login/);

    const config = classifyKimiError({
      code: 1, signal: null, retryMessage: '',
      stderrText: 'error: failed to run prompt: No model configured. Run `kimi` and use /login to sign in, then retry; or set default_model in config.toml.',
    });
    assert.equal(config.kind, 'config');

    const transient = classifyKimiError({ code: 75, signal: null, stderrText: '', retryMessage: '' });
    assert.equal(transient.kind, 'transient');

    const generic = classifyKimiError({ code: 1, signal: null, stderrText: '', retryMessage: '' });
    assert.match(generic.userMessage, /exited with code 1/);

    const killed = classifyKimiError({ code: null, signal: 'SIGKILL', stderrText: '', retryMessage: '' });
    assert.match(killed.userMessage, /SIGKILL/);
  });

  it('falls back to the last provider retry error for classification', () => {
    const ctx = classifyKimiError({
      code: 1, signal: null, stderrText: '',
      retryMessage: "This model's maximum context length is 262144 tokens...",
    });
    assert.equal(ctx.kind, 'context');
  });

  it('reports a watchdog stop as a timeout, not as the signal it used', () => {
    // What a Windows user saw: stderr held only tool noise, the stop read as SIGINT.
    const info = { code: null, signal: 'SIGINT', stderrText: 'which: no gh\n', retryMessage: '' };
    assert.match(classifyKimiError(info).userMessage, /terminated by signal SIGINT/);

    const timeout = classifyKimiError({ ...info, timedOutMs: 300_000 });
    assert.equal(timeout.kind, 'timeout');
    assert.match(timeout.userMessage, /about 5 min/);
    assert.doesNotMatch(timeout.userMessage, /SIGINT/);
  });

  it('keys a working directory exactly as Kimi Code files its sessions', () => {
    // Taken from a real Windows install: C:\Users\86177 → wd_86177_5d6fa4a9b53d.
    assert.equal(encodeKimiWorkDirKey('C:\\Users\\86177'), 'wd_86177_5d6fa4a9b53d');
    assert.equal(encodeKimiWorkDirKey('C:\\Users\\86177\\'), 'wd_86177_5d6fa4a9b53d');
    assert.match(encodeKimiWorkDirKey('/home/me/My Project!'), /^wd_my-project_[0-9a-f]{12}$/);
    assert.match(encodeKimiWorkDirKey('/'), /^wd_workspace_[0-9a-f]{12}$/);
  });
});

// A stand-in for `kimi -p`: prints tool noise on stderr, then stays mute on
// stdout like a main agent waiting on a subagent, optionally appending to a
// session journal meanwhile, and answers once it has been busy long enough.
const FAKE_KIMI = `
const fs = require('fs');
const path = require('path');
const { FAKE_JOURNAL, FAKE_BUSY_MS } = process.env;
process.stderr.write('which: no gh\\n');
if (FAKE_JOURNAL) fs.mkdirSync(path.dirname(FAKE_JOURNAL), { recursive: true });
const started = Date.now();
const tick = setInterval(() => {
  if (FAKE_JOURNAL) fs.appendFileSync(FAKE_JOURNAL, '{}\\n');
  if (Date.now() - started >= Number(FAKE_BUSY_MS)) {
    clearInterval(tick);
    process.stdout.write(JSON.stringify({ role: 'assistant', content: 'done' }) + '\\n');
  }
}, 30);
`;

describe('KimiAdapter idle watchdog', () => {
  async function runFakeKimi({ busyMs, journal = null, args = [], existing = [] }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-watchdog-'));
    const home = path.join(root, 'kimi-home');
    const workDir = path.join(root, 'work');
    fs.mkdirSync(workDir, { recursive: true });
    const bucket = path.join(home, 'sessions', encodeKimiWorkDirKey(workDir));
    for (const id of existing) fs.mkdirSync(path.join(bucket, id), { recursive: true });
    const bin = path.join(root, 'fake-kimi.js');
    fs.writeFileSync(bin, FAKE_KIMI);

    const adapter = makeAdapter({
      ...process.env,
      KIMI_CODE_HOME: home,
      FAKE_JOURNAL: journal ? path.join(bucket, journal) : '',
      FAKE_BUSY_MS: String(busyMs),
    });
    // 20 quiet ticks of 100ms: stopped after ~2s without a sign of life. The
    // only silent stretch in a healthy run is the child's own boot (the fake
    // writes every 30ms once up), and node startup on a loaded runner or on
    // Windows can exceed half a second — a 500ms budget killed healthy runs
    // in CI. Alive scenarios stay busy longer than the budget so a watchdog
    // that ignored the journal would still be caught.
    adapter._watchdogIntervalMs = 100;
    adapter._watchdogMax = 20;
    adapter.logs = [];
    adapter._log = (line) => { adapter.logs.push(line); };
    adapter.sendThinking = async () => {};
    adapter.sendStatus = async () => {};
    try {
      const result = await adapter._runKimi(
        'thread', bin, [...args, '-p', 'hi', '--output-format', 'stream-json'], workDir,
      );
      return { result, logs: adapter.logs };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it('keeps a run alive while a subagent writes to the session it started', async () => {
    const { result, logs } = await runFakeKimi({
      busyMs: 3000,
      journal: 'session_new/agents/agent-0/wire.jsonl',
    });
    assert.equal(result.timedOutMs, 0);
    assert.equal(result.ok, true);
    assert.equal(result.finalText, 'done');
    assert.ok(logs.some((l) => /still being written/.test(l)));
  });

  it('counts writes to the session being resumed', async () => {
    const { result } = await runFakeKimi({
      busyMs: 3000,
      args: ['-S', 'session_old'],
      existing: ['session_old'],
      journal: 'session_old/agents/agent-0/wire.jsonl',
    });
    assert.equal(result.timedOutMs, 0);
    assert.equal(result.ok, true);
  });

  it('stops a quiet run despite writes to some other session, and says it timed out', async () => {
    const { result } = await runFakeKimi({
      busyMs: 10_000,
      existing: ['session_old'],
      journal: 'session_old/agents/agent-0/wire.jsonl',
    });
    assert.ok(result.timedOutMs > 0);
    assert.equal(result.ok, false);
    assert.equal(result.finalText, '');
    const { kind, userMessage } = classifyKimiError({
      code: result.exitCode,
      signal: result.exitSignal,
      stderrText: result.stderrText,
      retryMessage: result.retryMessage,
      timedOutMs: result.timedOutMs,
    });
    assert.equal(kind, 'timeout');
    assert.doesNotMatch(userMessage, /signal/);
  });
});

describe('KimiAdapter CLI routing', () => {
  function captureAdapter(env) {
    const adapter = makeAdapter(env);
    adapter.errors = [];
    adapter.sendError = async (_ch, text) => { adapter.errors.push(text); };
    return adapter;
  }

  it('asks the user to install the CLI when neither CLI nor API key exists', async () => {
    const adapter = captureAdapter({});
    adapter._findKimiBinary = () => null;
    await adapter._handleMessage({ content: 'hello', sessionId: 'thread' });
    assert.equal(adapter.errors.length, 1);
    assert.match(adapter.errors[0], /@moonshot-ai\/kimi-code/);
  });

  it('rejects the legacy Python kimi-cli when no direct fallback is possible', async () => {
    const adapter = captureAdapter({});
    adapter._findKimiBinary = () => '/fake/kimi';
    adapter._checkKimiVersion = () => ({ version: '1.44.0', product: 'legacy' });
    await adapter._handleMessage({ content: 'hello', sessionId: 'thread' });
    assert.equal(adapter.errors.length, 1);
    assert.match(adapter.errors[0], /legacy Python kimi-cli \(1\.44\.0\)/);
    assert.match(adapter.errors[0], /@moonshot-ai\/kimi-code/);
  });

  it('falls back to direct API mode when the CLI is missing but a key is set', async () => {
    const adapter = captureAdapter({ KIMI_API_KEY: 'sk-test' });
    adapter._findKimiBinary = () => null;
    let directCalls = 0;
    // Patch the inherited direct path — reaching it IS the assertion.
    const proto = Object.getPrototypeOf(KimiAdapter.prototype);
    const original = proto._handleMessage;
    proto._handleMessage = async function patched(msg) {
      directCalls++;
      assert.equal(msg.content, 'hello');
    };
    try {
      await adapter._handleMessage({ content: 'hello', sessionId: 'thread' });
    } finally {
      proto._handleMessage = original;
    }
    assert.equal(directCalls, 1);
    assert.equal(adapter.errors.length, 0);
  });
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
