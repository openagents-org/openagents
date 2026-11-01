'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const KiroAdapter = require('../src/adapters/kiro');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');

// ---------------------------------------------------------------------------
// A mock `kiro-cli acp`: a Node script that speaks ACP (JSON-RPC over stdio)
// and replays what kiro-cli 2.37.0 sent a recording client in each scenario,
// so the adapter's spawn → handshake → prompt → stream → reply path runs with
// no real CLI or account. Every request it receives is appended to a capture
// file with the argv and cwd it was started with.
//
// The shapes are the point: replayed history on session/load carries
// _meta.kiro.replay; a stale session id fails session/load with -32603; an
// unknown --agent is not an error but a `_kiro.dev/agent/not_found`
// notification; narration before a tool call streams exactly like the answer.
// ---------------------------------------------------------------------------
const FAKE_SCRIPT = `'use strict';
const fs = require('fs');
const { spawn } = require('child_process');
const args = process.argv.slice(2);
const scenario = process.env.FAKE_SCENARIO || 'success';
const cap = (o) => { if (process.env.FAKE_CAPTURE) fs.appendFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ pid: process.pid, args, cwd: process.cwd(), ...o }) + '\\n'); };
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const note = (method, params) => w({ jsonrpc: '2.0', method, params });
const upd = (sessionId, update) => note('session/update', { sessionId, update });
const ok = (id, result) => w({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => w({ jsonrpc: '2.0', id, error: { code, message, data } });
const say = (sid, text) => upd(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const SID = 'b07c91e7-ebd7-4551-8651-7159b0a70331';
let nextReq = 1000;
const waiting = new Map();
let promptId = null;
let tool = null;

function ask(method, params) {
  const id = String(nextReq++);
  w({ jsonrpc: '2.0', id, method, params });
  return new Promise((r) => waiting.set(id, r));
}

async function prompt(msg) {
  const sid = msg.params.sessionId;
  promptId = msg.id;
  if (scenario === 'hang') {
    upd(sid, { sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: 'Running: sleep 300', kind: 'execute',
      rawInput: { command: 'sleep 300' }, _meta: { kiro: { toolName: 'shell' } } });
    // Like the real shell tool: its own session, out of the CLI's process group.
    tool = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(process.env.FAKE_PIDS, JSON.stringify({ cli: process.pid, tool: tool.pid }));
    return; // answered only by session/cancel
  }
  if (scenario === 'permission') {
    upd(sid, { sessionUpdate: 'tool_call', toolCallId: 'toolu_w', title: 'Creating hello.txt', kind: 'edit',
      rawInput: { command: 'create', path: 'hello.txt' }, _meta: { kiro: { toolName: 'write' } } });
    const answer = await ask('session/request_permission', {
      sessionId: sid,
      toolCall: { toolCallId: 'toolu_w', title: 'Creating hello.txt', rawInput: { command: 'create' } },
      options: [
        { optionId: 'allow_once', name: 'Yes', kind: 'allow_once' },
        { optionId: 'allow_always', name: 'Always', kind: 'allow_always' },
        { optionId: 'reject_once', name: 'No', kind: 'reject_once' },
      ],
    });
    cap({ permissionAnswer: answer });
    const denied = answer.result && answer.result.outcome && answer.result.outcome.optionId === 'reject_once';
    upd(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_w', kind: 'edit', status: denied ? 'failed' : 'completed',
      _meta: { kiro: { toolName: 'write', ...(denied ? { toolCallFailureReason: 'permission_denied' } : {}) } } });
    say(sid, denied ? 'The write was denied.' : 'Created hello.txt.');
    ok(msg.id, { stopReason: 'end_turn' });
    return;
  }
  if (scenario === 'max_tokens') {
    say(sid, 'Partial answer');
    ok(msg.id, { stopReason: 'max_tokens' });
    return;
  }
  if (scenario === 'prompt_error') {
    say(sid, 'Half an answer');
    fail(msg.id, -32603, 'Internal error', 'throttling: too many requests for ' + process.env.ACME_SERVICE_KEY);
    return;
  }
  // success: narration, an MCP tool call, then the answer.
  note('_kiro.dev/metadata', { sessionId: sid, contextUsagePercentage: 9 });
  upd(sid, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Need the codeword.' } });
  say(sid, "I'll call the get_codeword");
  say(sid, ' tool.');
  upd(sid, { sessionUpdate: 'plan', entries: [{ content: 'Look up the codeword', priority: 'high', status: 'in_progress' }] });
  upd(sid, { sessionUpdate: 'tool_call', toolCallId: 'toolu_c', title: 'Running: @notes-db/get_codeword',
    rawInput: {}, _meta: { kiro: { toolName: 'get_codeword', mcpServerName: 'notes-db' } } });
  upd(sid, { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_c', kind: 'other', status: 'completed',
    rawOutput: { items: [{ Json: { content: [{ type: 'text', text: 'stored codeword: AZUL' }] } }] } });
  say(sid, 'The codeword');
  say(sid, ' is AZUL.');
  ok(msg.id, { stopReason: 'end_turn' });
}

let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && !msg.method) {
      const r = waiting.get(String(msg.id));
      if (r) { waiting.delete(String(msg.id)); r(msg); }
      continue;
    }
    cap({ method: msg.method, params: msg.params });
    if (msg.method === 'initialize') {
      ok(msg.id, { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true, sse: false } },
        authMethods: [], agentInfo: { name: 'Kiro CLI Agent', version: '2.37.0' } });
    } else if (msg.method === 'session/new') {
      if (scenario === 'signed_out') {
        fail(msg.id, -32603, 'Internal error', 'You are not logged in, please log in with kiro-cli login');
        continue;
      }
      if (scenario === 'leak') {
        const tok = msg.params.mcpServers[0].env.find((e) => e.name === 'OA_WORKSPACE_TOKEN').value;
        fail(msg.id, -32603, 'Internal error', 'upstream refused ' + tok + ' with ' + process.env.ACME_SERVICE_KEY);
        continue;
      }
      note('_kiro.dev/mcp/server_initialized', { sessionId: SID, serverName: 'openagents-workspace' });
      if (scenario === 'agent_not_found') {
        note('_kiro.dev/agent/not_found', { sessionId: SID, requestedAgent: args[args.indexOf('--agent') + 1], fallbackAgent: 'kiro_default' });
      }
      ok(msg.id, { sessionId: SID, modes: { currentModeId: 'kiro_default', availableModes: [] } });
    } else if (msg.method === 'session/load') {
      if (scenario === 'stale' && msg.params.sessionId !== SID) {
        fail(msg.id, -32603, 'Internal error', 'Failed to start session: Session not found: ' + msg.params.sessionId);
        continue;
      }
      const meta = { kiro: { replay: true } };
      upd(msg.params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old question' }, _meta: meta });
      upd(msg.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD ANSWER' }, _meta: meta });
      upd(msg.params.sessionId, { sessionUpdate: 'tool_call', toolCallId: 'old', title: 'old_tool', _meta: meta });
      ok(msg.id, { modes: { currentModeId: 'kiro_default', availableModes: [] } });
    } else if (msg.method === 'session/prompt') {
      prompt(msg);
    } else if (msg.method === 'session/cancel') {
      if (promptId !== null) ok(promptId, { stopReason: 'cancelled' });
    } else if (msg.id !== undefined) {
      fail(msg.id, -32601, 'Method not found');
    }
  }
});
`;

