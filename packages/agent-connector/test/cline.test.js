'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ClineAdapter = require('../src/adapters/cline');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');
const { buildClineArgs } = require('../src/adapters/cline-stream');

const IS_WINDOWS = process.platform === 'win32';

// ---------------------------------------------------------------------------
// A mock `cline` binary: a Node script that emits a scripted NDJSON sequence
// (matching the real v3.0.26 wire format) chosen by FAKE_SCENARIO, so the
// adapter's spawn → parse → stream path can be exercised without a real CLI,
// API key, or network. Written once for the suite.
// ---------------------------------------------------------------------------
let tmpRoot;
let fakeBin;

const FAKE_SCRIPT = `#!/usr/bin/env node
'use strict';
const args = process.argv.slice(2);
// Subcommands used by the adapter's helpers:
if (args[0] === '--version') { process.stdout.write((process.env.FAKE_VERSION || '3.0.26') + '\\n'); process.exit(0); }
if (args[0] === 'history') { process.stdout.write((process.env.FAKE_HISTORY || '[]') + '\\n'); process.exit(0); }
const scenario = process.env.FAKE_SCENARIO || 'complete';
const ts = '2026-06-17T00:00:00.000Z';
const w = (o) => process.stdout.write(JSON.stringify(Object.assign({ts}, o)) + '\\n');
const agent = (event) => w({ type: 'agent_event', event });

let stopped = false;
const onSig = () => { stopped = true; w({ type: 'run_aborted', reason: 'sigterm', message: 'aborted' }); process.exit(130); };
process.on('SIGINT', onSig);
process.on('SIGTERM', onSig);

if (scenario === 'complete') {
  w({ type: 'hook_event', hookEventName: 'agent_start', agentId: 'a1', taskId: 'c1', parentAgentId: null });
  w({ type: 'run_start', providerId: 'cline', modelId: 'm', catalog: 'live', thinking: 'off', mode: 'act' });
  agent({ type: 'iteration_start', iteration: 1 });
  // streamed text deltas + final block
  agent({ type: 'content_start', contentType: 'text', text: 'Hel', accumulated: 'Hel' });
  agent({ type: 'content_start', contentType: 'text', text: 'lo', accumulated: 'Hello' });
  agent({ type: 'content_end', contentType: 'text', text: 'Hello, I will edit a file.' });
  // a tool call
  agent({ type: 'content_start', contentType: 'tool', toolName: 'editor', toolCallId: 't1', input: { file_path: 'src/x.js' } });
  agent({ type: 'content_end', contentType: 'tool', toolName: 'editor', toolCallId: 't1', output: 'ok', durationMs: 5 });
  agent({ type: 'iteration_end', iteration: 1, hadToolCalls: true, toolCallCount: 1 });
  // final answer block (after the tool)
  agent({ type: 'content_end', contentType: 'text', text: 'Done — edited src/x.js.' });
  agent({ type: 'done', reason: 'completed', text: 'Done — edited src/x.js.', iterations: 1 });
  w({ type: 'hook_event', hookEventName: 'agent_end', agentId: 'a1', taskId: 'c1', parentAgentId: null });
  w({ type: 'run_result', finishReason: 'completed', iterations: 1, durationMs: 10, text: 'Done — edited src/x.js.', model: { id: 'm' } });
  process.exit(0);
} else if (scenario === 'auth_error') {
  // Faithful to real Cline v3.0.27: a benign 'hook dispatch failed' diagnostic
  // on stderr, the failure carried by a done{reason:'error'} (text = message),
  // a run_result{finishReason:'error'}, and the real error repeated on stderr.
  w({ type: 'hook_event', hookEventName: 'agent_start', agentId: 'a1', taskId: 'c1', parentAgentId: null });
  process.stderr.write(JSON.stringify({ ts, type: 'error', message: 'hook dispatch failed: session.hook requires a valid hook event payload' }) + '\\n');
  agent({ type: 'iteration_start', iteration: 1 });
  agent({ type: 'done', reason: 'error', text: "Unauthorized: Please re-authenticate your Cline account.", iterations: 1 });
  w({ type: 'run_result', finishReason: 'error', iterations: 1, durationMs: 3, text: 'Unauthorized: Please re-authenticate your Cline account.', model: { id: 'm' } });
  process.stderr.write(JSON.stringify({ ts, type: 'error', message: 'Unauthorized: Please re-authenticate your Cline account.' }) + '\\n');
  process.exit(1);
} else if (scenario === 'stderr_noise') {
  // Diagnostic noise on stderr (NOT JSON error) must never become a reply.
  process.stderr.write('debug: starting up\\n[trace] connecting to hub on 127.0.0.1\\n');
  agent({ type: 'content_end', contentType: 'text', text: 'The real answer.' });
  w({ type: 'run_result', finishReason: 'completed', iterations: 1, durationMs: 4, text: 'The real answer.', model: { id: 'm' } });
  process.exit(0);
} else if (scenario === 'hang') {
  w({ type: 'hook_event', hookEventName: 'agent_start', agentId: 'a1', taskId: 'c1', parentAgentId: null });
  agent({ type: 'iteration_start', iteration: 1 });
  setInterval(() => {}, 1000); // run forever until signalled
} else if (scenario === 'net_error') {
  // A real network failure alongside the benign hook-dispatch noise.
  process.stderr.write(JSON.stringify({ ts, type: 'error', message: 'hook dispatch failed: session.hook requires a valid hook event payload' }) + '\\n');
  agent({ type: 'done', reason: 'error', text: 'getaddrinfo ENOTFOUND api.example.com', iterations: 1 });
  w({ type: 'run_result', finishReason: 'error', iterations: 1, durationMs: 3, text: 'getaddrinfo ENOTFOUND api.example.com', model: { id: 'm' } });
  process.exit(1);
} else if (scenario === 'stderr_only_real') {
  // No run_result/done error — the failure is ONLY on stderr, mixed with the
  // benign noise. The benign line must be filtered; the real one must survive.
  process.stderr.write(JSON.stringify({ ts, type: 'error', message: 'hook dispatch failed: session.hook requires a valid hook event payload' }) + '\\n');
  process.stderr.write(JSON.stringify({ ts, type: 'error', message: 'hook dispatch failed: provider crashed unexpectedly' }) + '\\n');
  process.exit(1);
} else {
  process.exit(0);
}
`;

