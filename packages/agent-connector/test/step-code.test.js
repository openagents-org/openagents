'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const StepCodeAdapter = require('../src/adapters/step-code');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');
const { REASON } = require('../src/adapters/health-status');

// ---------------------------------------------------------------------------
// A mock `step`: a Node script that records how it was invoked and replays the
// JSON stream the real CLI (0.1.5) printed for each scenario, so the adapter's
// spawn → pipe-prompt → parse → reply path runs with no CLI, key or network.
//
// The shapes that matter: a provider failure is an assistant message with
// stopReason "error" and an errorMessage, exit 1; a run that never found a
// model prints only to stderr ("No API key found…"), exit 1, whether the key
// was rejected or the endpoint is down; plan mode is a `step-plan` session
// entry, and `/plan` on stdin toggles it without a model call.
// ---------------------------------------------------------------------------
let tmpRoot;
let fakeBin;
let capturePath;
let homeDir;

const FAKE_SCRIPT = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write((process.env.FAKE_VERSION || '0.1.5') + '\\n');
  process.exit(0);
}
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const at = (f) => args.indexOf(f);
const sid = at('--session-id') >= 0 ? args[at('--session-id') + 1] : 'generated';
const header = () => w({ type: 'session', version: 3, id: sid, timestamp: 't', cwd: process.cwd() });
const plan = (enabled) => w({ type: 'entry_appended', entry: { type: 'custom', customType: 'step-plan',
  data: { enabled, planFilePath: path.join(process.env.STEP_CODING_AGENT_PLAN_DIR || '/x', 'session-' + sid + '.md') } } });