let tmpRoot;
let fakeBin;
let capturePath;
let workDir;

const sessionsFile = () => path.join(os.homedir(), '.openagents', 'sessions', 'ws-kiro-test_kiro-bot_kiro.json');

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-kiro-'));
  fakeBin = path.join(tmpRoot, 'fake-kiro-cli.js');
  fs.writeFileSync(fakeBin, FAKE_SCRIPT);
  capturePath = path.join(tmpRoot, 'capture.jsonl');
  workDir = path.join(tmpRoot, 'project');
  fs.mkdirSync(workDir);
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(sessionsFile(), { force: true }); } catch {}
});

beforeEach(() => {
  try { fs.rmSync(capturePath, { force: true }); } catch {}
  try { fs.rmSync(sessionsFile(), { force: true }); } catch {}
});

function makeAdapter(extra = {}) {
  const a = new KiroAdapter({
    workspaceId: 'ws-kiro-test',
    channelName: 'thread',
    token: extra.token || 'ws-token-abcdef123456',
    agentName: 'kiro-bot',
    agentType: 'kiro',
    endpoint: 'https://example.invalid',
    agentEnv: {
      PATH: process.env.PATH,
      ...(extra.agentEnv || {}),
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      FAKE_PIDS: path.join(tmpRoot, 'pids.json'),
    },
    workingDir: extra.workingDir || workDir,
  });
  a._captured = { thinking: [], status: [], response: [], error: [], todos: [], logs: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a.sendTodos = async (_c, t) => { a._captured.todos.push(t); };
  a._announceUserStop = async () => {};
  a.cleanupTodos = async () => {};
  a._log = (m) => { a._captured.logs.push(String(m)); };
  a.getBrowserEnabled = async () => false;
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => (extra.history || []),
    sendMessage: async () => ({}),
    getTodos: async () => ({ todos: [] }),
  };
  a._findKiroBinary = () => fakeBin;
  a._readVersionRaw = () => `kiro-cli ${extra.version || '2.37.0'}\n`;
  // Run the mock through Node so the suite needs no shebang support (Windows).
  a._spawnKiro = (_bin, args, opts) => spawn(process.execPath, [fakeBin, ...args], {
    ...opts, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
  });
  if (extra.mode) a._mode = extra.mode;
  return a;
}

