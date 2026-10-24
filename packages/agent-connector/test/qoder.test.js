'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const QoderAdapter = require('../src/adapters/qoder');
const QoderCnAdapter = require('../src/adapters/qoder-cn');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');

// ---------------------------------------------------------------------------
// A mock qodercli: a Node script that records how it was invoked and replays
// what the real CLI (1.1.72) printed for each scenario, so the adapter's
// spawn → pipe-prompt → parse → reply path runs with no real CLI or account.
//
// The failure shapes are the point: signed out ends on a result frame whose
// subtype is "success" with is_error true (exit 1); a rejected token prints
// nothing on stdout and a QoderAuthError on stderr; a resume the CLI cannot
// find exits 42 from stderr alone.
// ---------------------------------------------------------------------------
let tmpRoot;
let fakeBin;
let capturePath;

const FAKE_SCRIPT = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { spawn } = require('child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write((process.env.FAKE_VERSION || '1.1.72') + '\\n');
  process.exit(0);
}
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const at = (f) => args.indexOf(f);
const resumed = at('-r') >= 0 ? args[at('-r') + 1] : null;
const sid = resumed || (at('--session-id') >= 0 ? args[at('--session-id') + 1] : 'generated-by-cli');
const init = () => w({ type: 'system', subtype: 'init', qodercli_version: '1.1.72', protocol_version: '1.5.0',
  session_id: sid, model: at('-m') >= 0 ? args[at('-m') + 1] : 'auto', permissionMode: 'bypassPermissions',
  tools: ['Bash', 'Read'], mcp_servers: [{ name: 'openagents-workspace', status: 'connected' }] });
