'use strict';

/**
 * What a channel is told when a run fails, for the adapters that used to say
 * only "No response generated. Please try again.".
 *
 * Each case drives the real adapter against a faked CLI process (or a real
 * local HTTP server, for the direct-API path) and asserts three things: the
 * user learns the cause, nothing secret is quoted back, and a failure the user
 * has to fix does not silently throw the channel's session away.
 */

const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const cp = require('node:child_process');

const realSpawn = cp.spawn;
let spawns = [];
let script = []; // one step per expected spawn: { stdout, stderr, code }

cp.spawn = (cmd, args, opts) => {
  const step = script.shift() || { code: 0 };
  const proc = new EventEmitter();
  proc.pid = 999999;
  proc.exitCode = null;
  proc.stdin = { write() {}, end() {}, on() {} };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => {};
  spawns.push({ cmd, args, opts, proc });
  setImmediate(() => {
    if (step.stdout) proc.stdout.emit('data', Buffer.from(step.stdout, 'utf-8'));
    // OpenClaw hands its child a file descriptor for stderr, not a pipe.
    const stderrFd = opts && Array.isArray(opts.stdio) ? opts.stdio[2] : null;
    if (step.stderr && typeof stderrFd === 'number') fs.writeSync(stderrFd, step.stderr);
    else if (step.stderr) proc.stderr.emit('data', Buffer.from(step.stderr, 'utf-8'));
    proc.exitCode = step.code ?? 0;
    proc.emit('exit', step.code ?? 0, null);
    proc.emit('close', step.code ?? 0, null);
  });
  return proc;
};

const { createAdapter } = require('../src/adapters');
const LlmDirectAdapter = require('../src/adapters/llm-direct');

after(() => { cp.spawn = realSpawn; });
beforeEach(() => { spawns = []; script = []; });

/** Common stubs: no workspace, no real binary, everything posted is captured. */
function harness(a) {
  a.logged = [];
  a._log = (text, level = 'info') => { a.logged.push({ text, level }); };
  a._saveSessions = () => {};
  a.posted = { response: [], error: [], status: [], thinking: [] };
  a.client = { getSession: async () => ({}), updateSession: async () => {} };
  a.sendResponse = async (_c, text) => { a.posted.response.push(text); };
  a.sendError = async (_c, text) => { a.posted.error.push(text); };
  a.sendStatus = async (_c, text) => { a.posted.status.push(text); };
  a.sendThinking = async (_c, text) => { a.posted.thinking.push(text); };
  a._autoTitleChannel = async () => {};
  a._prefetchPinnedContext = async () => {};
  return a;
}

const MSG = { content: 'hi', sessionId: 'chan-1', senderName: 'you' };
const OPENAI_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
// A relay's key and a workspace token: no prefix, no length, nothing a pattern
// could recognise. Only knowing the value masks them.
const RELAY_KEY = 'kz-91Ab_x7.Qm4';
const WS_TOKEN = 'wst_51d0e8c3';