const assistant = (content, stopReason, extra) => {
  w({ type: 'message_start', message: { role: 'assistant', content: [] } });
  content.forEach((b, i) => {
    if (b.type === 'text') {
      w({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: i } });
      w({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: i, delta: b.text } });
      w({ type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: i, content: b.text } });
    } else if (b.type === 'thinking') {
      w({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: i, content: b.thinking } });
    } else if (b.type === 'toolCall') {
      w({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: i, id: b.id, toolName: b.name } });
      w({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: i, toolCall: b } });
    }
  });
  w({ type: 'message_end', message: { role: 'assistant', content, stopReason, ...(extra || {}) } });
};
const tool = (id, name, args2, text, isError) => {
  w({ type: 'tool_execution_start', toolCallId: id, toolName: name, args: args2 });
  w({ type: 'tool_execution_end', toolCallId: id, toolName: name, result: { content: [{ type: 'text', text }] }, isError: !!isError });
};
const start = () => {
  header();
  if (at('--plan') >= 0) plan(true);
  w({ type: 'agent_start' });
  w({ type: 'turn_start' });
};
const end = () => { w({ type: 'agent_end', messages: [] }); w({ type: 'agent_settled' }); };

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CAPTURE) {
    const root = process.env.STEP_CODING_AGENT_DIR ? path.dirname(process.env.STEP_CODING_AGENT_DIR) : null;
    const cfgPath = root ? path.join(root, 'config.toml') : null;
    let config = null;
    let configMode = null;
    try { config = fs.readFileSync(cfgPath, 'utf8'); configMode = fs.statSync(cfgPath).mode & 0o777; } catch {}
    const names = ['STEP_API_KEY', 'STEP_BASE_URL', 'STEP_CODING_AGENT_DIR', 'STEPCODE_STORAGE_ROOT_DIR',
      'STEP_CODING_AGENT_PLAN_DIR', 'STEPCODE_AUTH_PATH', 'STEPCODE_SEARCH_API_KEY', 'STEPCODE_SEARCH_WEB_MCP_URL',
      'STEP_NON_INTERACTIVE_DENIAL', 'STEP_DISABLE_CRON', 'STEP_DISABLE_WORKFLOW', 'STEPCODE_DISABLE_TELEMETRY',
      'LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'STEP_PROVIDER_API_URL', 'STEP_MODEL', 'PATH'];
    const env = Object.fromEntries(names.map((n) => [n, process.env[n] === undefined ? null : process.env[n]]));
    const prev = fs.existsSync(process.env.FAKE_CAPTURE) ? JSON.parse(fs.readFileSync(process.env.FAKE_CAPTURE, 'utf8')) : { runs: [] };
    prev.runs.push({ args, stdin, cwd: process.cwd(), env, config, configMode, configPath: cfgPath });
    fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify(prev));
  }
  const scenario = process.env.FAKE_SCENARIO || 'success';

  // A session in plan mode switched off by the adapter: no model call.
  if (stdin === '/plan') {
    header();
    plan(false);
    process.exit(0);
  }

  if (scenario === 'success') {
    start();
    assistant([{ type: 'thinking', thinking: 'Read the file first.' }, { type: 'text', text: 'Reading the file.' },
      { type: 'toolCall', id: 't1', name: 'run_command', arguments: { command: 'cat src/app.js' } }], 'toolUse');
    tool('t1', 'run_command', { command: 'cat src/app.js' }, 'x');
    assistant([{ type: 'text', text: 'Done - read src/app.js.' }], 'stop');
    end();
    process.exit(0);
  }
  if (scenario === 'no_key') {
    header();
    process.stderr.write('No API key found for the selected model.\\n\\nUse /login to log into a provider via OAuth or API key. See:\\n  /h/.stepcode/bin/docs/providers.md\\n');
    process.exit(1);
  }
  if (scenario === 'no_models') {
    process.stderr.write('Error: No models available. Check your installation or add models to models.json.\\n');
    process.exit(1);
  }
  if (scenario === 'http_401') {
    start();
    assistant([], 'error', { errorMessage: '401: {"error":{"message":"Incorrect API key provided","type":"invalid_api_key"}}' });
    end();
    process.exit(1);
  }
  if (scenario === 'retry_ok') {
    start();
    assistant([], 'error', { errorMessage: '500: {"error":{"message":"upstream hiccup"}}' });
    w({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 10, errorMessage: '500' });
    assistant([{ type: 'text', text: 'Recovered answer.' }], 'stop');
    w({ type: 'auto_retry_end', success: true, attempt: 1 });
    end();
    process.exit(0);
  }
  if (scenario === 'retry_429') {
    start();
    assistant([], 'error', { errorMessage: '429: {"error":{"message":"rate limited"}}' });
    w({ type: 'auto_retry_start', attempt: 1, maxAttempts: 1, delayMs: 10, errorMessage: '429' });
    assistant([], 'error', { errorMessage: '429: {"error":{"message":"rate limited"}}' });
    w({ type: 'auto_retry_end', success: false, attempt: 1, finalError: '429: {"error":{"message":"rate limited"}}' });
    end();
    process.exit(1);
  }
  if (scenario === 'bad_base') {
    process.stderr.write('Error: Failed to load extension "<inline:Step>": Step API base URL must be a valid URL\\nHint: Start without extensions using "step -ne".\\n');
    process.exit(1);
  }
  if (scenario === 'echo_key') {
    // The key is in the CLI's environment, so the shell commands it runs see
    // it, and the model can repeat it anywhere.
    const key = process.env.STEP_API_KEY;
    start();
    assistant([{ type: 'text', text: 'Your key is ' + key }, { type: 'toolCall', id: 't1', name: 'run_command', arguments: { command: 'echo ' + key } }], 'toolUse');
    tool('t1', 'run_command', { command: 'export K=' + key + ' && env' }, 'STEP_API_KEY=' + key, true);
    assistant([{ type: 'text', text: 'It is ' + key }], 'stop');
    end();
    process.exit(0);
  }
  if (scenario === 'empty') {
    start();
    end();
    process.exit(0);
  }
  if (scenario === 'long_tool') {
    // A build: nothing on stdout until the tool's result comes back.
    start();
    w({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'run_command', args: { command: 'make' } });
    setTimeout(() => {
      w({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'run_command', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false });
      assistant([{ type: 'text', text: 'Built.' }], 'stop');
      end();
      process.exit(0);
    }, 700);
    return;
  }
  if (scenario === 'wedged') {
    start();
    setInterval(() => {}, 1000);
    return;
  }
  if (scenario === 'hang') {
    // A long shell command. Like the real one it runs in a session of its
    // own, so signalling the CLI's process group cannot reach it.
    start();
    w({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'run_command', args: { command: 'sleep 300' } });
    const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(process.env.FAKE_PIDS, JSON.stringify({ cli: process.pid, tool: child.pid }));
    process.on('SIGINT', () => {});
    setInterval(() => {}, 1000);
    return;
  }
  process.exit(0);
});
`;

const SESSIONS = () => path.join(tmpRoot, 'sessions.json');

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-step-code-'));
  fakeBin = path.join(tmpRoot, 'fake-step.js');
  fs.writeFileSync(fakeBin, FAKE_SCRIPT, { mode: 0o755 });
  capturePath = path.join(tmpRoot, 'capture.json');
  homeDir = path.join(tmpRoot, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  try { fs.rmSync(capturePath, { force: true }); } catch {}
  try { fs.rmSync(SESSIONS(), { force: true }); } catch {}
  try { fs.rmSync(path.join(tmpRoot, 'root'), { recursive: true, force: true }); } catch {}
  try { fs.rmSync(path.join(homeDir, '.stepcode'), { recursive: true, force: true }); } catch {}
});

function makeAdapter(extra = {}) {
  const a = new StepCodeAdapter({
    workspaceId: 'ws-step-test',
    channelName: 'thread',
    token: 'ws-token-0123456789',
    agentName: 'step-bot',
    agentType: 'step-code',
    endpoint: 'https://example.invalid',
    agentEnv: {
      PATH: process.env.PATH,
      HOME: homeDir,
      USERPROFILE: homeDir,
      ...(extra.agentEnv || {}),
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      FAKE_PIDS: path.join(tmpRoot, 'pids.json'),
      ...(extra.fakeVersion ? { FAKE_VERSION: extra.fakeVersion } : {}),
    },
    workingDir: extra.workingDir || tmpRoot,
  });
  a._root = path.join(tmpRoot, 'root');
  a._sessionsFile = SESSIONS();
  a._channelSessions = {};
  a._loadSessions();
  a._captured = { thinking: [], status: [], response: [], error: [], logs: [], reported: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a._reportStatus = (reason) => { a._captured.reported.push(reason); };
  a._announceUserStop = async () => {};
  a.cleanupTodos = async () => {};
  a._log = (m) => { a._captured.logs.push(String(m)); };
  a.getBrowserEnabled = async () => false;
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => extra.recent || [],
    sendMessage: async () => ({}),
    getTodos: async () => ({ todos: [] }),
  };
  a._findStepBinary = () => fakeBin;
  a._findNodeBin = () => process.execPath;
  a._probeModels = async () => extra.probe || null;
  if (extra.mode) a._mode = extra.mode;
  return a;
}

const runs = () => (fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, 'utf-8')).runs : []);
const lastRun = (a) => {
  const r = runs();
  if (!r.length) {
    throw new Error(`the mock CLI never ran.\n  errors: ${JSON.stringify(a._captured.error)}\n  log:\n    ${a._captured.logs.join('\n    ')}`);
  }
  return r[r.length - 1];
};
const send = (a, content = 'do the thing', channel = 'thread') =>
  a._handleMessage({ content, sessionId: channel, senderType: 'human', senderName: 'user' });
const argAfter = (run, flag) => run.args[run.args.indexOf(flag) + 1];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = 'sk-step-form-key-0123456789';

describe('StepCodeAdapter — registration', () => {
  it('registers as step-code', () => {
    assert.equal(ADAPTER_MAP['step-code'], StepCodeAdapter);
    const a = createAdapter('step-code', { workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {} });
    assert.equal(a.constructor.name, 'StepCodeAdapter');
  });
});

describe('StepCodeAdapter — headless invocation', () => {
  it('pipes the prompt over stdin and runs headless JSON in the working directory', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a, 'refactor the auth module');
    const run = lastRun(a);
    assert.ok(run.stdin.includes('refactor the auth module'));
    assert.ok(!run.args.some((x) => x.includes('refactor the auth module')));
    assert.deepEqual(run.args.slice(0, 3), ['-p', '--mode', 'json']);
    assert.equal(run.cwd, fs.realpathSync(tmpRoot));
    assert.match(argAfter(run, '--session-id'), UUID_RE);
    assert.equal(argAfter(run, '--session-dir'), path.join(a._root, 'sessions'));
    assert.ok(run.args.includes('--no-approve'));
    for (const f of ['--no-context-files', '--no-skills']) assert.ok(!run.args.includes(f), f);
  });

  it('runs a key on its own variable and base, out of argv, with the generic names and overrides gone', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY, LLM_MODEL: 'step-3.5-flash', STEP_PROVIDER_API_URL: 'https://elsewhere' } });
    await send(a);
    const run = lastRun(a);
    assert.equal(run.env.STEP_API_KEY, KEY);
    assert.equal(run.env.STEP_BASE_URL, 'https://api.stepfun.com/v1');
    for (const k of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'STEP_PROVIDER_API_URL', 'STEPCODE_AUTH_PATH']) assert.equal(run.env[k], null, k);
    assert.ok(!run.args.some((x) => x.includes(KEY)));
    assert.equal(run.env.STEPCODE_SEARCH_API_KEY, KEY);
  });

  it("runs without a key on the user's own sign-in, ignoring the prefilled base URL", async () => {
    const a = makeAdapter({ agentEnv: { STEP_BASE_URL: 'https://api.stepfun.com/v1' } });
    await send(a);
    const run = lastRun(a);
    assert.equal(run.env.STEP_API_KEY, null);
    assert.equal(run.env.STEP_BASE_URL, null);
    assert.equal(run.env.STEPCODE_AUTH_PATH, path.join(homeDir, '.stepcode', 'auth.json'));
  });

  it('roots every run privately and keeps plans out of the project', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a);
    const run = lastRun(a);
    assert.ok(run.env.STEP_CODING_AGENT_DIR.startsWith(path.join(a._root, 'channels')));
    assert.equal(run.env.STEPCODE_STORAGE_ROOT_DIR, path.join(a._root, 'storage'));
    assert.equal(run.env.STEP_CODING_AGENT_PLAN_DIR, path.join(a._root, 'plans'));
    assert.equal(run.env.STEP_NON_INTERACTIVE_DENIAL, 'continue');
    assert.equal(run.env.STEP_DISABLE_CRON, '1');
    assert.equal(run.env.STEP_DISABLE_WORKFLOW, '1');
  });

  it('declares the workspace MCP server alone, with the token, and removes the file after the run', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a);
    const run = lastRun(a);
    assert.ok(run.config.includes('[mcp_servers.mcp__openagents-workspace]'));
    assert.ok(run.config.includes('OA_WORKSPACE_TOKEN = "ws-token-0123456789"'));
    assert.ok(run.config.includes('"--channel-name", "thread"'));
    assert.ok(/\[mcp_servers\.steppage__steppage\]\nenabled = false/.test(run.config));
    assert.ok(run.config.includes('preset = "full-access"\nfullAccessAcknowledged = true'));
    if (process.platform !== 'win32') assert.equal(run.configMode, 0o600);
    assert.equal(fs.existsSync(run.configPath), false);
  });

  it("gives each channel its own config root", async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a, 'one', 'thread-a');
    await send(a, 'two', 'thread-b');
    const [r1, r2] = runs();
    assert.notEqual(r1.env.STEP_CODING_AGENT_DIR, r2.env.STEP_CODING_AGENT_DIR);
    assert.ok(r2.config.includes('"--channel-name", "thread-b"'));
  });

  it("keeps the native web search off for a relay's key", async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY, LLM_BASE_URL: 'https://relay.example.com/v1' } });
    await send(a);
    const run = lastRun(a);
    assert.ok(argAfter(run, '--exclude-tools').split(',').includes('search_web'));
    assert.equal(run.env.STEPCODE_SEARCH_API_KEY, null);
  });

  it('passes the workspace model ahead of the form, and none when unset', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY, STEP_MODEL: 'step-3.5-flash' } });
    a.workspaceModel = 'step-5-preview';
    await send(a);
    assert.equal(argAfter(lastRun(a), '--model'), 'step-5-preview');
    assert.equal(a.modelLabel(), 'step-5-preview');

    const b = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(b);
    assert.ok(!lastRun(b).args.includes('--model'));
  });

  it('sends the workspace briefing, naming the tools as Step will', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    // The browser directive is the part that names tools in full.
    a.getBrowserEnabled = async () => true;
    await send(a);
    const brief = argAfter(lastRun(a), '--append-system-prompt');
    assert.ok(brief.includes('step-bot'));
    assert.ok(brief.includes('mcp__openagents-workspace__'));
  });

  it("honours the user's telemetry opt-out and puts the installer's fd/rg on PATH", async () => {
    fs.mkdirSync(path.join(homeDir, '.stepcode', 'agent', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.stepcode', 'config.toml'), '[telemetry]\nenabled = false\n');
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a);
    const run = lastRun(a);
    assert.equal(run.env.STEPCODE_DISABLE_TELEMETRY, '1');
    assert.ok(run.config.includes('[telemetry]'));
    assert.equal(run.env.PATH.split(path.delimiter)[0], path.join(homeDir, '.stepcode', 'agent', 'bin'));
  });
});

describe('StepCodeAdapter — sessions', () => {
  it('resumes the same session on the next message, with a recap only on the first', async () => {
    const recent = [{ messageType: 'chat', senderType: 'human', senderName: 'ann', content: 'earlier question' }];
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, recent });
    await send(a, 'first');
    await send(a, 'second');
    const [r1, r2] = runs();
    assert.equal(argAfter(r1, '--session-id'), argAfter(r2, '--session-id'));
    assert.ok(r1.stdin.includes('earlier question'));
    assert.ok(!r2.stdin.includes('earlier question'));
    assert.equal(r2.stdin, 'second');
  });

  it('survives a restart of the adapter', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a, 'first');
    const b = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(b, 'second');
    const [r1, r2] = runs();
    assert.equal(argAfter(r1, '--session-id'), argAfter(r2, '--session-id'));
  });

  it('starts a fresh session in a different working directory', async () => {
    const other = fs.mkdtempSync(path.join(tmpRoot, 'wd-'));
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a, 'first');
    a.workingDir = other;
    await send(a, 'second');
    const [r1, r2] = runs();
    assert.notEqual(argAfter(r1, '--session-id'), argAfter(r2, '--session-id'));
  });

  it('restart clears the channel session', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a, 'first');
    await a._onControlAction('restart', { channel: 'thread' });
    await send(a, 'second');
    const [r1, r2] = runs();
    assert.notEqual(argAfter(r1, '--session-id'), argAfter(r2, '--session-id'));
  });
});

describe('StepCodeAdapter — plan mode', () => {
  it('plans with --plan, never followed by a value, without Full Access', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, mode: 'plan' });
    await send(a);
    const run = lastRun(a);
    const i = run.args.indexOf('--plan');
    assert.ok(i > 0);
    assert.ok(run.args[i + 1].startsWith('-'));
    assert.ok(run.config.includes('preset = "approve-for-me"'));
    assert.ok(!run.config.includes('fullAccessAcknowledged'));
    assert.equal(a._channelSessions.thread.planActive, true);
  });

  it('takes the session out of plan mode before the next execute-mode turn', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, mode: 'plan' });
    await send(a, 'plan it');
    a._mode = 'execute';
    await send(a, 'now do it');
    const [, toggle, run] = runs();
    assert.equal(toggle.stdin, '/plan');
    assert.ok(!toggle.args.includes('--plan'));
    assert.equal(argAfter(toggle, '--session-id'), argAfter(run, '--session-id'));
    assert.equal(run.stdin, 'now do it');
    assert.ok(!run.args.includes('--plan'));
    assert.equal(a._channelSessions.thread.planActive, false);
    // The toggle is silent.
    assert.equal(a._captured.response.length, 2);
  });

  it('runs no toggle for a session that is not in plan mode', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a, 'one');
    await send(a, 'two');
    assert.equal(runs().length, 2);
  });
});

describe('StepCodeAdapter — replies', () => {
  it('posts the answer once, the narration and reasoning as thinking, the tool as status', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    await send(a);
    assert.deepEqual(a._captured.response, ['Done - read src/app.js.']);
    assert.ok(a._captured.thinking.includes('Read the file first.'));
    assert.ok(a._captured.thinking.includes('Reading the file.'));
    assert.ok(a._captured.status.some((s) => s.includes('run_command') && s.includes('cat src/app.js')));
    assert.deepEqual(a._captured.error, []);
  });

  it('delivers the answer of a turn that recovered through auto-retry', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'retry_ok' });
    await send(a);
    assert.deepEqual(a._captured.response, ['Recovered answer.']);
    assert.deepEqual(a._captured.error, []);
  });

  it('says so when a clean run produced nothing at all', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'empty' });
    await send(a);
    assert.equal(a._captured.response.length, 0);
    assert.ok(a._captured.error[0].includes('without producing a response'));
  });
});

describe('StepCodeAdapter — failures', () => {
  it('a machine with no sign-in and no key is told how to sign in', async () => {
    const a = makeAdapter({ scenario: 'no_key' });
    await send(a);
    assert.ok(a._captured.error[0].includes('step login'));
    assert.ok(a._captured.reported.includes(REASON.LOGIN_REQUIRED));
  });

  it('a stored sign-in that no longer works is called that', async () => {
    fs.mkdirSync(path.join(homeDir, '.stepcode'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.stepcode', 'auth.json'), JSON.stringify({ step: { type: 'oauth', access: 'x' } }));
    const a = makeAdapter({ scenario: 'no_key' });
    await send(a);
    assert.ok(a._captured.error[0].includes('rejected or has expired'));
  });

  it('a key whose model list is refused is a rejected key', async () => {
    let probed = 0;
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'no_key' });
    a._probeModels = async () => { probed++; return { status: 401 }; };
    await send(a);
    assert.equal(probed, 1);
    assert.ok(a._captured.error[0].includes('API key was rejected by api.stepfun.com'));
    assert.ok(a._captured.reported.includes(REASON.LOGIN_REQUIRED));
  });

  it('an endpoint that cannot be reached is not blamed on the key', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'no_models', probe: { networkError: true } });
    await send(a);
    assert.ok(a._captured.error[0].includes('could not reach'));
    assert.ok(!a._captured.reported.includes(REASON.LOGIN_REQUIRED));
  });

  it('a 401 from the model is a rejected key', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'http_401' });
    await send(a);
    assert.ok(a._captured.error[0].includes('rejected'));
    assert.equal(a._captured.response.length, 0);
  });

  it('a rate limit that outlasts the retries is reported as quota', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'retry_429' });
    await send(a);
    assert.ok(a._captured.error[0].includes('rate limited'));
    assert.ok(a._captured.status.some((s) => s.includes('retrying')));
  });

  it('a malformed base URL is named', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY, LLM_BASE_URL: 'api.stepfun.com' }, scenario: 'bad_base' });
    await send(a);
    assert.ok(a._captured.error[0].includes('not a valid URL'));
  });

  it("refuses another program called step", async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, fakeVersion: 'Smallstep CLI/0.28.7 (linux/amd64)' });
    await send(a);
    assert.equal(runs().length, 0);
    assert.ok(a._captured.error[0].includes('different program'));
    assert.equal(a.preflight().ok, false);
  });

  it('refuses a release older than the minimum', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, fakeVersion: '0.1.3' });
    await send(a);
    assert.equal(runs().length, 0);
    assert.ok(a._captured.error[0].includes('below the minimum'));
  });

  it('reports a missing CLI with the install command', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY } });
    a._findStepBinary = () => null;
    await send(a);
    assert.ok(a._captured.error[0].includes('static-openapi.stepfun.com/stepcode/install'));
    assert.equal(a.preflight().ok, false);
  });
});

describe('StepCodeAdapter — model-list probe', () => {
  const http = require('node:http');
  const serve = (handler) => new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const probe = (baseUrl, key = 'k') => StepCodeAdapter.prototype._probeModels.call(Object.create(StepCodeAdapter.prototype), { key, baseUrl });

  it('reports the status of a refused key, asking where the CLI asks', async () => {
    let seen = null;
    const srv = await serve((req, res) => { seen = { url: req.url, auth: req.headers.authorization }; res.writeHead(401); res.end('{}'); });
    try {
      assert.deepEqual(await probe(`http://127.0.0.1:${srv.address().port}/v1`, 'sk-bad'), { status: 401 });
      assert.deepEqual(seen, { url: '/v1/models', auth: 'Bearer sk-bad' });
    } finally { srv.close(); }
  });

  it('counts only chat models in a typed list', async () => {
    const srv = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'step-tts-mini', model_type: '语音合成' }] }));
    });
    try {
      assert.deepEqual(await probe(`http://127.0.0.1:${srv.address().port}`), { status: 200, emptyList: true });
    } finally { srv.close(); }
  });

  it('calls a refused connection unreachable', async () => {
    const srv = await serve(() => {});
    const port = srv.address().port;
    await new Promise((r) => srv.close(r));
    assert.deepEqual(await probe(`http://127.0.0.1:${port}/v1`), { networkError: true });
  });
});