function makeAdapter(extra = {}) {
  const a = new ClineAdapter({
    workspaceId: 'ws',
    channelName: 'thread',
    token: 'token',
    agentName: 'cline-bot',
    agentEnv: extra.agentEnv || {},
    workingDir: extra.workingDir || tmpRoot,
  });
  // Stub all network-touching message helpers to capture calls.
  a._captured = { thinking: [], status: [], response: [], error: [], todos: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a.sendFinalResult = async (_t, _c, t) => { a._captured.response.push(t); };
  a.sendFinalError = async (_t, _c, t) => { a._captured.error.push(t); };
  a.sendNeedsInput = async (_t, _c, t) => { a._captured.response.push(t); };
  a.sendCancelled = async (_t, _c, t) => { a._captured.response.push(t); };
  a.sendTodos = async (_c, t) => { a._captured.todos.push(t); };
  a._log = () => {};
  // Stub the workspace client calls _handleMessage makes (all wrapped in
  // try/catch in the adapter, but give benign returns so the happy path runs).
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => [],
  };
  // Point binary resolution at the mock.
  a._findClineBinary = () => fakeBin;
  return a;
}

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-test-'));
  fakeBin = path.join(tmpRoot, IS_WINDOWS ? 'fake-cline.cmd' : 'fake-cline');
  if (IS_WINDOWS) {
    // A .cmd that shells to node on the sibling .js (mirrors npm shims).
    fs.writeFileSync(path.join(tmpRoot, 'fake-cline.js'), FAKE_SCRIPT);
    fs.writeFileSync(fakeBin, `@echo off\r\nnode "%~dp0fake-cline.js" %*\r\n`);
  } else {
    fs.writeFileSync(fakeBin, FAKE_SCRIPT, { mode: 0o755 });
  }
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe('ClineAdapter — registration', () => {
  it('is registered under the cline agent type', () => {
    assert.equal(ADAPTER_MAP.cline, ClineAdapter);
    const inst = createAdapter('cline', { workspaceId: 'ws', channelName: 't', token: 'tok', agentName: 'c', agentEnv: {} });
    assert.ok(inst instanceof ClineAdapter);
  });
});