const frames = () => (fs.existsSync(capturePath)
  ? fs.readFileSync(capturePath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);
const requests = (method) => frames().filter((f) => f.method === method);
const lastRequest = (method, a) => {
  const r = requests(method);
  if (!r.length) {
    throw new Error(`the mock CLI never got ${method}.\n  errors: ${JSON.stringify(a && a._captured.error)}\n  log:\n    ${a ? a._captured.logs.join('\n    ') : ''}`);
  }
  return r[r.length - 1];
};
const send = (a, content = 'what is the codeword?') =>
  a._handleMessage({ content, sessionId: 'thread', senderType: 'human', senderName: 'user' });
const promptText = (req) => req.params.prompt.map((b) => b.text).join('\n');

describe('KiroAdapter — registration', () => {
  it('is registered as kiro', () => {
    assert.equal(ADAPTER_MAP.kiro, KiroAdapter);
    const a = createAdapter('kiro', { workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {} });
    assert.equal(a.constructor.name, 'KiroAdapter');
  });

  it('reports a missing CLI before join', () => {
    const a = makeAdapter();
    a._findKiroBinary = () => null;
    const r = a.preflight();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'runtime_missing');
    assert.match(r.message, /cli\.kiro\.dev/);
  });
});

describe('KiroAdapter — one turn over ACP', () => {
  it('starts `kiro-cli acp` in the working directory with the agent profile, without blanket trust', async () => {
    const a = makeAdapter({ agentEnv: { KIRO_AGENT: 'researcher' } });
    await send(a);
    const init = lastRequest('initialize', a);
    assert.deepEqual(init.args, ['acp', '--agent', 'researcher']);
    assert.equal(fs.realpathSync(init.cwd), fs.realpathSync(workDir));
    assert.equal(init.params.protocolVersion, 1);
    assert.deepEqual(init.params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  });

  it('passes the workspace model ahead of the saved one', async () => {
    const a = makeAdapter({ agentEnv: { KIRO_MODEL: 'claude-haiku-4.5' } });
    a.workspaceModel = 'claude-sonnet-4.6';
    await send(a);
    const { args } = lastRequest('initialize', a);
    assert.equal(args[args.indexOf('--model') + 1], 'claude-sonnet-4.6');
    assert.equal(a.modelLabel(), 'claude-sonnet-4.6');
  });

  it('hands the workspace MCP server over in session/new, token in its env only', async () => {
    const a = makeAdapter();
    await send(a);
    const req = lastRequest('session/new', a);
    const ws = req.params.mcpServers.find((s) => s.name === 'openagents-workspace');
    assert.ok(ws, 'workspace server is passed');
    assert.ok(ws.args.includes('mcp-server'));
    assert.equal(ws.args[ws.args.indexOf('--channel-name') + 1], 'thread');
    assert.deepEqual(ws.env, [{ name: 'OA_WORKSPACE_TOKEN', value: 'ws-token-abcdef123456' }]);
    assert.ok(!lastRequest('initialize').args.some((x) => x.includes('ws-token-abcdef123456')));
  });

  it('streams the turn: narration and reasoning as thinking, tools as status, the plan as todos, the answer as the reply', async () => {
    const a = makeAdapter();
    await send(a);
    assert.deepEqual(a._captured.response, ['The codeword is AZUL.']);
    assert.ok(a._captured.thinking.includes("I'll call the get_codeword tool."));
    assert.ok(a._captured.thinking.includes('Need the codeword.'));
    assert.ok(a._captured.status.includes('notes-db › get_codeword'));
    assert.deepEqual(a._captured.todos, [[{ content: 'Look up the codeword', status: 'in_progress' }]]);
    assert.deepEqual(a._captured.error, []);
  });

  it('opens a session with the workspace briefing first and the message last', async () => {
    const a = makeAdapter({ history: [{ content: 'earlier note', senderType: 'human', senderName: 'ana' }] });
    await send(a, 'the actual question');
    const blocks = lastRequest('session/prompt', a).params.prompt;
    assert.match(blocks[0].text, /^<openagents_workspace_briefing>/);
    assert.match(blocks[0].text, /kiro-bot/);
    assert.match(blocks[1].text, /\[ana\] earlier note/);
    assert.equal(blocks[blocks.length - 1].text, 'the actual question');
  });

  it('ends the CLI after the turn', async () => {
    const a = makeAdapter();
    await send(a);
    assert.deepEqual(Object.keys(a._channelProcesses), []);
    const pid = lastRequest('initialize').pid;
    assert.throws(() => process.kill(pid, 0));
  });
});

describe('KiroAdapter — session continuity', () => {
  it('resumes the channel with session/load, without re-sending the briefing or a recap', async () => {
    const a = makeAdapter({ agentEnv: { KIRO_AGENT: 'researcher' }, history: [{ content: 'x', senderType: 'human' }] });
    await send(a, 'first');
    const saved = JSON.parse(fs.readFileSync(sessionsFile(), 'utf-8')).thread;
    assert.equal(saved.sessionId, 'b07c91e7-ebd7-4551-8651-7159b0a70331');
    assert.equal(saved.agent, 'researcher');

    await send(a, 'second');
    const load = lastRequest('session/load', a);
    assert.equal(load.params.sessionId, saved.sessionId);
    assert.ok(load.params.mcpServers.some((s) => s.name === 'openagents-workspace'));
    assert.equal(requests('session/new').length, 1);
    const blocks = lastRequest('session/prompt').params.prompt;
    assert.deepEqual(blocks.map((b) => b.text), ['second']);
  });

  it('does not post history replayed by session/load', async () => {
    const a = makeAdapter();
    await send(a, 'first');
    a._captured.thinking.length = 0;
    a._captured.status.length = 0;
    await send(a, 'second');
    assert.ok(!a._captured.thinking.some((t) => t.includes('OLD ANSWER')));
    assert.ok(!a._captured.status.some((t) => t.includes('old_tool')));
    assert.ok(!a._captured.response.some((t) => t.includes('OLD ANSWER')));
  });

  it('re-sends the briefing when it changes (plan mode)', async () => {
    const a = makeAdapter();
    await send(a, 'first');
    a._mode = 'plan';
    await send(a, 'second');
    const blocks = lastRequest('session/prompt').params.prompt;
    assert.equal(blocks.length, 2);
    assert.match(blocks[0].text, /PLAN mode/);
  });

  it('starts a fresh session when the agent profile changed', async () => {
    const a = makeAdapter({ agentEnv: { KIRO_AGENT: 'researcher' } });
    await send(a, 'first');
    a.agentEnv = { ...a.agentEnv, KIRO_AGENT: 'writer' };
    await send(a, 'second');
    assert.equal(requests('session/load').length, 0);
    assert.equal(requests('session/new').length, 2);
  });

  it('replaces a session the CLI no longer has, once, and still answers', async () => {
    fs.mkdirSync(path.dirname(sessionsFile()), { recursive: true });
    fs.writeFileSync(sessionsFile(), JSON.stringify({
      thread: { sessionId: 'gone-session', workingDir: workDir, agent: null, briefing: 'x' },
    }));
    const a = makeAdapter({ scenario: 'stale' });
    await send(a);
    assert.equal(requests('session/load').length, 1);
    assert.equal(requests('session/new').length, 1);
    assert.ok(a._captured.status.some((s) => /starting a new one/.test(s)));
    assert.deepEqual(a._captured.response, ['The codeword is AZUL.']);
    assert.equal(JSON.parse(fs.readFileSync(sessionsFile(), 'utf-8')).thread.sessionId, 'b07c91e7-ebd7-4551-8651-7159b0a70331');
  });
});

describe('KiroAdapter — refusals and failures', () => {
  it('refuses to run as the default agent when the profile is missing', async () => {
    const a = makeAdapter({ scenario: 'agent_not_found', agentEnv: { KIRO_AGENT: 'researcher' } });
    await send(a);
    assert.equal(requests('session/prompt').length, 0, 'no prompt is sent');
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /"researcher" was not found/);
    assert.deepEqual(a._captured.response, []);
  });

  it('tells a signed-out user how to sign in', async () => {
    const a = makeAdapter({ scenario: 'signed_out' });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /kiro-cli login/);
    assert.match(a._captured.error[0], /KIRO_API_KEY/);
  });

  it('never quotes the workspace token or the agent\'s keys back', async () => {
    const a = makeAdapter({ scenario: 'leak', agentEnv: { ACME_SERVICE_KEY: 'acme-live-0123456789abcdef' } });
    await send(a);
    const all = [...a._captured.error, ...a._captured.response].join('\n');
    assert.ok(all.length > 0);
    assert.ok(!all.includes('ws-token-abcdef123456'), all);
    assert.ok(!all.includes('acme-live-0123456789abcdef'), all);
  });

  it('delivers a partial answer with the reason when the turn fails after answering', async () => {
    const a = makeAdapter({ scenario: 'prompt_error', agentEnv: { ACME_SERVICE_KEY: 'acme-live-0123456789abcdef' } });
    await send(a);
    assert.equal(a._captured.response.length, 1);
    assert.match(a._captured.response[0], /^Half an answer/);
    assert.match(a._captured.response[0], /rate|limit/i);
    assert.ok(!a._captured.response[0].includes('acme-live-0123456789abcdef'));
  });

  it('says so when the turn hit the output limit', async () => {
    const a = makeAdapter({ scenario: 'max_tokens' });
    await send(a);
    assert.match(a._captured.response[0], /^Partial answer/);
    assert.match(a._captured.response[0], /output token limit/);
  });

  it('refuses a CLI older than the verified version', async () => {
    const a = makeAdapter({ version: '2.10.0' });
    await send(a);
    assert.equal(frames().length, 0, 'nothing was started');
    assert.match(a._captured.error[0], /below the minimum supported version/);
  });

  it('reports a missing CLI in the channel', async () => {
    const a = makeAdapter();
    a._findKiroBinary = () => null;
    await send(a);
    assert.match(a._captured.error[0], /Kiro CLI not found/);
  });

  it('explains a CLI that could not be started, rather than the handshake that failed after it', async () => {
    const a = makeAdapter();
    a._spawnKiro = (_bin, args, opts) => spawn(path.join(tmpRoot, 'no-such-kiro-cli'), args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /Kiro CLI could not be started/);
    assert.match(a._captured.error[0], /cli\.kiro\.dev/);
  });

  it('reports a working directory that does not exist', async () => {
    const a = makeAdapter({ workingDir: path.join(tmpRoot, 'missing') });
    await send(a);
    assert.match(a._captured.error[0], /Working directory does not exist/);
    assert.equal(frames().length, 0);
  });
});