/** The failure line an adapter writes to the daemon log, with its level. */
const failureLog = (a) => a.logged.find((l) => /failed \(/i.test(l.text));

// ---------------------------------------------------------------- Hermes

function makeHermes(sessions = {}, agentEnv = {}) {
  const a = createAdapter('hermes', {
    workspaceId: 'ws-test', channelName: 'general', token: WS_TOKEN,
    agentName: 'hermes-bot', endpoint: 'https://example.invalid',
    agentType: 'hermes', agentEnv, workingDir: os.tmpdir(),
  });
  harness(a);
  a._hermesBin = '/nonexistent/hermes';
  a._writePrefill = async () => null;
  a._buildPrompt = async (_channel, content) => content;
  Object.assign(a._channelSessions, sessions);
  return a;
}

describe('Hermes — a failed run says why', () => {
  // In -Q mode Hermes reports a backend error that produced no reply on
  // stderr, followed by the session the turn is in.
  it('posts sign-in guidance instead of the raw stderr, and keeps the session', async () => {
    const a = makeHermes({ 'chan-1': 'S-live' });
    script = [{
      stderr: `Error: 401 Unauthorized (api_key: ${OPENAI_KEY})\n\nsession_id: S-live\n`,
      code: 1,
    }];

    await a._handleMessage(MSG);

    assert.equal(spawns.length, 1, 'an auth failure is not retried');
    assert.equal(a.posted.response.length, 0);
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /LLM_API_KEY/);
    assert.match(a.posted.error[0], /Details:/);
    assert.ok(!a.posted.error[0].includes(OPENAI_KEY), a.posted.error[0]);
    assert.ok(!a.posted.error[0].includes('session_id'), a.posted.error[0]);
    assert.ok(!a.posted.error[0].startsWith('Error processing message'), a.posted.error[0]);
    assert.equal(a._channelSessions['chan-1'], 'S-live', 'the channel keeps its history');
    assert.equal(failureLog(a).level, 'error');
  });

  it('quotes what Hermes said when nothing explains the failure', async () => {
    const a = makeHermes({ 'chan-1': 'S-live' });
    script = [{ stderr: 'something odd happened\n\nsession_id: S-live\n', code: 1 }];

    await a._handleMessage(MSG);

    assert.equal(spawns.length, 1);
    assert.deepEqual(a.posted.response, []);
    assert.deepEqual(a.posted.error, ['Hermes failed (exit 1): something odd happened']);
  });

  it('masks the key this agent was given and its workspace token, whatever their format', async () => {
    const a = makeHermes({ 'chan-1': 'S-live' }, { LLM_API_KEY: RELAY_KEY });
    script = [{
      stderr: `Error: relay refused credential ${RELAY_KEY} for workspace ${WS_TOKEN}\n\nsession_id: S-live\n`,
      code: 1,
    }];

    await a._handleMessage(MSG);

    assert.deepEqual(a.posted.error, [
      'Hermes failed (exit 1): Error: relay refused credential [REDACTED] for workspace [REDACTED]',
    ]);
  });

  it('does not read a cause into the model\'s own reply', async () => {
    // stdout is the reply. The turn failed for a reason stderr does not give,
    // and a reply that talks about a sign-in page and a settings.json is not
    // an auth or a config failure.
    const a = makeHermes({ 'chan-1': 'S-live' }, { LLM_API_KEY: RELAY_KEY });
    const reply =
      'The sign-in page rendered, but settings.json was not found and the request was forbidden.\n'
      + `I stopped after the provider rejected ${RELAY_KEY}; the token limit was reached.`;
    script = [{ stdout: `${reply}\n`, stderr: 'session_id: S-live\n', code: 1 }];

    await a._handleMessage(MSG);

    assert.equal(a.posted.error.length, 1);
    assert.ok(!/LLM_API_KEY|could not authenticate|configuration is invalid/i.test(a.posted.error[0]), a.posted.error[0]);
    // Hermes's account is posted as it stands, minus this agent's own key.
    assert.equal(a.posted.error[0], reply.replace(RELAY_KEY, '[REDACTED]'));
  });
});

// ------------------------------------------------------------------- Amp

describe('Amp — a failed run says why', () => {
  it('replaces "No response generated" with the reason', async () => {
    const a = createAdapter('amp', {
      workspaceId: 'ws-test', channelName: 'general', token: 'tok',
      agentName: 'amp-bot', endpoint: 'https://example.invalid',
      agentType: 'amp', agentEnv: {}, workingDir: os.tmpdir(),
    });
    harness(a);
    a._ampBin = '/nonexistent/amp';
    a._reportStatus = () => {};
    a.getBrowserEnabled = async () => false;
    a._buildSystemContext = () => 'ctx';
    script = [{ stderr: 'Error: 429 Too Many Requests — rate limit exceeded\n', code: 1 }];

    await a._handleMessage(MSG);

    assert.deepEqual(a.posted.response, []);
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /rate-limited|out of credit/i);
    assert.match(a.posted.error[0], /Details: .*429/);
    assert.equal(failureLog(a).level, 'error');
  });

  it('masks the agent\'s own key in what it quotes', async () => {
    const a = createAdapter('amp', {
      workspaceId: 'ws-test', channelName: 'general', token: WS_TOKEN,
      agentName: 'amp-bot', endpoint: 'https://example.invalid',
      agentType: 'amp', agentEnv: { AMP_API_KEY: RELAY_KEY }, workingDir: os.tmpdir(),
    });
    harness(a);
    a._ampBin = '/nonexistent/amp';
    a._reportStatus = () => {};
    a.getBrowserEnabled = async () => false;
    a._buildSystemContext = () => 'ctx';
    script = [{ stderr: `Error: credential ${RELAY_KEY} was refused\n`, code: 1 }];

    await a._handleMessage(MSG);

    assert.equal(a.posted.error.length, 1);
    assert.ok(!a.posted.error[0].includes(RELAY_KEY), a.posted.error[0]);
    assert.match(a.posted.error[0], /credential \[REDACTED\] was refused/);
  });
});