describe('ClineAdapter — session persistence & resume binding', () => {
  it('persists and reloads channel sessions bound to a working dir', () => {
    const a = makeAdapter();
    a._channelSessions['thread'] = { sessionId: 's-123', workingDir: '/proj' };
    a._saveSessions();

    const b = makeAdapter();
    assert.deepEqual(b._channelSessions['thread'], { sessionId: 's-123', workingDir: '/proj' });
    // resumes only when the working dir matches (never cross projects)
    assert.equal(b._resumableSession('thread', '/proj'), 's-123');
    assert.equal(b._resumableSession('thread', '/other'), null);
    b._clearSession('thread');
    assert.equal(b._resumableSession('thread', '/proj'), null);
  });
});

describe('ClineAdapter — working directory validation', () => {
  it('detects missing vs existing directories', () => {
    const a = makeAdapter();
    assert.equal(a._dirExists(tmpRoot), true);
    assert.equal(a._dirExists(path.join(tmpRoot, 'does-not-exist')), false);
  });

  it('handles paths with spaces and non-ASCII characters', () => {
    const a = makeAdapter();
    const weird = path.join(tmpRoot, 'my project 中文 dir');
    fs.mkdirSync(weird, { recursive: true });
    assert.equal(a._dirExists(weird), true);
    // and buildClineArgs carries such a path through -c without escaping
    const args = buildClineArgs({ prompt: 'hi', cwd: weird });
    assert.equal(args[args.indexOf('-c') + 1], weird);
  });
});

describe('ClineAdapter — _runCline against the mock CLI', () => {
  it('streams thinking + tool status and returns the final completed text once', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    const args = buildClineArgs({ prompt: 'edit file', cwd: tmpRoot });
    const result = await a._runCline('thread', fakeBin, args, tmpRoot);

    assert.equal(result.ok, true);
    assert.equal(result.finalText, 'Done — edited src/x.js.');
    assert.equal(result.anyOutput, true);
    assert.equal(result.userStopped, false);
    // both text blocks streamed as thinking
    assert.ok(a._captured.thinking.includes('Hello, I will edit a file.'));
    assert.ok(a._captured.thinking.includes('Done — edited src/x.js.'));
    // the tool call surfaced as a status with a friendly label + preview
    assert.ok(a._captured.status.some((s) => /Editing file/.test(s) && /src\/x\.js/.test(s)));
    // process cleaned up
    assert.equal(a._channelProcesses['thread'], undefined);
  });

  it('does not emit a duplicate final result / response', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    const args = buildClineArgs({ prompt: 'edit file', cwd: tmpRoot });
    const result = await a._runCline('thread', fakeBin, args, tmpRoot);
    // _runCline returns a single finalText; the final text block appears once
    // in the thinking stream (not repeated by the run_result echo).
    const dones = a._captured.thinking.filter((t) => t === 'Done — edited src/x.js.');
    assert.equal(dones.length, 1);
    assert.equal(result.finalText, 'Done — edited src/x.js.');
  });

  it('classifies an auth error and keeps it off the assistant reply', async () => {
    const { classifyClineError } = require('../src/adapters/cline-stream');
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'auth_error' } });
    const args = buildClineArgs({ prompt: 'do x', cwd: tmpRoot });
    const result = await a._runCline('thread', fakeBin, args, tmpRoot);
    assert.equal(result.ok, false);
    // the real error wins, not the benign 'hook dispatch failed' stderr noise…
    assert.ok(/unauthorized|re-authenticate/i.test(result.errorMessage));
    assert.ok(!/hook dispatch failed/i.test(result.errorMessage));
    // …and it classifies as auth
    assert.equal(classifyClineError(result.errorMessage).kind, 'auth');
    // a done{reason:error} text must NEVER be surfaced as the assistant answer
    assert.equal(result.finalText, '');
  });

  it('keeps stderr diagnostics out of the response (stdout/stderr isolation)', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'stderr_noise' } });
    const args = buildClineArgs({ prompt: 'answer', cwd: tmpRoot });
    const result = await a._runCline('thread', fakeBin, args, tmpRoot);
    assert.equal(result.finalText, 'The real answer.');
    // none of the stderr noise leaked into thinking/response/error
    const all = [...a._captured.thinking, ...a._captured.response, ...a._captured.error].join('\n');
    assert.ok(!/connecting to hub|debug: starting up/.test(all));
  });

  it('stops a running task: process is killed, marked userStopped, nothing left running', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'hang' } });
    const args = buildClineArgs({ prompt: 'long task', cwd: tmpRoot });
    const runPromise = a._runCline('thread', fakeBin, args, tmpRoot);

    // wait until the process is registered and has started emitting
    await waitFor(() => a._channelProcesses['thread'] && a._captured.status.length >= 0, 4000);
    const proc = a._channelProcesses['thread'];
    assert.ok(proc, 'process should be registered while running');

    a._stoppingChannels.add('thread');
    await a._stopProcess(proc);
    const result = await runPromise;

    assert.equal(result.userStopped, true);
    assert.equal(a._channelProcesses['thread'], undefined);
    // the child must really be gone
    assert.notEqual(proc.exitCode === null && proc.signalCode === null, true);
  });
});

