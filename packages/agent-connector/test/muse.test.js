'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MuseAdapter = require('../src/adapters/muse');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');
const { MUSE_MCP_SERVER_NAME } = require('../src/adapters/muse-stream');

// ---------------------------------------------------------------------------
// A mock Muse CLI: records how it was invoked (argv, prompt file contents, the
// env the MCP entry interpolates) and emits the record sequence Muse Code
// 1.3.0 produced for `exec --json`, so the adapter's spawn → parse → reply
// path runs with no real CLI, account, or network.
// ---------------------------------------------------------------------------
let tmpRoot;
let fakeBin;
let capturePath;
let xdgDir;

const FAKE_SCRIPT = `
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('Muse Code ' + (process.env.FAKE_VERSION || '1.3.0') + ' (1.3.0-R3401.1)\\n');
  process.exit(0);
}
const arg = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const sid = arg('--session-id');
const prompt = fs.readFileSync(arg('--prompt-file'), 'utf-8');
const known = process.env.FAKE_KNOWN_SESSIONS_FILE;
const seen = known && fs.existsSync(known) ? JSON.parse(fs.readFileSync(known, 'utf-8')) : [];
if (process.env.FAKE_CAPTURE) {
  fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ args, prompt, env: {
    OA_WORKSPACE_TOKEN: process.env.OA_WORKSPACE_TOKEN || null,
    OPENAGENTS_CHANNEL_NAME: process.env.OPENAGENTS_CHANNEL_NAME || null,
    OPENAGENTS_DISABLED_MODULES: process.env.OPENAGENTS_DISABLED_MODULES,
  } }));
}
const w = (payload_type, payload) => process.stdout.write(JSON.stringify({
  schema_version: 1, stream: { kind: 'session', id: sid }, sequence: 1,
  record_type: 'event', payload_type, payload,
}) + '\\n');
const scenario = process.env.FAKE_SCENARIO || 'success';
(function main() {
process.stderr.write('muse: workspace root: ' + process.cwd() + ' (cwd default)\\n');

if (scenario === 'auth') {
  process.stderr.write('muse: your API key from META_API_KEY was rejected\\n');
  process.exit(1);
}
if (scenario === 'stale_resume' && !seen.includes(sid) && !prompt.includes('Recent conversation') && !prompt.includes('---')) {
  process.exit(1);
}
if (known) fs.writeFileSync(known, JSON.stringify([...seen, sid]));
w('runtime.command.accepted', {});
w('task.lifecycle.proposed', { event: { task_kind: 'tool.bash' } });
w('run.output.delta', { text: 'partial' });
// A clean run reports a failed internal task; it must not fail the turn.
w('task.lifecycle.failed', { event: { kind: 'failed', reason: 'provider does not support base instructions' } });
if (scenario === 'answer_then_hang') {
  // The answer is already on stdout when the stop lands, and the process
  // lingers — the worst case for "nothing is posted after a stop".
  w('run.terminal.completed', { terminal: 'completed', reason: null, text: 'the final answer' });
  setInterval(() => {}, 1000);
  return;
}
if (scenario === 'run_failed') {
  w('run.terminal.failed', { terminal: 'failed', reason: 'model provider error', text: '' });
  process.exit(1);
}
w('run.terminal.completed', { terminal: 'completed', reason: null, text: 'Done: ' + prompt.split('\\n').pop() + '\\n' });
process.exit(0);
})();
`;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-muse-'));
  const js = path.join(tmpRoot, 'fake-muse.js');
  fs.writeFileSync(js, FAKE_SCRIPT);
  // A shell launcher, like the real one, pinned to THIS interpreter.
  fakeBin = path.join(tmpRoot, 'muse');
  fs.writeFileSync(fakeBin, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 });
  capturePath = path.join(tmpRoot, 'capture.json');
  xdgDir = path.join(tmpRoot, 'xdg');
});

const SESSIONS_FILE = path.join(os.homedir(), '.openagents', 'sessions', 'ws-muse-test_muse-bot_muse.json');

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(SESSIONS_FILE, { force: true }); } catch {}
});