// ---------------------------------------------------------------- Cursor

describe('Cursor — an errored result reaches the channel', () => {
  it('posts the reason and keeps the session instead of retrying', async () => {
    const a = createAdapter('cursor', {
      workspaceId: 'ws-test', channelName: 'general', token: 'tok',
      agentName: 'cursor-bot', endpoint: 'https://example.invalid',
      agentType: 'cursor', agentEnv: {}, workingDir: os.tmpdir(),
    });
    harness(a);
    a._findCursorBinary = () => '/nonexistent/cursor-agent';
    a._ensureWorkspaceSkill = async () => {};
    a._channelSessions['chan-1'] = 'S-live';
    const frames = [
      { type: 'system', session_id: 'S-live' },
      { type: 'result', session_id: 'S-live', is_error: true, result: 'Your Cursor plan has no requests left (429).' },
    ].map((f) => `${JSON.stringify(f)}\n`).join('');
    script = [{ stdout: frames, code: 1 }];

    await a._handleMessage(MSG);

    assert.equal(spawns.length, 1, 'a quota failure is not retried from a fresh session');
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /rate-limiting|requests left/i);
    assert.ok(!a.posted.response.includes('No response generated. Please try again.'));
    assert.equal(a._channelSessions['chan-1'], 'S-live');
  });
});

// -------------------------------------------------------------- OpenClaw

function makeOpenClaw(agentEnv = {}) {
  const a = createAdapter('openclaw', {
    workspaceId: 'ws-test-openclaw', channelName: 'general', token: WS_TOKEN,
    agentName: 'claw-bot', endpoint: 'https://example.invalid',
    agentType: 'openclaw', agentEnv, workingDir: os.tmpdir(),
  });
  harness(a);
  a._openclawBinary = '/nonexistent/openclaw.mjs';
  return a;
}