describe('ClineAdapter — _handleMessage orchestration', () => {
  it('runs the task end-to-end and posts the final response', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    await a._handleMessage({ content: 'edit the file', sessionId: 'thread', senderType: 'human', senderName: 'user' });
    assert.ok(a._captured.response.includes('Done — edited src/x.js.'));
    assert.equal(a._captured.error.length, 0);
    assert.equal(a._channelProcesses['thread'], undefined);
  });

  it('returns a clear error when the working directory does not exist', async () => {
    const missing = path.join(tmpRoot, 'no-such-dir');
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' }, workingDir: missing });
    await a._handleMessage({ content: 'do x', sessionId: 'thread', senderType: 'human' });
    assert.ok(a._captured.error.some((e) => /working directory does not exist/i.test(e)));
    assert.equal(a._captured.response.length, 0);
  });

  it('returns a clear error when the Cline binary is not found', async () => {
    const a = makeAdapter({ agentEnv: {} });
    a._findClineBinary = () => null;
    await a._handleMessage({ content: 'do x', sessionId: 'thread', senderType: 'human' });
    assert.ok(a._captured.error.some((e) => /cline cli not found/i.test(e)));
  });

  it('surfaces a classified auth error to the user (not the raw stack)', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'auth_error' } });
    await a._handleMessage({ content: 'do x', sessionId: 'thread', senderType: 'human' });
    assert.ok(a._captured.error.some((e) => /not authenticated|re-authenticate|cline auth/i.test(e)));
    assert.equal(a._captured.response.length, 0);
  });
});