beforeEach(() => {
  try { fs.rmSync(capturePath, { force: true }); } catch {}
  try { fs.rmSync(SESSIONS_FILE, { force: true }); } catch {}
  try { fs.rmSync(xdgDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(path.join(tmpRoot, 'known.json'), { force: true }); } catch {}
});

function makeAdapter(extra = {}) {
  const a = new MuseAdapter({
    workspaceId: 'ws-muse-test',
    channelName: 'thread',
    token: 'tok-secret',
    agentName: 'muse-bot',
    endpoint: 'https://example.invalid',
    agentEnv: {
      ...(extra.agentEnv || {}),
      XDG_CONFIG_HOME: xdgDir,
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      FAKE_KNOWN_SESSIONS_FILE: path.join(tmpRoot, 'known.json'),
      ...(extra.fakeVersion ? { FAKE_VERSION: extra.fakeVersion } : {}),
    },
    workingDir: tmpRoot,
    disabledModules: extra.disabledModules,
  });
  a._captured = { status: [], response: [], error: [], logs: [], notices: [] };
  a.client.sendMessage = async (_ws, _c, _t, text) => { a._captured.notices.push(text); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a._log = (m) => { a._captured.logs.push(String(m)); };
  a._autoTitleChannel = async () => {};
  a.getBrowserEnabled = async () => false;
  a.client.getRecentMessages = async () => [];
  a._findMuseBinary = () => fakeBin;
  if (extra.mode) a._mode = extra.mode;
  return a;
}

const readCapture = () => JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
const send = (a, content = 'do the thing') =>
  a._handleMessage({ content, sessionId: 'thread', senderType: 'human', senderName: 'user' });

describe('MuseAdapter — registration', () => {
  it('is reachable through the adapter registry', () => {
    assert.ok(ADAPTER_MAP.muse);
    const a = createAdapter('muse', {
      workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {},
    });
    assert.equal(a.constructor.name, 'MuseAdapter');
  });
});

describe('MuseAdapter — headless invocation', () => {
  it('passes the prompt as a file, keeps it out of argv, and deletes it', async () => {
    const a = makeAdapter();
    await send(a, 'refactor the auth module');
    const cap = readCapture();
    assert.ok(cap.prompt.endsWith('refactor the auth module'));
    assert.ok(cap.prompt.includes('muse-bot'), 'a fresh session opens with the workspace briefing');
    assert.ok(!cap.args.some((x) => x.includes('refactor the auth module')));
    assert.ok(!fs.existsSync(cap.args[cap.args.indexOf('--prompt-file') + 1]));
  });

  it('keeps the sandbox on', async () => {
    const a = makeAdapter();
    await send(a);
    const { args } = readCapture();
    assert.equal(args[args.indexOf('--approval-mode') + 1], 'never');
    assert.ok(!args.includes('--disable-sandbox') && !args.includes('--yolo'));
  });

  it('registers the MCP entry in Muse settings without writing the token', async () => {
    const a = makeAdapter({ disabledModules: new Set(['browser']) });
    await send(a);
    const file = path.join(xdgDir, 'muse', 'settings.json');
    const raw = fs.readFileSync(file, 'utf-8');
    assert.ok(!raw.includes('tok-secret'), 'the token must never land in the settings file');
    const settings = JSON.parse(raw);
    assert.equal(settings.schema_version, 1);
    assert.equal(settings.mcp_servers[MUSE_MCP_SERVER_NAME].mode, 'optional');
    // …the run's environment carries it instead.
    const { env } = readCapture();
    assert.equal(env.OA_WORKSPACE_TOKEN, 'tok-secret');
    assert.equal(env.OPENAGENTS_CHANNEL_NAME, 'thread');
    assert.equal(env.OPENAGENTS_DISABLED_MODULES, 'browser');
  });

  for (const [label, body] of [
    ['is not JSON', '{ not json'],
    ['is not an object', '[1, 2]'],
    ['has a non-object mcp_servers', '{"schema_version": 1, "mcp_servers": 5}'],
    ['lacks schema_version', '{"mcp_servers": {}}'],
  ]) {
    it(`refuses to start when the settings file ${label}, and leaves it untouched`, async () => {
      const file = path.join(xdgDir, 'muse', 'settings.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      const a = makeAdapter();
      await send(a);
      assert.equal(fs.readFileSync(file, 'utf-8'), body);
      assert.ok(!fs.existsSync(capturePath), 'Muse must not be started');
      assert.deepEqual(a._captured.response, []);
      assert.equal(a._captured.error.length, 1);
      assert.match(a._captured.error[0], /settings\.json/);
      assert.doesNotMatch(a._captured.error[0], /tools are unavailable/);
    });
  }

  it('resolves a relative XDG_CONFIG_HOME against the run directory, like the CLI', async () => {
    const a = makeAdapter();
    a.agentEnv.XDG_CONFIG_HOME = 'rel-xdg';
    await send(a);
    const file = path.join(tmpRoot, 'rel-xdg', 'muse', 'settings.json');
    try {
      assert.ok(fs.existsSync(file), 'the entry must land where Muse will look');
    } finally {
      fs.rmSync(path.join(tmpRoot, 'rel-xdg'), { recursive: true, force: true });
    }
  });

  it('plan mode disables writes and shell', async () => {
    const a = makeAdapter({ mode: 'plan' });
    await send(a);
    const { args } = readCapture();
    assert.ok(args.includes('--disable-write') && args.includes('--disable-shell'));
  });
});

describe('MuseAdapter — stop', () => {
  it('a stopped run posts no completion reply, even when the answer was already out', async () => {
    const a = makeAdapter({ scenario: 'answer_then_hang' });
    a.cleanupTodos = async () => {};
    const turn = a._dispatchMessage({ content: 'long task', sessionId: 'thread', senderType: 'human' });
    const deadline = Date.now() + 10000;
    while (!a._channelProcesses.thread && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const proc = a._channelProcesses.thread;
    assert.ok(proc, 'the run never started');
    // Let the terminal record reach the adapter before stopping.
    await new Promise((r) => setTimeout(r, 300));

    await a._onControlAction('stop', { channel: 'thread' });
    await turn;
    for (let i = 0; i < 100 && a._channelBusy.has('thread'); i++) await new Promise((r) => setTimeout(r, 20));

    assert.notEqual(proc.exitCode === null && proc.signalCode === null, true, 'the process must be gone');
    assert.deepEqual(a._captured.response, [], `completion posted after stop: ${JSON.stringify(a._captured.response)}`);
    assert.deepEqual(a._captured.error, []);
  });
});

describe('MuseAdapter — replies', () => {
  it('posts the terminal text, not the deltas, and ignores failed internal tasks', async () => {
    const a = makeAdapter();
    await send(a, 'hello');
    assert.deepEqual(a._captured.response, ['Done: hello']);
    assert.deepEqual(a._captured.error, []);
    assert.ok(a._captured.status.includes('running'), 'tool activity reaches the ticker');
  });

  it('reports a rejected key as a sign-in problem', async () => {
    const a = makeAdapter({ scenario: 'auth' });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /META_API_KEY|muse login/);
  });

  it('reports a failed run with its reason', async () => {
    const a = makeAdapter({ scenario: 'run_failed' });
    await send(a);
    assert.match(a._captured.error[0], /model provider error/);
  });

  it('refuses a CLI below the supported floor', async () => {
    const a = makeAdapter({ fakeVersion: '1.2.0' });
    await send(a);
    assert.match(a._captured.error[0], /below the minimum/);
    assert.ok(!fs.existsSync(capturePath));
  });
});

describe('MuseAdapter — session continuity', () => {
  it('reuses the channel session and sends only the bare turn', async () => {
    const a = makeAdapter();
    await send(a);
    const first = readCapture().args;
    await send(a, 'and now the tests');
    const cap = readCapture();
    const sid = (args) => args[args.indexOf('--session-id') + 1];
    assert.equal(sid(cap.args), sid(first));
    assert.equal(cap.prompt, 'and now the tests');
  });

  it('drops a session Muse no longer has and retries once from scratch', async () => {
    const a = makeAdapter({ scenario: 'stale_resume' });
    a._channelSessions.thread = { sessionId: '00000000-0000-4000-8000-000000000000', workingDir: tmpRoot, started: true };
    await send(a, 'again');
    assert.deepEqual(a._captured.response, ['Done: again']);
    assert.notEqual(a._channelSessions.thread.sessionId, '00000000-0000-4000-8000-000000000000');
  });

  it('starts a new session when the working directory changed', () => {
    const a = makeAdapter();
    a._channelSessions.thread = { sessionId: 's-1', workingDir: '/somewhere/else', started: true };
    assert.notEqual(a._sessionFor('thread', tmpRoot).sessionId, 's-1');
  });
});
