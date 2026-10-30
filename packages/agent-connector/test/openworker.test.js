'use strict';

/**
 * OpenWorker adapter, end to end against test/fixtures/mock-openworker-server.js.
 *
 * The mock speaks the real two surfaces (token-gated /v1/health, and a session
 * WebSocket whose handshake only succeeds when the launch token is one of the
 * offered subprotocols), so these tests exercise the actual spawn → poll →
 * handshake → answer-the-prompts → reply path rather than a stubbed transport.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OpenWorkerAdapter = require('../src/adapters/openworker');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');

const IS_WINDOWS = process.platform === 'win32';
const MOCK_SRC = path.join(__dirname, 'fixtures', 'mock-openworker-server.js');

let tmpRoot;
let workDir;
let fakeBin;
let seq = 0;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openworker-test-'));
  workDir = path.join(tmpRoot, 'project');
  fs.mkdirSync(path.join(workDir, 'pkg'), { recursive: true });

  const script = fs.readFileSync(MOCK_SRC, 'utf-8');
  if (IS_WINDOWS) {
    fs.writeFileSync(path.join(tmpRoot, 'fake-server.js'), script);
    fakeBin = path.join(tmpRoot, 'fake-server.cmd');
    fs.writeFileSync(fakeBin, '@ECHO off\r\nSET dp0=%~dp0\r\nnode "%dp0%\\fake-server.js" %*\r\n');
  } else {
    fakeBin = path.join(tmpRoot, 'fake-server');
    fs.writeFileSync(fakeBin, script, { mode: 0o755 });
  }
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  const sessions = path.join(os.homedir(), '.openagents', 'sessions');
  try {
    for (const f of fs.readdirSync(sessions)) {
      if (f.startsWith('ow-test-') && f.endsWith('_openworker.json')) {
        fs.rmSync(path.join(sessions, f), { force: true });
      }
    }
  } catch {}
});

const live = new Set();
beforeEach(() => {
  for (const a of live) { try { a._stopServer(); } catch {} }
  live.clear();
});

/** An adapter wired to the mock server, with every network call captured. */
function makeAdapter(extra = {}) {
  const id = ++seq;
  const capturePath = path.join(tmpRoot, `capture-${id}.json`);
  const stateDir = path.join(tmpRoot, `state-${id}`);

  const a = new OpenWorkerAdapter({
    workspaceId: `ow-test-${id}`,
    channelName: 'general',
    token: 'workspace-token-value',
    agentName: `ow-bot-${id}`,
    endpoint: 'https://example.invalid',
    workingDir: extra.workingDir || workDir,
    agentEnv: {
      // A real daemon hands the adapter a full environment; the mock's shebang
      // (and the Windows .cmd shim) need a PATH to find node.
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      FAKE_WS_PATH: require.resolve('ws'),
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      ...(extra.healthDelayMs ? { FAKE_HEALTH_DELAY_MS: String(extra.healthDelayMs) } : {}),
      ...(extra.agentEnv || {}),
    },
  });

  a._captured = { status: [], response: [], error: [], thinking: [], logs: [] };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a._log = (m) => { a._captured.logs.push(String(m)); };
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => [],
    getWorkspaceMetadata: async () => ({ browserEnabled: false }),
  };
  a._findServerBinary = () => (extra.noBinary ? null : fakeBin);
  a._stateDir = () => ({ dir: stateDir, owned: true });
  a._capturePath = capturePath;
  a._testStateDir = stateDir;
  if (extra.mode) a._mode = extra.mode;
  live.add(a);
  return a;
}

const send = (a, content = 'do the thing', channel = 'general') =>
  a._handleMessage({ content, sessionId: channel, senderType: 'human', senderName: 'user' });

function readCapture(a) {
  if (!fs.existsSync(a._capturePath)) {
    throw new Error(
      'the mock server never wrote its capture file — it did not start.\n' +
      `  errors:    ${JSON.stringify(a._captured.error)}\n` +
      `  responses: ${JSON.stringify(a._captured.response)}\n` +
      `  log:\n    ${a._captured.logs.join('\n    ')}`,
    );
  }
  return JSON.parse(fs.readFileSync(a._capturePath, 'utf-8'));
}

const frameTypes = (cap) => cap.frames.map((f) => f.type);
const frameOf = (cap, type) => cap.frames.find((f) => f.type === type);