describe('ClineAdapter — hard minimum version gate', () => {
  const FAKEBIN = '/fake/cline/bin';

  it('reports compatible for >= 3.0.0', () => {
    ClineAdapter._clearVersionCache();
    const a = makeAdapter();
    a._readClineVersionRaw = () => '3.0.27';
    const v = a._checkClineVersion(FAKEBIN);
    assert.equal(v.version, '3.0.27');
    assert.equal(v.compatible, true);
  });

  it('reports incompatible for a CONFIRMED older version', () => {
    ClineAdapter._clearVersionCache();
    const a = makeAdapter();
    a._readClineVersionRaw = () => '2.0.0';
    assert.equal(a._checkClineVersion(FAKEBIN).compatible, false);
  });

  it('refuses to start the agent when the version is too old (does not spawn)', async () => {
    ClineAdapter._clearVersionCache();
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    a._readClineVersionRaw = () => '2.1.0';
    let spawned = false;
    const orig = a._runCline.bind(a);
    a._runCline = (...args) => { spawned = true; return orig(...args); };
    await a._handleMessage({ content: 'do x', sessionId: 'thread', senderType: 'human' });
    assert.equal(spawned, false, 'must not spawn an incompatible CLI');
    assert.ok(a._captured.error.some((e) => /below the minimum|3\.0\.0|upgrade/i.test(e)));
    assert.equal(a._captured.response.length, 0);
  });

  it('treats an unparseable version as undetermined (compatible:null, not blocked)', async () => {
    ClineAdapter._clearVersionCache();
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'complete' } });
    a._readClineVersionRaw = () => 'cline build banana';
    assert.equal(a._checkClineVersion(FAKEBIN).compatible, null);
    // and it proceeds to run normally
    let spawned = false;
    const orig = a._runCline.bind(a);
    a._runCline = (...args) => { spawned = true; return orig(...args); };
    await a._handleMessage({ content: 'do x', sessionId: 'thread', senderType: 'human' });
    assert.equal(spawned, true);
  });

  it('treats a failed version command as undetermined (compatible:null)', () => {
    ClineAdapter._clearVersionCache();
    const a = makeAdapter();
    a._readClineVersionRaw = () => { throw new Error('ENOENT'); };
    assert.equal(a._checkClineVersion(FAKEBIN).compatible, null);
  });

  it('caches the version (one detection within TTL) and re-detects after clear', () => {
    ClineAdapter._clearVersionCache();
    const a = makeAdapter();
    let calls = 0;
    a._readClineVersionRaw = () => { calls++; return '3.0.27'; };
    a._checkClineVersion(FAKEBIN);
    a._checkClineVersion(FAKEBIN);
    assert.equal(calls, 1, 'second call within TTL must hit the cache');
    ClineAdapter._clearVersionCache();
    a._checkClineVersion(FAKEBIN);
    assert.equal(calls, 2, 'after cache clear it re-detects');
  });
});

describe('ClineAdapter — stderr noise filtering (tightened)', () => {
  it('keeps a real network error while filtering the benign hook noise', async () => {
    const { classifyClineError } = require('../src/adapters/cline-stream');
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'net_error' } });
    const args = buildClineArgs({ prompt: 'go', cwd: tmpRoot });
    const result = await a._runCline('thread', fakeBin, args, tmpRoot);
    assert.equal(result.ok, false);
    assert.equal(classifyClineError(result.errorMessage).kind, 'network');
    assert.ok(!/hook dispatch failed/i.test(result.errorMessage));
  });

  it('does NOT filter a different "hook dispatch failed: <other>" — that is a real error', async () => {
    const a = makeAdapter({ agentEnv: { FAKE_SCENARIO: 'stderr_only_real' } });
    const args = buildClineArgs({ prompt: 'go', cwd: tmpRoot });
    const result = await a._runCline('thread', fakeBin, args, tmpRoot);
    assert.equal(result.ok, false);
    // the exact benign line is filtered; the different one survives as the error
    assert.match(result.errorMessage, /provider crashed unexpectedly/);
    assert.notEqual(result.errorMessage.trim(), 'hook dispatch failed: session.hook requires a valid hook event payload');
  });
});

describe('ClineAdapter — session capture (before/after snapshot, concurrency-safe)', () => {
  const isoNow = () => new Date(Date.now()).toISOString();

  it('binds the single new session, excluding pre-existing ids', async () => {
    const a = makeAdapter();
    a._channelSessions = {}; // isolate from any persisted sessions file
    a._readHistory = async () => ([
      { sessionId: 'old', cwd: tmpRoot, startedAt: isoNow() },
      { sessionId: 'fresh', cwd: tmpRoot, startedAt: isoNow() },
    ]);
    await a._captureSessionId('thread', fakeBin, tmpRoot, Date.now() - 1000, 'do a thing', new Set(['old']));
    assert.deepEqual(a._channelSessions['thread'], { sessionId: 'fresh', workingDir: tmpRoot });
  });

  it('declines to bind when two new sessions appear in the same working dir', async () => {
    const a = makeAdapter();
    a._channelSessions = {};
    a._readHistory = async () => ([
      { sessionId: 'a', cwd: tmpRoot, startedAt: isoNow() },
      { sessionId: 'b', cwd: tmpRoot, startedAt: isoNow() },
    ]);
    await a._captureSessionId('thread', fakeBin, tmpRoot, Date.now() - 1000, 'do a thing', new Set());
    assert.equal(a._channelSessions['thread'], undefined);
  });

  it('does not fail the turn when history is unavailable', async () => {
    const a = makeAdapter();
    a._channelSessions = {};
    a._readHistory = async () => null;
    await assert.doesNotReject(a._captureSessionId('thread', fakeBin, tmpRoot, Date.now() - 1000, 'x', new Set()));
    assert.equal(a._channelSessions['thread'], undefined);
  });
});

