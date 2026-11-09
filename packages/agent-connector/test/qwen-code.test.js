'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const QwenCodeAdapter = require('../src/adapters/qwen-code');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');

// ---------------------------------------------------------------------------
// A mock Qwen Code CLI: a Node script that records how it was invoked and
// replays what the real CLI (0.25.1) printed for each scenario, so the
// adapter's spawn → pipe-prompt → parse → reply path runs with no real CLI,
// account, or network.
//
// The failing scenarios matter most: a model error is streamed as assistant
// text AND reported in an is_error result frame with exit 1; a missing key
// fails before the init frame; a resume of an unknown session writes only to
// stderr; a stop exits 130 with no result frame.
// ---------------------------------------------------------------------------
let tmpRoot;
let fakeBin;
let capturePath;

const FAKE_SCRIPT = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write((process.env.FAKE_VERSION || '0.25.1') + '\\n');
  process.exit(0);
}
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const resumeAt = args.indexOf('--resume');
const sid = resumeAt >= 0 ? args[resumeAt + 1] : (process.env.FAKE_SESSION_ID || 'sess-abc');
const init = () => {
  w({ type: 'system', subtype: 'init', session_id: sid, model: 'qwen3.8-flash', permission_mode: 'yolo',
      mcp_servers: [{ name: 'openagents-workspace', status: 'connected' }], tools: [], qwen_code_version: '0.25.1' });
  w({ type: 'stream_event', session_id: sid, event: { type: 'goal_state', goal_state: { v: 2, goal: null, activity: 'idle' } } });
};
const say = (block) => w({ type: 'assistant', session_id: sid, message: { role: 'assistant', content: [block] } });
const result = (o) => w({ type: 'result', session_id: sid, num_turns: 1, duration_ms: 12, ...o });

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CAPTURE) {
    const pick = (k) => process.env[k] === undefined ? null : process.env[k];
    const settingsPath = process.env.QWEN_CODE_SYSTEM_SETTINGS_PATH;
    const settings = settingsPath ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : null;
    fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ args, stdin, cwd: process.cwd(), settings, env: {
      OPENAI_API_KEY: pick('OPENAI_API_KEY'),
      OPENAI_BASE_URL: pick('OPENAI_BASE_URL'),
      OPENAI_MODEL: pick('OPENAI_MODEL'),
      QWEN_CODE_SYSTEM_DEFAULTS_PATH: pick('QWEN_CODE_SYSTEM_DEFAULTS_PATH'),
      QWEN_CODE_SYSTEM_SETTINGS_PATH: pick('QWEN_CODE_SYSTEM_SETTINGS_PATH'),
      QWEN_CODE_SUPPRESS_YOLO_WARNING: pick('QWEN_CODE_SUPPRESS_YOLO_WARNING'),
    } }));
  }
  const scenario = process.env.FAKE_SCENARIO || 'success';

  if (scenario === 'success') {
    init();
    say({ type: 'thinking', thinking: 'The user wants me to read a file.', signature: '' });
    say({ type: 'text', text: 'Reading the file.\\n\\n' });
    say({ type: 'tool_use', id: 'call_1', name: 'run_shell_command', input: { command: 'cat src/app.js', description: 'Show it' } });
    w({ type: 'user', session_id: sid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', is_error: false, content: 'x' }] } });
    say({ type: 'text', text: 'Done - read src/app.js.' });
    result({ subtype: 'success', is_error: false, result: 'Done - read src/app.js.' });
    process.exit(0);
  }
  if (scenario === 'mcp') {
    init();
    say({ type: 'tool_use', id: 'c1', name: 'tool_search', input: { query: 'select:mcp__openagents-workspace__workspace_get_history' } });
    say({ type: 'tool_use', id: 'c2', name: 'tool_call', input: { name: 'mcp__openagents-workspace__workspace_get_history', arguments: { channel: 'thread' } } });
    say({ type: 'text', text: 'Nothing new in the channel.' });
    result({ subtype: 'success', is_error: false, result: 'Nothing new in the channel.' });
    process.exit(0);
  }
  if (scenario === 'not_configured') {
    // Verified: no init frame, an is_error result, exit 1.
    result({ subtype: 'error_during_execution', is_error: true, num_turns: 0,
      error: { message: 'No auth type is selected. Please configure an auth type (e.g. via settings or \`--auth-type\`) before running in non-interactive mode.' } });
    process.exit(1);
  }
  if (scenario === 'auth') {
    init();
    const msg = '[API Error: 401 Incorrect API key provided. For details, see: https://help.aliyun.com/zh/model-studio/error-code#apikey-error]';
    say({ type: 'text', text: msg });
    result({ subtype: 'error_during_execution', is_error: true, error: { message: msg } });
    process.exit(1);
  }
  if (scenario === 'echo_key') {
    // A provider that quotes the rejected key back, in a format no shape rule knows.
    init();
    const msg = '[API Error: 401 Incorrect API key provided: ' + process.env.OPENAI_API_KEY + ']';
    say({ type: 'text', text: msg });
    result({ subtype: 'error_during_execution', is_error: true, error: { message: msg } });
    process.exit(1);
  }
  if (scenario === 'echo_key_stderr') {
    process.stderr.write('Error: DashScope rejected credential ' + process.env.DASHSCOPE_API_KEY + '\\n');
    process.exit(1);
  }
  if (scenario === 'legacy_auth') {
    init();
    const msg = '[API Error: 401 Incorrect API key provided.]';
    say({ type: 'text', text: msg });
    result({ subtype: 'success', is_error: false, result: msg });
    process.exit(0);
  }
  if (scenario === 'split_unicode') {
    init();
    const bytes = Buffer.from(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
      session_id: sid, result: '你好，世界 🌍' }) + '\\n');
    const split = bytes.indexOf(Buffer.from('好')) + 1;
    process.stdout.write(bytes.subarray(0, split));
    setTimeout(() => { process.stdout.write(bytes.subarray(split)); process.exit(0); }, 50);
    return;
  }
  if (scenario === 'stale_resume') {
    if (resumeAt >= 0) {
      process.stderr.write('No saved session found with ID ' + sid + '. Run \`qwen --resume\` without an ID to choose from existing sessions.\\n');
      process.exit(1);
    }
    init();
    result({ subtype: 'success', is_error: false, result: 'Fresh answer.' });
    process.exit(0);
  }
  if (scenario === 'empty_result') {
    init();
    say({ type: 'text', text: 'The answer is 42.' });
    result({ subtype: 'success', is_error: false, result: '' });
    process.exit(0);
  }
  if (scenario === 'unknown_frames') {
    init();
    w({ type: 'brand_new_frame', payload: { a: 1 } });
    result({ subtype: 'success', is_error: false, result: 'Survived.' });
    process.exit(0);
  }
  if (scenario === 'hang') {
    // A long tool run. The real CLI answers SIGINT/SIGTERM by cancelling the
    // turn and exiting 130 with "Operation cancelled." on stderr.
    init();
    say({ type: 'tool_use', id: 'c1', name: 'run_shell_command', input: { command: 'sleep 90' } });
    const bye = () => { process.stderr.write('Operation cancelled.\\n'); process.exit(130); };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
    setInterval(() => {}, 1000);
    return;
  }
  process.exit(0);
});
`;

const SESSIONS_FILE = path.join(
  os.homedir(), '.openagents', 'sessions', 'ws-qwen-test_qwen-bot_qwen-code.json',
);

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-qwen-'));
  fakeBin = path.join(tmpRoot, 'fake-qwen.js');
  fs.writeFileSync(fakeBin, FAKE_SCRIPT, { mode: 0o755 });
  capturePath = path.join(tmpRoot, 'capture.json');
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(SESSIONS_FILE, { force: true }); } catch {}
});

beforeEach(() => {
  try { fs.rmSync(capturePath, { force: true }); } catch {}
  try { fs.rmSync(SESSIONS_FILE, { force: true }); } catch {}
});

function makeAdapter(extra = {}) {
  const a = new QwenCodeAdapter({
    workspaceId: 'ws-qwen-test',
    channelName: 'thread',
    token: 'token',
    agentName: 'qwen-bot',
    agentType: 'qwen-code',
    endpoint: 'https://example.invalid',
    agentEnv: {
      PATH: process.env.PATH,
      ...(extra.agentEnv || {}),
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      ...(extra.fakeVersion ? { FAKE_VERSION: extra.fakeVersion } : {}),
    },
    workingDir: extra.workingDir || tmpRoot,
  });
  a._captured = { thinking: [], status: [], response: [], error: [], logs: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a._log = (m) => { a._captured.logs.push(String(m)); };
  a.getBrowserEnabled = async () => false;
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => [],
    sendMessage: async () => ({}),
    getTodos: async () => ({ todos: [] }),
  };
  a._findQwenBinary = () => fakeBin;
  // Run the mock under THIS interpreter. Without it the adapter would look for
  // a Node >= 22 of its own, which a CI runner on an older Node lacks.
  a._findNodeBin = () => process.execPath;
  // Keep the real settings layer out of the developer's ~/.openagents.
  a._writeSystemDefaults = () => path.join(tmpRoot, 'system-defaults.json');
  if (extra.mode) a._mode = extra.mode;
  return a;
}

const readCapture = (a) => {
  if (!fs.existsSync(capturePath)) {
    const d = a && a._captured;
    throw new Error(
      'the mock CLI never wrote its capture file — it did not run to completion.\n' +
      `  errors:    ${JSON.stringify(d && d.error)}\n` +
      `  responses: ${JSON.stringify(d && d.response)}\n` +
      `  adapter log:\n    ${((d && d.logs) || []).join('\n    ')}`,
    );
  }
  return JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
};

const send = (a, content = 'do the thing') =>
  a._handleMessage({ content, sessionId: 'thread', senderType: 'human', senderName: 'user' });

const argAfter = (cap, flag) => cap.args[cap.args.indexOf(flag) + 1];

describe('QwenCodeAdapter — registration', () => {
  it('is reachable through the adapter registry', () => {
    assert.ok(ADAPTER_MAP['qwen-code']);
    const a = createAdapter('qwen-code', {
      workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {},
    });
    assert.equal(a.constructor.name, 'QwenCodeAdapter');
  });

  it('is in the bundled registry with the env names the adapter reads', () => {
    const entry = require('../registry.json').find((e) => e.name === 'qwen-code');
    assert.ok(entry, 'registry.json must carry qwen-code');
    assert.equal(entry.install.binary, 'qwen');
    const rules = Object.fromEntries(entry.resolve_env.rules.map((r) => [r.from, r.to]));
    assert.deepEqual(rules, { LLM_API_KEY: 'OPENAI_API_KEY', LLM_BASE_URL: 'OPENAI_BASE_URL', LLM_MODEL: 'OPENAI_MODEL' });
  });

  it('asks for the model and base URL, with the base URL prefilled', () => {
    // A blank model ran the CLI's most expensive default, and a blank field
    // made the launcher's connection test probe something the agent never uses.
    const fields = Object.fromEntries(
      require('../registry.json').find((e) => e.name === 'qwen-code').env_config.map((f) => [f.name, f]),
    );
    assert.equal(fields.LLM_MODEL.required, true);
    assert.equal(fields.LLM_BASE_URL.required, true);
    assert.equal(fields.LLM_BASE_URL.default, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  });
});

describe('QwenCodeAdapter — headless invocation', () => {
  it('pipes the prompt over stdin and keeps it out of argv', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'sk-test-key-123456' } });
    await send(a, 'refactor the auth module');
    const cap = readCapture(a);
    assert.ok(cap.stdin.includes('refactor the auth module'));
    assert.equal(argAfter(cap, '--output-format'), 'stream-json');
    assert.ok(!cap.args.some((x) => x.includes('refactor the auth module')));
    assert.equal(cap.cwd, fs.realpathSync(tmpRoot));
  });

  it("hands the agent's key over in the environment, never in argv", async () => {
    const a = makeAdapter({ agentEnv: {
      LLM_API_KEY: 'sk-test-key-123456', LLM_BASE_URL: 'https://coding.dashscope.aliyuncs.com/v1', LLM_MODEL: 'qwen3.6-plus',
    } });
    await send(a);
    const cap = readCapture(a);
    assert.equal(cap.env.OPENAI_API_KEY, 'sk-test-key-123456');
    assert.equal(cap.env.OPENAI_BASE_URL, 'https://coding.dashscope.aliyuncs.com/v1');
    assert.equal(argAfter(cap, '--auth-type'), 'openai');
    assert.equal(argAfter(cap, '--model'), 'qwen3.6-plus');
    assert.ok(!cap.args.some((x) => x.includes('sk-test-key-123456')));
  });

  it('points a blank base URL at Model Studio', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'sk-test-key-123456', OPENAI_BASE_URL: 'https://api.openai.com/v1' } });
    await send(a);
    assert.equal(readCapture(a).env.OPENAI_BASE_URL, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it("leaves a keyless agent to the CLI's own settings", async () => {
    const a = makeAdapter();
    await send(a);
    const cap = readCapture(a);
    assert.ok(!cap.args.includes('--auth-type'));
    assert.equal(cap.env.OPENAI_API_KEY, null);
  });

  it('loads the settings layer that turns auto-memory off', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'k-123456789' } });
    await send(a);
    const cap = readCapture(a);
    assert.equal(cap.env.QWEN_CODE_SYSTEM_DEFAULTS_PATH, path.join(tmpRoot, 'system-defaults.json'));
    assert.equal(cap.env.QWEN_CODE_SUPPRESS_YOLO_WARNING, '1');
  });

  it('sends the workspace briefing and the MCP config that carries the tools', async () => {
    const a = makeAdapter();
    await send(a);
    const cap = readCapture(a);
    assert.ok(argAfter(cap, '--append-system-prompt').includes('qwen-bot'), 'the briefing must name the agent');
    const mcpPath = argAfter(cap, '--mcp-config');
    assert.ok(mcpPath.includes(path.join('.openagents', 'mcp-configs')));
    assert.equal(fs.existsSync(mcpPath), false, 'the token-bearing config must not outlive the run');
  });

  it('runs read-only in plan mode', async () => {
    const a = makeAdapter({ mode: 'plan' });
    await send(a);
    assert.equal(argAfter(readCapture(a), '--approval-mode'), 'plan');
  });

  it('passes the workspace-selected model ahead of the configured one', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'k-123456789', LLM_MODEL: 'configured-model' } });
    a.workspaceModel = 'picked-model';
    await send(a);
    const cap = readCapture(a);
    assert.equal(argAfter(cap, '--model'), 'picked-model');
    assert.equal(cap.env.OPENAI_MODEL, 'picked-model');
    assert.equal(a.modelLabel(), 'picked-model');
  });
});

describe('QwenCodeAdapter — replies', () => {
  it('answers from the result frame and streams progress along the way', async () => {
    const a = makeAdapter();
    await send(a);
    assert.deepEqual(a._captured.response, ['Done - read src/app.js.']);
    assert.deepEqual(a._captured.thinking, ['Reading the file.', 'Done - read src/app.js.']);
    assert.ok(a._captured.status.some((s) => s === 'run_shell_command › cat src/app.js'));
    assert.deepEqual(a._captured.error, []);
  });

  it('announces a workspace MCP call by the tool it ran', async () => {
    const a = makeAdapter({ scenario: 'mcp' });
    await send(a);
    assert.ok(a._captured.status.some((s) => s.startsWith('workspace_get_history')));
    assert.ok(!a._captured.status.some((s) => s.startsWith('tool_search')));
  });

  it('tells a keyless agent to set a key', async () => {
    const a = makeAdapter({ scenario: 'not_configured' });
    await send(a);
    assert.deepEqual(a._captured.response, []);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /no model credentials/);
  });

  it('reports a rejected key as an error, not as the answer', async () => {
    // The CLI streams "[API Error: 401 …]" as assistant text before the
    // result frame; posting it as a reply would read as the agent's answer.
    const a = makeAdapter({ scenario: 'auth' });
    await send(a);
    assert.deepEqual(a._captured.response, []);
    assert.deepEqual(a._captured.thinking, []);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /rejected the API key/);
    assert.match(a._captured.error[0], /Incorrect API key provided/);
  });

  it("masks the agent's own key by value when the CLI quotes it back", async () => {
    const key = 'mykey-ABC123xyz789';
    const a = makeAdapter({ scenario: 'echo_key', agentEnv: { OPENAI_API_KEY: key } });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /rejected the API key/);
    assert.ok(!a._captured.error[0].includes(key), a._captured.error[0]);
    assert.ok(!a._captured.logs.some((l) => l.includes(key)));
  });

  it('masks a key from the agent env in a startup failure notice', async () => {
    const key = 'mykey-DEF456uvw012';
    const a = makeAdapter({ scenario: 'echo_key_stderr', agentEnv: { DASHSCOPE_API_KEY: key } });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /DashScope rejected credential/);
    assert.ok(!a._captured.error[0].includes(key), a._captured.error[0]);
    assert.ok(!a._captured.logs.some((l) => l.includes(key)));
  });

  it('reports a legacy CLI auth error even when its result and exit code say success', async () => {
    const a = makeAdapter({ scenario: 'legacy_auth' });
    await send(a);
    assert.deepEqual(a._captured.response, []);
    assert.deepEqual(a._captured.thinking, []);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /rejected the API key/);
  });

  it('preserves UTF-8 characters split across stdout chunks', async () => {
    const a = makeAdapter({ scenario: 'split_unicode' });
    await send(a);
    assert.deepEqual(a._captured.response, ['你好，世界 🌍']);
  });

  it('falls back to the streamed text when a clean run summarizes nothing', async () => {
    const a = makeAdapter({ scenario: 'empty_result' });
    await send(a);
    assert.deepEqual(a._captured.response, ['The answer is 42.']);
  });

  it('keeps answering when the CLI emits a frame type it has never seen', async () => {
    const a = makeAdapter({ scenario: 'unknown_frames' });
    await send(a);
    assert.deepEqual(a._captured.response, ['Survived.']);
    assert.ok(a._captured.logs.some((l) => l.includes('brand_new_frame')));
  });
});

describe('QwenCodeAdapter — pinned channel context', () => {
  it('refreshes the glossary in the system prompt on a resumed turn', async () => {
    const a = makeAdapter();
    const entries = [
      { id: 'glossary-id', title: 'Glossary for channel thread', content: 'Widget means a local task.' },
    ];
    a.client.listKnowledge = async () => ({ entries });
    a.client.getKnowledge = async (_ws, _token, id) => entries.find((e) => e.id === id);

    await a._channelWorker('thread', { content: 'first turn', sessionId: 'thread' });
    const first = argAfter(readCapture(a), '--append-system-prompt');
    assert.ok(first.includes('Widget means a local task.'));
    assert.ok(first.includes('glossary-id'));

    entries[0].content = 'Widget means a remote job.';
    await a._channelWorker('thread', { content: 'next turn', sessionId: 'thread' });
    const cap = readCapture(a);
    const next = argAfter(cap, '--append-system-prompt');
    assert.equal(argAfter(cap, '--resume'), 'sess-abc');
    assert.ok(next.includes('Widget means a remote job.'));
    assert.ok(!next.includes('Widget means a local task.'));
  });
});

describe('QwenCodeAdapter — session continuity', () => {
  it('resumes the channel session on the next turn', async () => {
    const a = makeAdapter();
    await send(a);
    await send(a, 'and now the tests');
    const cap = readCapture(a);
    assert.equal(argAfter(cap, '--resume'), 'sess-abc');
    // Resuming means the CLI already holds the history; only the bare turn is
    // sent, with no recap prepended.
    assert.equal(cap.stdin.trim(), 'and now the tests');
  });

  it('remembers the session id from the init frame even when the turn failed', async () => {
    const a = makeAdapter({ scenario: 'auth' });
    await send(a);
    assert.equal(a._channelSessions.thread.sessionId, 'sess-abc');
  });

  it('drops a stale session and retries once from scratch', async () => {
    const a = makeAdapter({ scenario: 'stale_resume' });
    a._channelSessions.thread = { sessionId: 'gone-session', workingDir: tmpRoot };
    await send(a);
    assert.deepEqual(a._captured.response, ['Fresh answer.']);
    assert.deepEqual(a._captured.error, []);
    assert.equal(a._channelSessions.thread.sessionId, 'sess-abc');
  });

  it('never resumes a session recorded against a different working directory', () => {
    // Qwen Code files a transcript under the directory it ran in, so a resume
    // from elsewhere fails — start fresh instead.
    const a = makeAdapter();
    a._channelSessions.thread = { sessionId: 's-1', workingDir: '/somewhere/else' };
    assert.equal(a._resumableSession('thread', tmpRoot), null);
    assert.equal(a._resumableSession('thread', '/somewhere/else'), 's-1');
  });
});

describe('QwenCodeAdapter — stop', () => {
  it('stops a running turn and keeps its session resumable', async () => {
    const a = makeAdapter({ scenario: 'hang' });
    const turn = send(a);
    for (let i = 0; i < 200 && !(a._channelProcesses.thread && a._captured.status.length > 1); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(a._channelProcesses.thread, 'the run never started');
    const started = Date.now();
    await a._onControlAction('stop', { channel: 'thread' });
    await turn;
    assert.ok(Date.now() - started < 3000, 'SIGINT should end the run without escalating');
    assert.equal(a._channelProcesses.thread, undefined);
    assert.deepEqual(a._captured.response, []);
    assert.deepEqual(a._captured.error, [], 'a user stop is not an error');
    assert.equal(a._channelSessions.thread.sessionId, 'sess-abc');
  });

  it('kills the whole process tree on Windows', async () => {
    // The Windows entry script relaunches the CLI as a child; terminating only
    // the parent would leave that child running the turn.
    const { EventEmitter } = require('node:events');
    const a = makeAdapter();
    a._isWindows = true;
    const proc = new EventEmitter();
    proc.pid = 4242;
    proc.exitCode = null;
    proc.kill = () => { throw new Error('kill() alone would orphan the CLI'); };
    const killed = [];
    a._killTree = (pid) => { killed.push(pid); proc.exitCode = 1; proc.emit('exit', 1, null); };
    assert.equal(await a._stopProcess(proc), true);
    assert.deepEqual(killed, [4242]);
  });
});

describe('QwenCodeAdapter — binary resolution', () => {
  function makeStandalone(root, { windows = false } = {}) {
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ name: '@qwen-code/qwen-code', version: '0.25.1' }));
    fs.writeFileSync(path.join(root, 'lib', 'cli-entry.js'), '');
    const node = windows ? path.join(root, 'node', 'node.exe') : path.join(root, 'node', 'bin', 'node');
    fs.mkdirSync(path.dirname(node), { recursive: true });
    fs.writeFileSync(node, '');
    return node;
  }

  it("runs a standalone install on its own bundled Node, through the installer's wrapper", { skip: process.platform === 'win32' && 'the POSIX standalone layout (sh wrapper → node/bin/node); Windows is covered by the qwen.cmd case below' }, () => {
    const root = path.join(tmpRoot, 'local', 'lib', 'qwen-code');
    const node = makeStandalone(root);
    const wrapper = path.join(tmpRoot, 'local', 'bin', 'qwen');
    fs.mkdirSync(path.dirname(wrapper), { recursive: true });
    fs.writeFileSync(wrapper, `#!/usr/bin/env sh\nexec '${path.join(root, 'bin', 'qwen')}' "$@"\n`);
    const plan = makeAdapter()._spawnPlan(wrapper, ['--version']);
    assert.equal(plan.command, node);
    assert.deepEqual(plan.args, [path.join(root, 'lib', 'cli-entry.js'), '--version']);
    assert.equal(plan.env.QWEN_CODE_LAUNCHER_PATH, path.join(root, 'bin', 'qwen'));
  });

  it('recognizes the Windows standalone layout from its outer qwen.cmd', () => {
    const base = path.join(tmpRoot, 'LocalAppData', 'qwen-code');
    const root = path.join(base, 'qwen-code');
    const a = makeAdapter();
    a._isWindows = true;
    const node = makeStandalone(root, { windows: true });
    const outer = path.join(base, 'bin', 'qwen.cmd');
    fs.mkdirSync(path.dirname(outer), { recursive: true });
    fs.writeFileSync(outer, `@echo off\r\ncall "${path.join(root, 'bin', 'qwen.cmd')}" %*\r\n`);
    const plan = a._spawnPlan(outer, ['--version']);
    assert.equal(plan.command, node);
    assert.equal(plan.args[0], path.join(root, 'lib', 'cli-entry.js'));
  });

  it('refuses to put a turn through cmd.exe when no Node can bypass the .cmd shim', async () => {
    const shim = path.join(tmpRoot, 'npm', 'qwen.cmd');
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, '@echo off\r\nnode "%~dp0\\node_modules\\x\\cli.js" %*\r\n');
    const a = makeAdapter();
    a._isWindows = true;
    a._findNodeBin = () => null;
    // The fixed --version probe may still go through cmd.exe ...
    assert.equal(a._spawnPlan(shim, ['--version'], { shellSafe: true }).command, 'cmd.exe');
    // ... a real turn, carrying the system prompt, may not.
    const plan = a._spawnPlan(shim, ['--append-system-prompt', 'say "a" & b']);
    assert.ok(plan.error);
    assert.equal(plan.command, undefined);
    assert.match(plan.error, /Node\.js >= 22/);

    a._findQwenBinary = () => shim;
    a._checkVersion = () => ({ version: '0.25.1', supported: true });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /Node\.js >= 22/);
  });

  it("runs an npm install's entry script under Node, not through its shim", () => {
    const plan = makeAdapter()._spawnPlan(fakeBin, ['--version']);
    assert.equal(plan.command, process.execPath);
    assert.deepEqual(plan.args, [fakeBin, '--version']);
  });
});