describe('KiroAdapter — approvals', () => {
  it('allows a write once in execute mode', async () => {
    const a = makeAdapter({ scenario: 'permission' });
    await send(a);
    const answered = frames().find((f) => f.permissionAnswer);
    assert.equal(answered.permissionAnswer.result.outcome.optionId, 'allow_once');
    assert.deepEqual(a._captured.response, ['Created hello.txt.']);
  });

  it('refuses a write in plan mode', async () => {
    const a = makeAdapter({ scenario: 'permission', mode: 'plan' });
    await send(a);
    const answered = frames().find((f) => f.permissionAnswer);
    assert.equal(answered.permissionAnswer.result.outcome.optionId, 'reject_once');
    assert.deepEqual(a._captured.response, ['The write was denied.']);
  });
});

describe('KiroAdapter — stop', { skip: process.platform === 'win32' ? 'process-tree walk is Unix-only here' : false }, () => {
  it('cancels the turn through ACP, ends the CLI and its detached tools, and keeps the session', async () => {
    const pidsFile = path.join(tmpRoot, 'pids.json');
    try { fs.rmSync(pidsFile, { force: true }); } catch {}
    const a = makeAdapter({ scenario: 'hang' });
    const turn = send(a);
    for (let i = 0; i < 200 && !fs.existsSync(pidsFile); i++) await new Promise((r) => setTimeout(r, 25));
    const pids = JSON.parse(fs.readFileSync(pidsFile, 'utf-8'));

    await a._onControlAction('stop', { channel: 'thread' });
    await turn;

    assert.equal(requests('session/cancel').length, 1, 'the turn was cancelled through ACP');
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    assert.equal(alive(pids.cli), false, 'the CLI is gone');
    assert.equal(alive(pids.tool), false, 'the detached shell command is gone');
    assert.deepEqual(a._captured.response, []);
    assert.deepEqual(a._captured.error, []);
    assert.equal(JSON.parse(fs.readFileSync(sessionsFile(), 'utf-8')).thread.sessionId, 'b07c91e7-ebd7-4551-8651-7159b0a70331');
  });
});