describe('Installer — package-bin fallback (generic; fixes Cline detection)', () => {
  // Cline's npm package declares `bin: "./bin/cline"`; a local `npm install
  // --prefix` does NOT create a node_modules/.bin shim for it, so PATH lookup
  // misses it. The installer must fall back to the package's own bin so
  // healthCheck reports installed (and the launcher badge is correct).
  const { Installer } = require('../src/installer');
  const { getRuntimePrefix } = require('../src/paths');

  it('resolves a package whose bin has no node_modules/.bin shim', () => {
    const agentType = 'clinefbtest';
    const prefix = getRuntimePrefix(agentType);
    const pkgDir = path.join(prefix, 'node_modules', agentType);
    const binDir = path.join(pkgDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: agentType, bin: { [agentType]: './bin/runme' } }));
    const binFile = path.join(binDir, 'runme');
    fs.writeFileSync(binFile, '#!/usr/bin/env node\n', { mode: 0o755 });
    try {
      const mockRegistry = {
        getEntry: () => ({
          name: agentType,
          install: { binary: agentType, linux: `npm install -g ${agentType}`, macos: `npm install -g ${agentType}`, windows: `npm install -g ${agentType}` },
        }),
      };
      const inst = new Installer(mockRegistry, fs.mkdtempSync(path.join(os.tmpdir(), 'inst-')));
      // Not on PATH → must resolve via the package-bin fallback.
      assert.equal(inst.which(agentType), binFile);
      assert.equal(inst.getInstallInfo(agentType).installed, true);
    } finally {
      fs.rmSync(prefix, { recursive: true, force: true });
    }
  });
});

describe('Installer — minimum version gate (generic; opt-in via check_ready.min_version)', () => {
  const { Installer } = require('../src/installer');
  const mkInst = (minVersion) => {
    const inst = new Installer({
      getResolveRules: () => [],
      getEntry: () => ({
        name: 'veragent',
        label: 'VerAgent',
        install: { binary: 'veragent', linux: 'npm install -g veragent', macos: 'npm install -g veragent', windows: 'npm install -g veragent' },
        check_ready: minVersion ? { min_version: minVersion } : {},
      }),
    }, fs.mkdtempSync(path.join(os.tmpdir(), 'inst-')));
    inst._whichBinary = () => '/fake/veragent';
    return inst;
  };

  it('a CONFIRMED older version → installed:true, compatible:false, ready:false, upgrade message', () => {
    const inst = mkInst('3.0.0');
    inst._detectVersion =() => '2.4.1';
    const h = inst.healthCheck('veragent');
    assert.equal(h.installed, true);
    assert.equal(h.compatible, false);
    assert.equal(h.ready, false);
    assert.match(h.message, /older than the supported minimum|upgrade/i);
  });

  it('a new-enough version → compatible:true', () => {
    const inst = mkInst('3.0.0');
    inst._detectVersion =() => '3.0.27';
    assert.equal(inst.healthCheck('veragent').compatible, true);
  });

  it('an unparseable version → compatible:null (undetermined, not force-blocked)', () => {
    const inst = mkInst('3.0.0');
    inst._detectVersion =() => 'banana';
    assert.equal(inst.healthCheck('veragent').compatible, null);
  });

  it('agents WITHOUT min_version are unaffected (compatible:true)', () => {
    const inst = mkInst(null);
    inst._detectVersion =() => '0.0.1';
    assert.equal(inst.healthCheck('veragent').compatible, true);
  });
});

function waitFor(cond, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = cond(); } catch {}
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}