describe('QwenCodeAdapter — settings layer file', () => {
  it('preserves system settings while isolating explicit credentials for one run', async () => {
    const admin = path.join(tmpRoot, 'system-policy.json');
    const original = '{ // machine policy\n"tools":{"exclude":["web_search"]},"modelProviders":{"openai":[]}\n}';
    fs.writeFileSync(admin, original);
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'agent-key', QWEN_CODE_SYSTEM_SETTINGS_PATH: admin } });
    await send(a);
    const cap = readCapture(a);
    assert.deepEqual(cap.settings, { tools: { exclude: ['web_search'] }, modelProviders: null });
    assert.notEqual(cap.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, admin);
    assert.equal(fs.existsSync(cap.env.QWEN_CODE_SYSTEM_SETTINGS_PATH), false);
    assert.equal(fs.readFileSync(admin, 'utf8'), original);
  });

  it('leaves a keyless run on the original system settings file', async () => {
    const admin = path.join(tmpRoot, 'keyless-system.json');
    const settings = { modelProviders: { openai: [{ id: 'saved-model' }] } };
    fs.writeFileSync(admin, JSON.stringify(settings));
    const a = makeAdapter({ agentEnv: { QWEN_CODE_SYSTEM_SETTINGS_PATH: admin } });
    await send(a);
    const cap = readCapture(a);
    assert.equal(cap.env.QWEN_CODE_SYSTEM_SETTINGS_PATH, admin);
    assert.deepEqual(cap.settings, settings);
    assert.ok(fs.existsSync(admin));
  });

  it('refuses to run if system settings cannot be preserved safely', async () => {
    const admin = path.join(tmpRoot, 'invalid-system.json');
    fs.writeFileSync(admin, '{ invalid json');
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'agent-key', QWEN_CODE_SYSTEM_SETTINGS_PATH: admin } });
    await send(a);
    assert.equal(fs.existsSync(capturePath), false);
    assert.deepEqual(a._captured.response, []);
    assert.match(a._captured.error[0], /Could not prepare Qwen Code settings/);
  });

  it('keeps the original system-defaults lookup when its overlay cannot be written', async () => {
    const admin = path.join(tmpRoot, 'policy', 'settings.json');
    fs.mkdirSync(path.dirname(admin), { recursive: true });
    fs.writeFileSync(admin, '{}');
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'agent-key', QWEN_CODE_SYSTEM_SETTINGS_PATH: admin } });
    a._writeSystemDefaults = () => null;
    await send(a);
    assert.equal(readCapture(a).env.QWEN_CODE_SYSTEM_DEFAULTS_PATH,
      path.join(tmpRoot, 'policy', 'system-defaults.json'));
  });

  it('merges a machine-wide system-defaults file instead of replacing it', () => {
    const a = makeAdapter();
    delete a._writeSystemDefaults;
    const home = path.join(tmpRoot, 'home-merge');
    const admin = path.join(tmpRoot, 'admin-defaults.json');
    fs.writeFileSync(admin, JSON.stringify({ memory: { enableManagedAutoMemory: true } }));
    a.agentEnv = { ...a.agentEnv, QWEN_CODE_SYSTEM_DEFAULTS_PATH: admin };
    const realHome = os.homedir;
    os.homedir = () => home;
    try {
      const target = a._writeSystemDefaults();
      assert.equal(target, path.join(home, '.openagents', 'qwen-code', 'system-defaults.json'));
      const written = JSON.parse(fs.readFileSync(target, 'utf-8'));
      assert.equal(written.memory.enableManagedAutoMemory, true);
      assert.equal(written.memory.enableManagedAutoDream, false);
    } finally {
      os.homedir = realHome;
    }
  });

  it('leaves the file alone once the CLI has stamped its version into it', () => {
    // The CLI migrates the settings file it loads and writes "$version" back.
    // Rewriting over that every run would make it migrate and write again.
    const a = makeAdapter();
    delete a._writeSystemDefaults;
    const home = path.join(tmpRoot, 'home-stamp');
    const realHome = os.homedir;
    os.homedir = () => home;
    try {
      const target = a._writeSystemDefaults();
      const stamped = { ...JSON.parse(fs.readFileSync(target, 'utf-8')), $version: 4 };
      fs.writeFileSync(target, JSON.stringify(stamped));
      const before = fs.readFileSync(target, 'utf-8');
      assert.equal(a._writeSystemDefaults(), target);
      assert.equal(fs.readFileSync(target, 'utf-8'), before);
    } finally {
      os.homedir = realHome;
    }
  });

  it("leaves an administrator's unreadable defaults file in charge", () => {
    const a = makeAdapter();
    delete a._writeSystemDefaults;
    const admin = path.join(tmpRoot, 'broken-defaults.json');
    fs.writeFileSync(admin, '{ not json');
    a.agentEnv = { ...a.agentEnv, QWEN_CODE_SYSTEM_DEFAULTS_PATH: admin };
    assert.equal(a._writeSystemDefaults(), null);
  });
});