// ---------------------------------------------------------------------------

describe('OpenWorkerAdapter — registration', () => {
  it('is reachable through the adapter registry', () => {
    assert.ok(ADAPTER_MAP.openworker);
    const a = createAdapter('openworker', {
      workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {},
    });
    assert.equal(a.constructor.name, 'OpenWorkerAdapter');
  });

  it('never spawns the TUI binary', () => {
    // `openworker` is a Textual app that wants a terminal; only the server is
    // drivable. Resolving the wrong name would hang the daemon on a TUI.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'openworker.js'), 'utf-8');
    assert.match(src, /const SERVER_BIN = 'openworker-server'/);
  });
});

describe('OpenWorkerAdapter — preflight', () => {
  it('refuses to join with an install command when the server is missing', () => {
    const verdict = makeAdapter({ noBinary: true }).preflight();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'runtime_missing');
    assert.match(verdict.message, /uv tool install/);
  });

  it('passes once the server binary resolves', () => {
    assert.deepEqual(makeAdapter().preflight(), { ok: true });
  });
});

describe('OpenWorkerAdapter — server launch', () => {
  it('launches with our own token, our state dir, and a parent to die with', async () => {
    const a = makeAdapter({
      agentEnv: { OPENWORKER_PROVIDER: 'anthropic', OPENWORKER_API_KEY: 'sk-ant-secret', OPENWORKER_MODEL: 'claude-opus-5' },
    });
    await send(a);
    const cap = readCapture(a);

    assert.equal(cap.env.hasApiToken, true, 'the server must never mint its own token file');
    assert.equal(cap.env.COWORKER_STATE_DIR, a._testStateDir);
    assert.equal(cap.env.COWORKER_EXIT_WITH_PARENT, '1');
    assert.equal(cap.env.COWORKER_PARENT_PID, String(process.pid));
  });

  it('exports the key under the variable the chosen provider reads', async () => {
    const a = makeAdapter({
      agentEnv: { OPENWORKER_PROVIDER: 'anthropic', OPENWORKER_API_KEY: 'sk-ant-secret' },
    });
    await send(a);
    const cap = readCapture(a);
    assert.equal(cap.env.ANTHROPIC_API_KEY, 'sk-ant-secret');
    assert.equal(cap.env.OPENWORKER_API_KEY, 'sk-ant-secret', 'the ${} profile reference resolves from this one');
    assert.equal(cap.env.OPENAI_API_KEY, null, "another provider's variable must stay unset");
  });

  it('qualifies the model and runs unattended by default', async () => {
    const a = makeAdapter({
      agentEnv: { OPENWORKER_PROVIDER: 'anthropic', OPENWORKER_API_KEY: 'k', OPENWORKER_MODEL: 'claude-opus-5' },
    });
    await send(a);
    const args = readCapture(a).args;
    assert.equal(args[args.indexOf('--model') + 1], 'anthropic:claude-opus-5');
    assert.equal(args[args.indexOf('--mode') + 1], 'bypass-approvals');
    assert.equal(args[args.indexOf('--cwd') + 1], workDir);
  });

  it('waits for a slow start instead of reporting the server missing', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' }, healthDelayMs: 700 });
    await send(a);
    assert.deepEqual(a._captured.error, []);
    assert.match(a._captured.response.join('\n'), /Done/);
  });

  it('reports a server that died on startup with the repair command', async () => {
    const a = makeAdapter({ scenario: 'crash', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    assert.equal(a._captured.response.length, 0);
    assert.match(a._captured.error.join('\n'), /uv tool install --force/);
  });

  it('shares one server across turns and channels', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a, 'first', 'general');
    const pidAfterFirst = a._server.proc.pid;
    await send(a, 'second', 'random');
    assert.equal(a._server.proc.pid, pidAfterFirst, 'a second channel must reuse the running server');
    const cap = readCapture(a);
    assert.equal(cap.connections.length, 2, 'one socket per turn, not one server per turn');
  });
});

