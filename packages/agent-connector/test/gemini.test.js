'use strict';

/**
 * GeminiAdapter end to end against a faked Gemini CLI process: what a run
 * posts to the channel when it fails, and when it retries from a fresh session.
 *
 * No real `gemini` binary or workspace. child_process.spawn is swapped before
 * the adapter loads — the ../wsl bridge binds it at require time — and the
 * channel helpers are stubbed on the instance.
 */

const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const os = require('node:os');
const cp = require('node:child_process');

const realSpawn = cp.spawn;
let spawns = [];
let script = []; // one step per expected spawn: { events, stderr, code, hang }

cp.spawn = (cmd, args, opts) => {
  const step = script.shift() || { events: [], code: 0 };
  const proc = new EventEmitter();
  proc.pid = 999999;
  proc.exitCode = null;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.finish = (code, signal = null) => {
    proc.exitCode = code;
    proc.emit('exit', code, signal);
  };
  spawns.push({ cmd, args, opts, proc });
  setImmediate(() => {
    for (const ev of step.events || []) {
      proc.stdout.emit('data', Buffer.from(JSON.stringify(ev) + '\n', 'utf-8'));
    }
    if (step.stderr) proc.stderr.emit('data', Buffer.from(step.stderr, 'utf-8'));
    if (!step.hang) proc.finish(step.code ?? 0);
  });
  return proc;
};

const { createAdapter } = require('../src/adapters');

after(() => { cp.spawn = realSpawn; });

beforeEach(() => {
  spawns = [];
  script = [];
});

function makeAdapter({ sessions = {} } = {}) {
  const a = createAdapter('gemini', {
    workspaceId: `ws-gemini-test-${process.pid}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'gemini-bot',
    endpoint: 'https://example.invalid',
    agentType: 'gemini',
    agentEnv: {},
    workingDir: os.tmpdir(),
  });
  a._findGeminiBinary = () => '/nonexistent/gemini';
  a._saveSessions = () => {};
  a._log = () => {};
  Object.assign(a._channelSessions, sessions);
  a.client = { getSession: async () => ({}), updateSession: async () => {} };
  a.posted = { response: [], error: [], status: [], thinking: [] };
  a.sendResponse = async (_c, text) => { a.posted.response.push(text); };
  a.sendError = async (_c, text) => { a.posted.error.push(text); };
  a.sendStatus = async (_c, text) => { a.posted.status.push(text); };
  a.sendThinking = async (_c, text) => { a.posted.thinking.push(text); };
  return a;
}

const MSG = { content: 'hi', sessionId: 'chan-1', senderName: 'you' };
const QUOTA_ERROR = {
  type: 'Error',
  message:
    '[API Error: You exceeded your current quota, please check your plan and billing details. ' +
    '(Status: RESOURCE_EXHAUSTED)]',
};

describe('GeminiAdapter — what a run posts', () => {
  it('posts the reply of a successful run and records its session', async () => {
    const a = makeAdapter();
    script = [{
      events: [
        { type: 'init', session_id: 'S-new' },
        { type: 'message', role: 'assistant', content: 'Hello there', delta: true },
        { type: 'result', status: 'success' },
      ],
    }];
    await a._handleMessage(MSG);
    assert.deepEqual(a.posted.response, ['Hello there']);
    assert.deepEqual(a.posted.error, []);
    assert.equal(a._channelSessions['chan-1'], 'S-new');
  });

  it('still says so when a clean run produced no text', async () => {
    const a = makeAdapter();
    script = [{ events: [{ type: 'result', status: 'success' }] }];
    await a._handleMessage(MSG);
    assert.deepEqual(a.posted.response, ['No response generated. Please try again.']);
    assert.deepEqual(a.posted.error, []);
  });

  it('posts the reason an API call failed, keeps the session and does not retry', async () => {
    const a = makeAdapter({ sessions: { 'chan-1': 'S-old' } });
    script = [{
      events: [
        { type: 'init', session_id: 'S-old' },
        { type: 'result', status: 'error', error: QUOTA_ERROR },
      ],
      code: 1,
    }];
    await a._handleMessage(MSG);
    assert.equal(spawns.length, 1);
    assert.ok(spawns[0].args.includes('-r') && spawns[0].args.includes('S-old'));
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /quota/i);
    assert.match(a.posted.error[0], /RESOURCE_EXHAUSTED/);
    assert.deepEqual(a.posted.response, []);
    assert.equal(a._channelSessions['chan-1'], 'S-old');
  });

  it('posts sign-in guidance when the CLI has no auth method (exit 41, stderr only)', async () => {
    const a = makeAdapter();
    script = [{
      stderr:
        'Please set an Auth method in your /home/u/.gemini/settings.json or specify one of the ' +
        'following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, ' +
        'GOOGLE_GENAI_USE_GCA\n',
      code: 41,
    }];
    await a._handleMessage(MSG);
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /GEMINI_API_KEY/);
    assert.deepEqual(a.posted.response, []);
  });

  it('posts both the partial answer and the error that cut it off', async () => {
    const a = makeAdapter();
    script = [{
      events: [
        { type: 'message', role: 'assistant', content: 'Partial answer', delta: true },
        {
          type: 'result',
          status: 'error',
          error: { type: 'Error', message: '[API Error: exception TypeError: fetch failed sending request]' },
        },
      ],
      code: 1,
    }];
    await a._handleMessage(MSG);
    assert.deepEqual(a.posted.response, ['Partial answer']);
    assert.equal(a.posted.error.length, 1);
    assert.match(a.posted.error[0], /could not reach/);
  });
});

describe('GeminiAdapter — retrying without resume', () => {
  it('retries once from a fresh session when the stored one cannot be resumed', async () => {
    const a = makeAdapter({ sessions: { 'chan-1': 'S-gone' } });
    script = [
      { stderr: 'Error resuming session: Invalid session identifier "S-gone".\n', code: 42 },
      {
        events: [
          { type: 'init', session_id: 'S-fresh' },
          { type: 'message', role: 'assistant', content: 'Hi', delta: true },
          { type: 'result', status: 'success' },
        ],
      },
    ];
    await a._handleMessage(MSG);
    assert.equal(spawns.length, 2);
    assert.ok(spawns[0].args.includes('-r'));
    assert.ok(!spawns[1].args.includes('-r'));
    assert.deepEqual(a.posted.response, ['Hi']);
    assert.deepEqual(a.posted.error, []);
    assert.equal(a._channelSessions['chan-1'], 'S-fresh');
  });

  it('a run the user stopped is neither retried nor reported as a failure', async () => {
    const a = makeAdapter({ sessions: { 'chan-1': 'S-live' } });
    // Never kill a real pid from a test: finish the fake process instead.
    a._stopProcess = async (proc) => proc.finish(null, 'SIGTERM');
    script = [{ events: [{ type: 'init', session_id: 'S-live' }], hang: true }];

    const handled = a._handleMessage(MSG);
    while (!a._channelProcesses['chan-1']) await new Promise((r) => setImmediate(r));
    await a._stopAllProcesses();
    await handled;

    assert.equal(spawns.length, 1);
    assert.deepEqual(a.posted.error, []);
    assert.deepEqual(a.posted.response, []);
    assert.ok(a.posted.status.includes('Execution stopped by user'));
    assert.equal(a._channelSessions['chan-1'], 'S-live');
  });
});