describe('QwenCodeAdapter — preflight', () => {
  it('refuses a CLI below the version that takes this argv', async () => {
    const a = makeAdapter({ fakeVersion: '0.15.0' });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /below the minimum supported version 0\.16\.0/);
    assert.match(a._captured.error[0], /npm install -g @qwen-code\/qwen-code/);
  });

  it('names the install command when the CLI is missing entirely', async () => {
    const a = makeAdapter();
    a._findQwenBinary = () => null;
    await send(a);
    assert.match(a._captured.error[0], /npm install -g @qwen-code\/qwen-code/);
  });

  it('preflight reports a missing CLI as runtime_missing', () => {
    const a = makeAdapter();
    a._findQwenBinary = () => null;
    const r = a.preflight();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'runtime_missing');
    assert.match(r.message, /npm install -g @qwen-code\/qwen-code/);
  });

  it('preflight reports a CLI below the minimum as version_incompatible', () => {
    const a = makeAdapter({ fakeVersion: '0.15.0' });
    const r = a.preflight();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'version_incompatible');
    assert.match(r.message, /0\.15\.0.*0\.16\.0/);
  });

  it('preflight passes a supported CLI', () => {
    assert.deepEqual(makeAdapter().preflight(), { ok: true });
  });

  it('refuses to run against a working directory that does not exist', async () => {
    const a = makeAdapter({ workingDir: path.join(tmpRoot, 'no-such-dir') });
    await send(a);
    assert.match(a._captured.error[0], /Working directory does not exist/);
  });
});