const say = (content, extra) => w({ type: 'assistant', session_id: sid, message: { role: 'assistant', content }, ...(extra || {}) });
const result = (o) => w({ type: 'result', session_id: sid, num_turns: 1, duration_ms: 9, ...o });
const env = (...names) => Object.fromEntries(names.map((n) => [n, process.env[n] === undefined ? null : process.env[n]]));

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CAPTURE) {
    const mcpAt = at('--mcp-config');
    const mcp = mcpAt >= 0 ? JSON.parse(fs.readFileSync(args[mcpAt + 1], 'utf8')) : null;
    const prev = fs.existsSync(process.env.FAKE_CAPTURE) ? JSON.parse(fs.readFileSync(process.env.FAKE_CAPTURE, 'utf8')) : { runs: [] };
    prev.runs.push({ args, stdin, cwd: process.cwd(), mcp, env: env(
      'QODER_PERSONAL_ACCESS_TOKEN', 'QODERCN_PERSONAL_ACCESS_TOKEN', 'QODER_NO_RC', 'QODERCN_NO_RC',
      'LLM_API_KEY', 'LLM_MODEL', 'QODER_MODEL') });
    fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify(prev));
  }
  const scenario = process.env.FAKE_SCENARIO || 'success';

  if (scenario === 'success') {
    init();
    say([{ type: 'thinking', thinking: 'Read the file first.' }, { type: 'text', text: 'Reading the file.' }]);
    say([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat src/app.js' } }]);
    w({ type: 'user', session_id: sid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } });
    say([{ type: 'text', text: 'Done - read src/app.js.' }]);
    result({ subtype: 'success', is_error: false, result: 'Done - read src/app.js.' });
    process.exit(0);
  }
  if (scenario === 'signed_out') {
    init();
    say([{ type: 'text', text: 'Not logged in · Please run /login' }], { error: 'authentication_failed' });
    result({ subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', terminal_reason: 'completed' });
    process.exit(1);
  }
  if (scenario === 'pat_rejected') {
    process.stderr.write('An unexpected critical error occurred:QoderAuthError: The QODER_PERSONAL_ACCESS_TOKEN environment variable contains a token that was rejected. It overrides any saved login, so unset it or set a valid token, then restart.\\n    at FD (/$bunfs/root/chunk.js:1:1)\\n');
    process.stderr.write('debug: token=' + (process.env.QODER_PERSONAL_ACCESS_TOKEN || '') + '\\n');
    process.exit(1);
  }
  if (scenario === 'stale_resume') {
    if (resumed) {
      process.stderr.write('Error resuming session: Invalid session identifier "' + resumed + '".\\n  Searched current project and same-repo worktrees:\\n');
      process.exit(42);
    }
    init();
    result({ subtype: 'success', is_error: false, result: 'Fresh answer.' });
    process.exit(0);
  }
  if (scenario === 'quota') {
    init();
    result({ subtype: 'error_during_execution', is_error: true, errors: ['Your credits have run out.'], error_code: 118 });
    process.exit(1);
  }
  if (scenario === 'empty_result') {
    init();
    say([{ type: 'text', text: 'The answer is 42.' }]);
    result({ subtype: 'success', is_error: false, result: '' });
    process.exit(0);
  }
  if (scenario === 'unknown_frames') {
    init();
    w({ type: 'brand_new_frame', payload: 1 });
    result({ subtype: 'success', is_error: false, result: 'Survived.' });
    process.exit(0);
  }
  if (scenario === 'echo_token' || scenario === 'echo_token_error') {
    // The token is in the CLI's environment, so the shell commands it runs see
    // it, and the model can repeat it anywhere.
    const pat = process.env.QODER_PERSONAL_ACCESS_TOKEN;
    init();
    say([{ type: 'text', text: 'Your token is ' + pat }]);
    say([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'export QODER_PERSONAL_ACCESS_TOKEN=' + pat + ' && env' } }]);
    say([{ type: 'tool_use', id: 't2', name: 'TodoWrite', input: { todos: [{ content: 'rotate ' + pat, status: 'pending' }] } }]);
    if (scenario === 'echo_token') result({ subtype: 'success', is_error: false, result: 'It is ' + pat });
    else result({ subtype: 'error_during_execution', is_error: true, errors: ['request failed for ' + pat] });
    process.exit(scenario === 'echo_token' ? 0 : 1);
  }
  if (scenario === 'long_tool') {
    // A build: nothing on stdout until the tool's result comes back.
    init();
    say([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'make' } }]);
    setTimeout(() => {
      w({ type: 'user', session_id: sid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
      result({ subtype: 'success', is_error: false, result: 'Built.' });
      process.exit(0);
    }, 600);
    return;
  }
  if (scenario === 'wedged' || scenario === 'wedged_after_tool') {
    init();
    if (scenario === 'wedged_after_tool') {
      say([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]);
      w({ type: 'user', session_id: sid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } });
    }
    setInterval(() => {}, 1000);
    return;
  }
  if (scenario === 'model_fallback') {
    // What 1.1.73 does with a -m the account cannot run.
    process.stderr.write('Model "' + args[at('-m') + 1] + '" is not available right now; using "qfmodel" instead. Use /model to choose another model.\\n');
    w({ type: 'system', subtype: 'init', qodercli_version: '1.1.73', session_id: sid, model: 'Qwen3.8-Flash', mcp_servers: [] });
    result({ subtype: 'success', is_error: false, result: 'OK' });
    process.exit(0);
  }
  if (scenario === 'hang') {
    // A long shell command. Like the real Bash tool it runs in a session of
    // its own, so signalling the CLI's process group cannot reach it.
    init();
    say([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 300' } }]);
    const child = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    fs.writeFileSync(process.env.FAKE_PIDS, JSON.stringify({ cli: process.pid, tool: child.pid }));
    process.on('SIGINT', () => {}); // ignored, as the real CLI does while it waits
    setInterval(() => {}, 1000);
    return;
  }
  process.exit(0);
});
`;

const sessionsFile = (type) => path.join(os.homedir(), '.openagents', 'sessions', `ws-qoder-test_qoder-bot_${type}.json`);

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-qoder-'));
  fakeBin = path.join(tmpRoot, 'fake-qodercli.js');
  fs.writeFileSync(fakeBin, FAKE_SCRIPT, { mode: 0o755 });
  capturePath = path.join(tmpRoot, 'capture.json');
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  for (const t of ['qoder', 'qoder-cn']) { try { fs.rmSync(sessionsFile(t), { force: true }); } catch {} }
});

beforeEach(() => {
  try { fs.rmSync(capturePath, { force: true }); } catch {}
  for (const t of ['qoder', 'qoder-cn']) { try { fs.rmSync(sessionsFile(t), { force: true }); } catch {} }
});

function makeAdapter(extra = {}) {
  const Cls = extra.cn ? QoderCnAdapter : QoderAdapter;
  const a = new Cls({
    workspaceId: 'ws-qoder-test',
    channelName: 'thread',
    token: 'token',
    agentName: 'qoder-bot',
    agentType: extra.cn ? 'qoder-cn' : 'qoder',
    endpoint: 'https://example.invalid',
    agentEnv: {
      PATH: process.env.PATH,
      ...(extra.agentEnv || {}),
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      FAKE_PIDS: path.join(tmpRoot, 'pids.json'),
      ...(extra.fakeVersion ? { FAKE_VERSION: extra.fakeVersion } : {}),
    },
    workingDir: extra.workingDir || tmpRoot,
  });
  a._captured = { thinking: [], status: [], response: [], error: [], logs: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a._announceUserStop = async () => {};
  a.cleanupTodos = async () => {};
  a._log = (m) => { a._captured.logs.push(String(m)); };
  a.getBrowserEnabled = async () => !!extra.browser;
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => [],
    sendMessage: async () => ({}),
    getTodos: async () => ({ todos: [] }),
  };
  a._findQoderBinary = () => fakeBin;
  a._findNodeBin = () => process.execPath;
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
const send = (a, content = 'do the thing') =>
  a._handleMessage({ content, sessionId: 'thread', senderType: 'human', senderName: 'user' });
const argAfter = (run, flag) => run.args[run.args.indexOf(flag) + 1];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('QoderAdapter — registration', () => {
  it('registers both editions', () => {
    for (const [type, name] of [['qoder', 'QoderAdapter'], ['qoder-cn', 'QoderCnAdapter']]) {
      assert.ok(ADAPTER_MAP[type]);
      const a = createAdapter(type, { workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {} });
      assert.equal(a.constructor.name, name);
    }
  });
});

describe('QoderAdapter — headless invocation', () => {
  it('pipes the prompt over stdin and runs headless in the working directory', async () => {
    const a = makeAdapter();
    await send(a, 'refactor the auth module');
    const run = lastRun(a);
    assert.ok(run.stdin.includes('refactor the auth module'));
    assert.ok(!run.args.some((x) => x.includes('refactor the auth module')));
    assert.deepEqual(run.args.slice(0, 3), ['-p', '-o', 'stream-json']);
    assert.ok(run.args.includes('--yolo'));
    assert.equal(run.cwd, fs.realpathSync(tmpRoot));
  });

  it('hands the token over in the environment only, under its own name', async () => {
    const a = makeAdapter({ agentEnv: { LLM_API_KEY: 'pat-test-123456789' } });
    await send(a);
    const run = lastRun(a);
    assert.equal(run.env.QODER_PERSONAL_ACCESS_TOKEN, 'pat-test-123456789');
    assert.equal(run.env.LLM_API_KEY, null);
    assert.ok(!run.args.some((x) => x.includes('pat-test-123456789')));
  });

  it("leaves a signed-in agent's run without a token", async () => {
    const a = makeAdapter();
    await send(a);
    assert.equal(lastRun(a).env.QODER_PERSONAL_ACCESS_TOKEN, null);
  });

  it('keeps the CLI from editing shell rc files', async () => {
    const a = makeAdapter();
    await send(a);
    assert.equal(lastRun(a).env.QODER_NO_RC, '1');
  });

  it('passes the workspace model ahead of the form, and none when unset', async () => {
    const a = makeAdapter({ agentEnv: { QODER_MODEL: 'lite' } });
    a.workspaceModel = 'performance';
    await send(a);
    assert.equal(argAfter(lastRun(a), '-m'), 'performance');
    assert.equal(a.modelLabel(), 'performance');

    const b = makeAdapter();
    await send(b);
    assert.ok(!lastRun(b).args.includes('-m'));
  });

  it('keeps MCP isolated when the workspace config cannot be written', async () => {
    const a = makeAdapter();
    a._writeMcpConfig = () => null;
    await send(a);
    const run = lastRun(a);
    assert.ok(!run.args.includes('--mcp-config'));
    assert.ok(run.args.includes('--strict-mcp-config'));
  });

  it("isolates MCP to the workspace server and deletes the token-bearing config", async () => {
    const a = makeAdapter();
    await send(a);
    const run = lastRun(a);
    const mcpPath = argAfter(run, '--mcp-config');
    assert.ok(mcpPath.includes(path.join('.openagents', 'mcp-configs')));
    assert.ok(run.args.includes('--strict-mcp-config'));
    assert.equal(run.mcp.mcpServers['openagents-workspace'].env.OA_WORKSPACE_TOKEN, 'token');
    assert.equal(fs.existsSync(mcpPath), false);
  });

  it('turns the auto-updater off and denies the scheduling tools', async () => {
    const a = makeAdapter({ browser: true });
    await send(a);
    const run = lastRun(a);
    assert.equal(JSON.parse(argAfter(run, '--settings')).general.enableAutoUpdate, false);
    const denied = argAfter(run, '--disallowed-tools').split(',');
    for (const t of ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'WebFetch']) assert.ok(denied.includes(t), t);
  });

  it('sends the workspace briefing', async () => {
    const a = makeAdapter();
    await send(a);
    assert.ok(argAfter(lastRun(a), '--append-system-prompt').includes('qoder-bot'));
  });

  it('plans with the Plan agent and without --yolo', async () => {
    const a = makeAdapter({ mode: 'plan' });
    await send(a);
    const run = lastRun(a);
    assert.equal(argAfter(run, '--agent'), 'Plan');
    assert.ok(!run.args.includes('--yolo'));
  });

  it('refuses a CLI older than the floor', async () => {
    const a = makeAdapter({ fakeVersion: '1.0.10' });
    await send(a);
    assert.equal(runs().length, 0);
    assert.match(a._captured.error[0], /below the minimum supported version 1\.0\.45/);
  });

  it('drives the China edition under its own names', async () => {
    const a = makeAdapter({ cn: true, agentEnv: { LLM_API_KEY: 'pat-cn-123456789', QODER_PERSONAL_ACCESS_TOKEN: 'intl-should-not-leak' } });
    await send(a);
    const run = lastRun(a);
    assert.equal(run.env.QODERCN_PERSONAL_ACCESS_TOKEN, 'pat-cn-123456789');
    assert.equal(run.env.QODERCN_NO_RC, '1');
  });
});

describe('QoderAdapter — sessions', () => {
  it('names a new session, then resumes it on the next turn', async () => {
    const a = makeAdapter();
    await send(a, 'first');
    const sid = argAfter(lastRun(a), '--session-id');
    assert.match(sid, UUID_RE);
    await send(a, 'second');
    const second = lastRun(a);
    assert.equal(argAfter(second, '-r'), sid);
    assert.ok(!second.args.includes('--session-id'));
    assert.equal(second.stdin.trim(), 'second', 'a resumed turn is sent bare');
  });

  it('starts fresh when the saved session is gone', async () => {
    const a = makeAdapter({ scenario: 'stale_resume' });
    a._channelSessions.thread = { sessionId: 'gone-session', workingDir: tmpRoot };
    await send(a);
    const r = runs();
    assert.equal(r.length, 2);
    assert.equal(argAfter(r[0], '-r'), 'gone-session');
    assert.match(argAfter(r[1], '--session-id'), UUID_RE);
    assert.deepEqual(a._captured.response, ['Fresh answer.']);
    assert.equal(a._channelSessions.thread.sessionId, argAfter(r[1], '--session-id'));
  });

  it('does not keep a session that never reached the model', async () => {
    const a = makeAdapter({ scenario: 'signed_out' });
    await send(a);
    assert.equal(a._channelSessions.thread, undefined);
  });

  it('starts fresh in a different working directory', async () => {
    const a = makeAdapter();
    a._channelSessions.thread = { sessionId: 'elsewhere', workingDir: '/some/other/dir' };
    await send(a);
    assert.ok(!lastRun(a).args.includes('-r'));
  });
});

describe('QoderAdapter — replies', () => {
  it('answers from the result frame and streams progress', async () => {
    const a = makeAdapter();
    await send(a);
    assert.deepEqual(a._captured.response, ['Done - read src/app.js.']);
    assert.ok(a._captured.thinking.includes('Reading the file.'));
    assert.ok(a._captured.status.some((s) => s.startsWith('Bash › cat src/app.js')));
  });

  it('falls back to the last assistant text when the result is empty', async () => {
    const a = makeAdapter({ scenario: 'empty_result' });
    await send(a);
    assert.deepEqual(a._captured.response, ['The answer is 42.']);
  });

  it('survives frames it does not know', async () => {
    const a = makeAdapter({ scenario: 'unknown_frames' });
    await send(a);
    assert.deepEqual(a._captured.response, ['Survived.']);
  });

  it('explains a signed-out CLI instead of posting its synthetic message', async () => {
    const a = makeAdapter({ scenario: 'signed_out' });
    await send(a);
    assert.deepEqual(a._captured.response, []);
    assert.match(a._captured.error[0], /qodercli login/);
    assert.match(a._captured.error[0], /personal access token/);
  });

  it('reports a rejected token and keeps it out of the log', async () => {
    const a = makeAdapter({ scenario: 'pat_rejected', agentEnv: { QODER_PERSONAL_ACCESS_TOKEN: 'qd_secret_7a8b9c0d1e' } });
    await send(a);
    assert.match(a._captured.error[0], /rejected the personal access token/);
    assert.ok(!a._captured.logs.join('\n').includes('qd_secret_7a8b9c0d1e'));
  });

  for (const scenario of ['echo_token', 'echo_token_error']) {
    it(`keeps the token out of everything it posts (${scenario})`, async () => {
      const pat = 'qd_secret_7a8b9c0d1e';
      const a = makeAdapter({ scenario, agentEnv: { QODER_PERSONAL_ACCESS_TOKEN: pat } });
      const todos = [];
      a.sendTodos = async (_c, t) => { todos.push(t); };
      await send(a);
      const posted = JSON.stringify([a._captured, todos]);
      assert.ok(posted.includes('[redacted]'), 'nothing reached the channel');
      assert.ok(!posted.includes(pat), posted);
    });
  }

  it('says the account is out of credits', async () => {
    const a = makeAdapter({ scenario: 'quota' });
    await send(a);
    assert.match(a._captured.error[0], /out of credits/);
  });
});

describe('QoderAdapter — model fallback', () => {
  it('reports the model the CLI fell back to, once, and briefs the next turn with it', async () => {
    const a = makeAdapter({ scenario: 'model_fallback' });
    a.workspaceModel = 'performance';
    await send(a);
    assert.equal(argAfter(lastRun(a), '-m'), 'performance');
    assert.match(a._captured.response[0], /^OK\n\n_Qoder CLI cannot run the model "performance" on this account and used "Qwen3\.8-Flash" instead/);
    assert.equal(a.modelLabel(), 'Qwen3.8-Flash');

    await send(a);
    assert.equal(a._captured.response[1], 'OK', 'the notice is not repeated');
    assert.match(argAfter(lastRun(a), '--append-system-prompt'), /Model: Qwen3\.8-Flash/);

    a.workspaceModel = 'Qwen3.8-Max';
    assert.equal(a.modelLabel(), 'Qwen3.8-Max', 'a new pick is shown as is');
  });

  it('forgets the fallback once the model runs as asked', async () => {
    const a = makeAdapter({ scenario: 'model_fallback' });
    a.workspaceModel = 'performance';
    await send(a);
    a.agentEnv.FAKE_SCENARIO = 'success';
    await send(a);
    assert.equal(a.modelLabel(), 'performance');
  });
});

describe('QoderAdapter — watchdog', () => {
  const fastWatchdog = (a) => { a._watchdogIntervalMs = 25; a._watchdogMax = 4; return a; };

  it('lets a silent tool call run past the idle limit', async () => {
    const a = fastWatchdog(makeAdapter({ scenario: 'long_tool' }));
    await send(a);
    assert.deepEqual(a._captured.response, ['Built.']);
    assert.ok(!a._captured.logs.some((l) => /killing a wedged run/.test(l)));
  });

  for (const scenario of ['wedged', 'wedged_after_tool']) {
    it(`kills a run that goes silent with no tool call out (${scenario})`, async () => {
      const a = fastWatchdog(makeAdapter({ scenario }));
      await send(a);
      assert.ok(a._captured.logs.some((l) => /killing a wedged run/.test(l)));
      assert.match(a._captured.error[0], /interrupted/);
    });
  }
});

describe('QoderAdapter — stop', { skip: process.platform === 'win32' }, () => {
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  it('kills the CLI and the shell command it started in a session of its own', async () => {
    const a = makeAdapter({ scenario: 'hang' });
    const pidsFile = path.join(tmpRoot, 'pids.json');
    try { fs.rmSync(pidsFile, { force: true }); } catch {}
    const turn = send(a);
    for (let i = 0; i < 100 && !fs.existsSync(pidsFile); i++) await new Promise((r) => setTimeout(r, 50));
    const pids = JSON.parse(fs.readFileSync(pidsFile, 'utf-8'));
    assert.ok(alive(pids.tool));

    const t0 = Date.now();
    await a._onControlAction('stop', { channel: 'thread' });
    await turn;
    assert.ok(Date.now() - t0 < 5000, 'the stop must not wait out SIGINT');
    for (let i = 0; i < 20 && (alive(pids.cli) || alive(pids.tool)); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(alive(pids.cli), false, 'the CLI survived the stop');
    assert.equal(alive(pids.tool), false, 'the detached shell command survived the stop');
    assert.deepEqual(a._captured.response, []);
    assert.deepEqual(a._captured.error, []);
    // The stopped thread keeps its session.
    assert.match(a._channelSessions.thread.sessionId, UUID_RE);
  });
});