describe('StepCodeAdapter — redaction', () => {
  it('never posts the key, wherever the run repeats it', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'echo_key' });
    await send(a);
    const posted = JSON.stringify([a._captured.thinking, a._captured.status, a._captured.response, a._captured.error]);
    assert.ok(!posted.includes(KEY), posted);
    assert.ok(posted.includes('[redacted]'));
    assert.ok(!a._captured.logs.join('\n').includes(KEY));
  });
});

describe('StepCodeAdapter — watchdog', () => {
  it('waits out a long tool call', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'long_tool' });
    a._watchdogIntervalMs = 100;
    a._watchdogMax = 3;
    await send(a);
    assert.deepEqual(a._captured.response, ['Built.']);
  });

  it('kills a run that has gone silent', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'wedged' });
    a._watchdogIntervalMs = 100;
    a._watchdogMax = 3;
    await send(a);
    assert.ok(a._captured.error[0].includes('stopped responding'));
  });
});

describe('StepCodeAdapter — stop', () => {
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  it('kills the CLI and the shell command it started in a session of its own', { skip: process.platform === 'win32' }, async () => {
    const pidsFile = path.join(tmpRoot, 'pids.json');
    try { fs.rmSync(pidsFile, { force: true }); } catch {}
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: KEY }, scenario: 'hang' });
    const turn = send(a);
    for (let i = 0; i < 100 && !fs.existsSync(pidsFile); i++) await new Promise((r) => setTimeout(r, 50));
    const pids = JSON.parse(fs.readFileSync(pidsFile, 'utf-8'));
    assert.ok(alive(pids.tool));

    await a._handleUserStop('thread');
    await turn;

    assert.equal(alive(pids.cli), false);
    for (let i = 0; i < 20 && alive(pids.tool); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(pids.tool), false);
    assert.deepEqual(a._captured.error, []);
    // The stopped session stays resumable.
    assert.match(a._channelSessions.thread.sessionId, UUID_RE);
  });
});