describe('OpenWorkerAdapter — session handshake', () => {
  it('authenticates with the token AND offers the protocol the server echoes', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    const cap = readCapture(a);
    assert.equal(cap.rejectedHandshakes, 0);
    assert.equal(cap.connections[0].subprotocol, 'openworker');
  });

  it('addresses the session by a channel-derived id and passes the workspace folder', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a, 'hello', 'general');
    const first = readCapture(a).connections[0];
    assert.match(first.path, /^\/ws\/session\/[0-9a-f]{12}$/);
    assert.equal(first.workspace, workDir);
    assert.equal(first.agent, 'code');

    await send(a, 'hello again', 'general');
    const cap = readCapture(a);
    assert.equal(cap.connections[1].path, first.path, 'the same channel must resume the same session');

    await send(a, 'elsewhere', 'random');
    assert.notEqual(readCapture(a).connections[2].path, first.path);
  });
});

describe('OpenWorkerAdapter — a turn', () => {
  it('delivers the assistant message and tickers the tool', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    assert.deepEqual(a._captured.error, []);
    assert.equal(a._captured.response.length, 1);
    assert.match(a._captured.response[0], /Done — ran the command\./);
    assert.ok(a._captured.status.includes('running a command'), a._captured.status.join(' | '));
  });

  it('reports a provider failure as an error, not as an empty answer', async () => {
    const a = makeAdapter({ scenario: 'error', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    assert.deepEqual(a._captured.response, []);
    assert.match(a._captured.error.join('\n'), /rate limited/);
  });

  it('keeps a partial answer and appends why it stopped', async () => {
    const a = makeAdapter({ scenario: 'partial', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    assert.deepEqual(a._captured.error, []);
    const reply = a._captured.response.join('\n');
    assert.match(reply, /Got halfway\./);
    assert.match(reply, /dropped the connection/);
  });

  it('says so when a turn ends with nothing', async () => {
    const a = makeAdapter({ scenario: 'empty', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    assert.match(a._captured.response.join('\n'), /No response generated/);
  });

  it('recovers a session another daemon left mid-turn', async () => {
    // `ready.running === true` means the server still thinks a turn is live.
    // Sending into that gets rejected forever, so the adapter interrupts first.
    const a = makeAdapter({ scenario: 'busy', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    const types = frameTypes(readCapture(a));
    assert.ok(types.indexOf('interrupt') < types.indexOf('user_message'), types.join(','));
    const reply = a._captured.response.join('\n');
    assert.match(reply, /Done — ran the command\./);
    // The `interrupted` event belonged to the turn we cleared out of the way.
    assert.doesNotMatch(reply, /interrupted/i, 'a clean answer must not be labelled interrupted');
  });

  it('leaves the session unbriefed when the handshake is refused', async () => {
    // Marking it briefed here would mean the agent later runs a session that was
    // never told which workspace it is in.
    const a = makeAdapter({ scenario: 'refuse', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    assert.ok(a._captured.error.length, 'a refused handshake must surface');
    assert.equal(a._channelSessions.general, undefined);
  });
});

describe('OpenWorkerAdapter — answering the prompts', () => {
  it('approves a tool call once and answers the follow-up question', async () => {
    const a = makeAdapter({ scenario: 'prompts', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    const cap = readCapture(a);
    assert.deepEqual(frameOf(cap, 'approval'), { type: 'approval', decision: 'once' });
    assert.match(frameOf(cap, 'question_response').answer, /state the assumption/i);
    assert.match(a._captured.response.join('\n'), /Answered with:/);
    // The user has to be able to see what was decided for them.
    assert.match(a._captured.status.join(' | '), /Which branch should I use\?/);
  });

  it('denies tool calls in plan mode and tells the server it is read-only', async () => {
    const a = makeAdapter({ scenario: 'prompts', mode: 'plan', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    const cap = readCapture(a);
    assert.equal(frameOf(cap, 'approval').decision, 'deny');
    assert.equal(frameOf(cap, 'set_mode').mode, 'plan');
    assert.match(a._captured.response.join('\n'), /declined/);
  });

  it('refuses a folder outside the working directory', async () => {
    const a = makeAdapter({ scenario: 'directory', agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    const reply = frameOf(readCapture(a), 'directory_response');
    assert.equal(reply.granted, false);
    assert.equal(reply.writable, false);
    assert.match(a._captured.status.join(' | '), /\/etc/);
  });
});

describe('OpenWorkerAdapter — workspace briefing', () => {
  it('seeds the first turn and sends the bare message afterwards', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a, 'first message');
    let msg = frameOf(readCapture(a), 'user_message');
    assert.match(msg.text, /OpenAgents/, 'the first turn carries the workspace briefing');
    assert.match(msg.text, /run_shell/, 'the briefing must name the tool this agent actually has');
    assert.match(msg.text, /first message$/);

    await send(a, 'second message');
    const cap = readCapture(a);
    msg = cap.frames.filter((f) => f.type === 'user_message').pop();
    assert.equal(msg.text, 'second message', 'the server persists history — do not re-send the briefing');
  });

  it('re-seeds when the working directory changes, because the session is re-rooted', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a, 'first');
    a.workingDir = path.join(workDir, 'pkg');
    await send(a, 'after the move');
    const msg = readCapture(a).frames.filter((f) => f.type === 'user_message').pop();
    assert.match(msg.text, /OpenAgents/);
  });
});

describe('OpenWorkerAdapter — configuration', () => {
  it('refuses to start without a key, naming the provider variable', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_PROVIDER: 'anthropic' } });
    await send(a);
    assert.match(a._captured.error.join('\n'), /ANTHROPIC_API_KEY/);
    assert.equal(a._server, null, 'no server should be started without credentials');
  });

  it('runs a keyless provider without asking for a key', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_PROVIDER: 'ollama' } });
    await send(a);
    assert.deepEqual(a._captured.error, []);
    assert.match(a._captured.response.join('\n'), /Done/);
  });

  it('refuses a working directory that does not exist', async () => {
    const a = makeAdapter({ workingDir: path.join(tmpRoot, 'gone'), agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    assert.match(a._captured.error.join('\n'), /Working directory does not exist/);
  });

  it('keeps the state dir private to the workspace+agent pair, and honours an override', () => {
    const a = new OpenWorkerAdapter({
      workspaceId: 'ws/1', channelName: 'c', token: 't', agentName: 'bot 1',
      endpoint: 'https://e', agentEnv: {},
    });
    const own = a._stateDir();
    assert.equal(own.owned, true);
    assert.equal(path.dirname(own.dir), path.join(os.homedir(), '.openagents', 'openworker'));
    assert.equal(path.basename(own.dir), 'ws_1_bot_1', 'the slug must be filesystem-safe');

    const b = new OpenWorkerAdapter({
      workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e',
      agentEnv: { OPENWORKER_STATE_DIR: path.join(tmpRoot, 'their-desktop-app') },
    });
    const override = b._stateDir();
    assert.equal(override.owned, false, 'a directory the user pointed at is never written to');
    assert.equal(override.dir, path.join(tmpRoot, 'their-desktop-app'));
  });
});

describe('OpenWorkerAdapter — provider profile on disk', () => {
  it('writes an env reference, never the key itself', () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_PROVIDER: 'anthropic', OPENWORKER_API_KEY: 'sk-ant-verysecret' } });
    const dir = a._provisionStateDir();
    const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf-8');
    assert.ok(!raw.includes('sk-ant-verysecret'), raw);
    assert.deepEqual(JSON.parse(raw), { 'provider:anthropic': { api_key: '${OPENWORKER_API_KEY}' } });
  });

  it('merges rather than clobbering profiles OpenWorker wrote itself', () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_PROVIDER: 'openai', OPENWORKER_API_KEY: 'k' } });
    const dir = a._provisionStateDir();
    const file = path.join(dir, 'secrets.json');
    const existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
    // An MCP OAuth token the server stored between runs must survive.
    existing['mcp:github'] = { access_token: 'gho_x', type: 'oauth' };
    fs.writeFileSync(file, JSON.stringify(existing));

    a._provisionStateDir();
    const after = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.deepEqual(after['mcp:github'], { access_token: 'gho_x', type: 'oauth' });
    assert.ok(after['provider:openai']);
  });

  it('leaves a user-owned state directory untouched', () => {
    const dir = path.join(tmpRoot, 'user-owned');
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    a._stateDir = () => ({ dir, owned: false });
    a._provisionStateDir();
    assert.equal(fs.existsSync(path.join(dir, 'secrets.json')), false);
  });
});

describe('OpenWorkerAdapter — stopping', () => {
  it('interrupts the live turn and takes the server down with it', async () => {
    const a = makeAdapter({ agentEnv: { OPENWORKER_API_KEY: 'k' } });
    await send(a);
    const proc = a._server.proc;
    a.stop();
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(proc.exitCode !== null || proc.killed, 'the server process must not outlive the adapter');
  });
});
