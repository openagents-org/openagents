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
    if (step.stderr) proc.stderr.emit('data', Buffer.from(step.stderr, 'utf-8'));
    proc.exitCode = step.code ?? 0;
    proc.emit('exit', step.code ?? 0, null);
  });
  return proc;
};

const { createAdapter } = require('../src/adapters');
const LlmDirectAdapter = require('../src/adapters/llm-direct');

after(() => { cp.spawn = realSpawn; });
beforeEach(() => { spawns = []; script = []; });

/** Common stubs: no workspace, no real binary, everything posted is captured. */
function harness(a) {
  a._log = () => {};
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

// ---------------------------------------------------------------- Hermes

function makeHermes(sessions = {}) {
  const a = createAdapter('hermes', {
    workspaceId: 'ws-test', channelName: 'general', token: 'tok',
    agentName: 'hermes-bot', endpoint: 'https://example.invalid',
    agentType: 'hermes', agentEnv: {}, workingDir: os.tmpdir(),
  });
  harness(a);
  a._hermesBin = '/nonexistent/hermes';
  a._buildContextPrefix = async () => '';
  Object.assign(a._channelSessions, sessions);
  return a;
}

describe('Hermes — a failed run says why', () => {
  it('posts sign-in guidance instead of the raw stderr, and keeps the session', async () => {
    const a = makeHermes({ 'chan-1': 'S-live' });
    script = [{ stderr: `Error: 401 Unauthorized (api_key: ${OPENAI_KEY})\n`, code: 1 }];

    await a._handleMessage(MSG);

    assert.equal(spawns.length, 1, 'an auth failure is not retried');
    assert.equal(a.posted.response.length, 0);
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /LLM_API_KEY/);
    assert.match(a.posted.error[0], /Details:/);
    assert.ok(!a.posted.error[0].includes(OPENAI_KEY), a.posted.error[0]);
    assert.ok(!a.posted.error[0].startsWith('Error processing message'), a.posted.error[0]);
    assert.equal(a._channelSessions['chan-1'], 'S-live', 'the channel keeps its history');
  });

  it('still retries once from a fresh session when nothing explains the failure', async () => {
    const a = makeHermes({ 'chan-1': 'S-gone' });
    script = [
      { stderr: 'something odd happened\n', code: 1 },
      { stdout: 'session_id: S-fresh\nHello there\n', code: 0 },
    ];

    await a._handleMessage(MSG);

    assert.equal(spawns.length, 2);
    assert.ok(spawns[0].args.includes('--resume'));
    assert.ok(!spawns[1].args.includes('--resume'));
    assert.deepEqual(a.posted.error, []);
    assert.equal(a.posted.response.length, 1);
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

describe('OpenClaw — a failed run says why', () => {
  it('quotes the telling trace line, not the last 300 characters of noise', async () => {
    const a = createAdapter('openclaw', {
      workspaceId: 'ws-test-openclaw', channelName: 'general', token: 'tok',
      agentName: 'claw-bot', endpoint: 'https://example.invalid',
      agentType: 'openclaw', agentEnv: {}, workingDir: os.tmpdir(),
    });
    harness(a);
    a._openclawBinary = '/nonexistent/openclaw.mjs';
    // --log-level trace: the reason is one line among many, and the tail of the
    // stream is unrelated chatter.
    script = [{
      stdout:
        'trace: embedded run agent start\n'
        + `trace: config loaded (api_key: ${OPENAI_KEY})\n`
        + 'Error: 401 Unauthorized from the model endpoint\n'
        + 'trace: shutting down workers\n',
      code: 1,
    }];

    await a._handleMessage({ ...MSG, sessionId: 'chan-1' });

    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /LLM_API_KEY/);
    assert.match(a.posted.error[0], /401 Unauthorized/);
    assert.ok(!a.posted.error[0].includes(OPENAI_KEY), a.posted.error[0]);
    assert.ok(!a.posted.error[0].includes('shutting down workers'), a.posted.error[0]);
    assert.deepEqual(a.posted.response, []);
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
  });
});