describe('OpenClaw — a failed run says why', () => {
  // stderr of openclaw 2026.7.1 run with a rejected key, shortened: stdout is
  // empty, and the reason is one line among the --log-level trace.
  const TRACE_401 =
    '[provider-transport-fetch] [model-fetch] start provider=openai api=openai-responses model=gpt-5.5 method=POST\n'
    + `[openai-transport] [responses] error provider=openai status=401 code=invalid_api_key message=401 Incorrect API key provided: ${OPENAI_KEY}.\n`
    + '[agent/embedded] embedded run agent end: runId=dae455a2 isError=true model=gpt-5.5 provider=openai\n'
    + '[diagnostic] lane task error: lane=main durationMs=4708 error="FailoverError: Authentication failed (provider returned HTTP 401)."\n'
    + '[model-fallback/decision] model fallback decision: decision=candidate_failed requested=openai/gpt-5.5 reason=auth next=none\n';

  it('quotes the telling trace line, not the last 300 characters of noise', async () => {
    const a = makeOpenClaw();
    script = [{ stderr: TRACE_401, code: 1 }];

    await a._handleMessage({ ...MSG, sessionId: 'chan-1' });

    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /LLM_API_KEY/);
    assert.match(a.posted.error[0], /Authentication failed \(provider returned HTTP 401\)/);
    assert.ok(!a.posted.error[0].includes(OPENAI_KEY), a.posted.error[0]);
    assert.ok(!a.posted.error[0].includes('model-fetch'), a.posted.error[0]);
    assert.deepEqual(a.posted.response, []);
    assert.equal(failureLog(a).level, 'error');
  });

  it('reads the error object a failed --json run prints on stdout', async () => {
    // openclaw 2026.9.8 reports a failure as {"ok":false,"error":{type,message}}.
    const a = makeOpenClaw({ LLM_API_KEY: RELAY_KEY });
    const message =
      'Auth profile store requires legacy credential migration; run openclaw doctor --fix '
      + `(profile openai:manual, key ${RELAY_KEY})`;
    // The message asks for a Doctor migration, so the adapter runs
    // `openclaw doctor --fix` once; that repair fails here, leaving the
    // original error to be reported.
    script = [{
      stdout: `${JSON.stringify({ ok: false, error: { type: 'cli_error', message } })}\n`,
      code: 1,
    }, { stderr: 'doctor: nothing to migrate\n', code: 1 }];

    await a._handleMessage({ ...MSG, sessionId: 'chan-1' });

    assert.deepEqual(a.posted.error, [
      `OpenClaw failed (exit 1): ${message.replace(RELAY_KEY, '[REDACTED]')}`,
    ]);
  });

  it('does not read a cause into the model\'s own reply', async () => {
    // --json writes the reply into stderr beside the trace. The run crashed
    // for a reason of its own; what the model had written is not evidence.
    const a = makeOpenClaw();
    const reply = { payloads: [{ text: 'Please sign in first — settings.json is malformed and the API key is invalid.' }], meta: {} };
    script = [{
      stdout: 'Please sign in to continue\n',
      stderr:
        '[agent/embedded] embedded run agent start\n'
        + `${JSON.stringify(reply, null, 2)}\n`
        + 'RangeError: Maximum call stack size exceeded\n',
      code: 1,
    }];

    await a._handleMessage({ ...MSG, sessionId: 'chan-1' });

    assert.deepEqual(a.posted.error, [
      'OpenClaw failed (exit 1): RangeError: Maximum call stack size exceeded',
    ]);
  });

  it('keeps braces inside the reply text from cutting the reply short or swallowing the trace', async () => {
    // An unbalanced "}" in the reply once closed the envelope early (leaking
    // the rest of the reply into the cause); an unbalanced "{" kept it open
    // through the trace that followed.
    for (const text of [
      'Use `if (x) }` then sign in — settings.json is malformed and the API key is invalid',
      'Open with `{` and \\"quote\\" {{ — please sign in, the API key is invalid',
    ]) {
      const a = makeOpenClaw();
      const reply = { payloads: [{ text }], meta: {} };
      script = [{
        stdout: '',
        stderr:
          '[agent/embedded] embedded run agent start\n'
          + `${JSON.stringify(reply, null, 2)}\n`
          + 'RangeError: Maximum call stack size exceeded\n',
        code: 1,
      }];

      await a._handleMessage({ ...MSG, sessionId: 'chan-1' });

      assert.deepEqual(a.posted.error, [
        'OpenClaw failed (exit 1): RangeError: Maximum call stack size exceeded',
      ], text);
    }
  });
});

// ----------------------------------------------------------- Direct API

describe('Direct LLM API — a rejected call says why', () => {
  it('turns a 401 body into guidance without echoing the key', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { message: `Incorrect API key provided: ${OPENAI_KEY}. You can find your API key at …`, code: 'invalid_api_key' },
      }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();

    // The base itself: what NanoClaw and Cursor's direct mode both run on.
    const a = new LlmDirectAdapter({
      workspaceId: 'ws-test', channelName: 'general', token: 'tok',
      agentName: 'direct-bot', endpoint: 'https://example.invalid',
      agentType: 'nanoclaw', workingDir: os.tmpdir(), adapterLabel: 'NanoClaw',
      suppressConfigLog: true,
      agentEnv: { OPENAI_API_KEY: OPENAI_KEY, OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` },
    });
    harness(a);

    try {
      await a._handleMessage(MSG);
    } finally {
      await new Promise((r) => server.close(r));
    }

    assert.deepEqual(a.posted.response, []);
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /OPENAI_API_KEY/);
    assert.match(a.posted.error[0], /Details:/);
    assert.ok(!a.posted.error[0].includes(OPENAI_KEY), a.posted.error[0]);
    assert.ok(!a.posted.error[0].startsWith('Error processing message'), a.posted.error[0]);
    assert.equal(failureLog(a).level, 'error');
  });

  it('masks a relay key no pattern recognises when the relay echoes it', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `upstream rejected ${RELAY_KEY} (expired)` }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();

    const a = new LlmDirectAdapter({
      workspaceId: 'ws-test', channelName: 'general', token: WS_TOKEN,
      agentName: 'direct-bot', endpoint: 'https://example.invalid',
      agentType: 'nanoclaw', workingDir: os.tmpdir(), adapterLabel: 'NanoClaw',
      suppressConfigLog: true,
      agentEnv: { OPENAI_API_KEY: RELAY_KEY, OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` },
    });
    harness(a);

    try {
      await a._handleMessage(MSG);
    } finally {
      await new Promise((r) => server.close(r));
    }

    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /upstream rejected \[REDACTED\] \(expired\)/);
    assert.ok(!a.posted.error[0].includes(RELAY_KEY), a.posted.error[0]);
  });
});

describe('Kimi direct API — the guidance names the settings Kimi reads', () => {
  it('points at KIMI_API_KEY / KIMI_BASE_URL, never at OPENAI_*', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid Authentication', type: 'invalid_authentication_error' } }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();

    const a = createAdapter('kimi', {
      workspaceId: 'ws-test', channelName: 'general', token: 'tok',
      agentName: 'kimi-bot', endpoint: 'https://example.invalid',
      agentType: 'kimi', workingDir: os.tmpdir(),
      agentEnv: { KIMI_API_KEY: OPENAI_KEY, KIMI_BASE_URL: `http://127.0.0.1:${port}/v1` },
    });
    harness(a);
    a._findKimiBinary = () => null; // no CLI on this device: the direct fallback

    try {
      await a._handleMessage(MSG);
    } finally {
      await new Promise((r) => server.close(r));
    }

    assert.deepEqual(a.posted.response, []);
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /Check KIMI_API_KEY for this agent/);
    assert.match(a.posted.error[0], /in KIMI_BASE_URL\./);
    assert.ok(!/OPENAI_/.test(a.posted.error[0]), a.posted.error[0]);
    assert.match(a.posted.error[0], /Details: HTTP status 401/);
  });
});

// ------------------------------------------------- Unclassified failures

/**
 * The last-resort paths: an exception nothing classified. The text is whatever
 * the failing call threw — a spawn error quoting its argv, an HTTP client
 * quoting its request — so it is redacted like any other CLI output.
 */
describe('An unclassified exception is redacted before it reaches the channel', () => {
  // One secret a pattern recognises, and two only their value gives away: the
  // agent's own key and the workspace token it posts with.
  const THROWN =
    `connect ECONNRESET https://api.example.invalid/v1?api_key=${OPENAI_KEY} `
    + `(key ${RELAY_KEY}, workspace ${WS_TOKEN})`;
  const assertNothingSecret = (text) => {
    for (const secret of [OPENAI_KEY, RELAY_KEY, WS_TOKEN]) assert.ok(!text.includes(secret), text);
  };

  it('redacts the adapter-level "Error processing message" fallback', async () => {
    const a = makeHermes({}, { LLM_API_KEY: RELAY_KEY });
    a._buildPrompt = async () => { throw new Error(THROWN); };

    await a._handleMessage(MSG);

    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /^Error processing message: connect ECONNRESET/);
    assertNothingSecret(a.posted.error[0]);
  });

  it('redacts the channel worker\'s "Agent error" catch-all, for every adapter', async () => {
    const a = makeHermes({}, { LLM_API_KEY: RELAY_KEY });
    a._handleMessage = async () => { throw new Error(THROWN); };

    await a._channelWorker('chan-1', { ...MSG });

    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /^Agent error: connect ECONNRESET/);
    assertNothingSecret(a.posted.error[0]);
  });

  it('leaves no adapter posting a raw exception message', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.join(__dirname, '..', 'src', 'adapters');
    const offenders = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      fs.readFileSync(path.join(dir, file), 'utf-8').split('\n').forEach((line, i) => {
        if (/_log\(/.test(line)) return;
        if (/`(?:Error processing message|Agent error): \$\{(?:e|err|error)(?:\.message)?\}/.test(line)) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(offenders, []);
  });
});
