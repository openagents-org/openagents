'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CodeBuddyAdapter = require('../src/adapters/codebuddy');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');

// ---------------------------------------------------------------------------
// A mock CodeBuddy CLI: a Node script that records how it was invoked and emits
// the real stream-json sequence (system/init → assistant → result), so the
// adapter's spawn → pipe-prompt → parse → reply path runs with no real CLI,
// account, or network.
//
// The scenarios are transcripts of what the actual CLI 2.142.0 produced, most
// importantly the failing ones: it exits **0** with `is_error: true` in the
// result frame, and a hard startup failure writes to stderr and exits 0 with no
// frames at all.
// ---------------------------------------------------------------------------
let tmpRoot;
let fakeBin;
let capturePath;

const FAKE_SCRIPT = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write((process.env.FAKE_VERSION || '2.142.0') + '\\n');
  process.exit(0);
}
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const sid = process.env.FAKE_SESSION_ID || 'sess-abc';
const init = () => w({ type: 'system', subtype: 'init', session_id: sid, model: 'default-model',
                       permissionMode: 'bypassPermissions', mcp_servers: [], tools: [] });

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CAPTURE) {
    fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ args, stdin, env: {
      DISABLE_AUTOUPDATER: process.env.DISABLE_AUTOUPDATER || null,
      CODEBUDDY_INTERNET_ENVIRONMENT: process.env.CODEBUDDY_INTERNET_ENVIRONMENT || null,
      CODEBUDDY_AUTH_TOKEN: process.env.CODEBUDDY_AUTH_TOKEN || null,
    } }));
  }
  const scenario = process.env.FAKE_SCENARIO || 'success';
  const resumed = args.includes('--resume');

  if (scenario === 'success') {
    init();
    w({ type: 'system', subtype: 'status', status: null });
    w({ type: 'file-history-snapshot', id: 'fh-1' });
    w({ type: 'assistant', message: { content: [
      { type: 'text', text: 'Reading the file.' },
      { type: 'tool_use', name: 'Read', input: { file_path: 'src/app.js' } },
    ] } });
    w({ type: 'result', subtype: 'success', is_error: false, result: 'Done - read src/app.js.',
        session_id: sid, num_turns: 2, duration_ms: 12 });
    process.exit(0);
  }
  if (scenario === 'auth') {
    // Verified shape: exit code 0, failure only in the result frame.
    init();
    w({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sid,
        errors: ['401 unauthorized'], errors_info: [{ status: 401, code: 401, category: 'auth', details: '401' }] });
    process.exit(0);
  }
  if (scenario === 'startup_error') {
    // A hard failure before any frame: stderr only, and still exit 0.
    process.stderr.write('502 连接被拒绝：可能是代理未启动\\n');
    process.exit(0);
  }
  if (scenario === 'stale_resume') {
    // A resume of a session the CLI no longer has: nothing on stdout at all.
    if (resumed) process.exit(1);
    init();
    w({ type: 'result', subtype: 'success', is_error: false, result: 'Fresh answer.', session_id: sid });
    process.exit(0);
  }
  if (scenario === 'text_then_failure') {
    init();
    w({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sid,
        result: 'Half an answer.', errors: [], errors_info: [{ status: 429, category: 'quota' }] });
    process.exit(0);
  }
  if (scenario === 'empty_result') {
    init();
    w({ type: 'assistant', message: { content: [{ type: 'text', text: 'The answer is 42.' }] } });
    w({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: sid });
    process.exit(0);
  }
  if (scenario === 'unknown_frames') {
    init();
    w({ type: 'brand_new_frame', payload: { a: 1 } });
    w({ type: 'result', subtype: 'success', is_error: false, result: 'Survived.', session_id: sid });
    process.exit(0);
  }
  process.exit(0);
});
`;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-codebuddy-'));
  fakeBin = path.join(tmpRoot, 'fake-codebuddy.js');
  fs.writeFileSync(fakeBin, FAKE_SCRIPT, { mode: 0o755 });
  capturePath = path.join(tmpRoot, 'capture.json');
});

const SESSIONS_FILE = path.join(
  os.homedir(), '.openagents', 'sessions', 'ws-cb-test_cb-bot_codebuddy.json',
);

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(SESSIONS_FILE, { force: true }); } catch {}
});

beforeEach(() => {
  try { fs.rmSync(capturePath, { force: true }); } catch {}
  try { fs.rmSync(SESSIONS_FILE, { force: true }); } catch {}
});

function makeAdapter(extra = {}) {
  const a = new CodeBuddyAdapter({
    workspaceId: 'ws-cb-test',
    channelName: 'thread',
    token: 'token',
    agentName: 'cb-bot',
    endpoint: 'https://example.invalid',
    agentEnv: {
      ...(extra.agentEnv || {}),
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      ...(extra.fakeVersion ? { FAKE_VERSION: extra.fakeVersion } : {}),
    },
    workingDir: extra.workingDir || tmpRoot,
  });
  a._captured = { thinking: [], status: [], response: [], error: [], todos: [], logs: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a.sendTodos = async (_c, t) => { a._captured.todos.push(t); };
  a._log = (m) => { a._captured.logs.push(String(m)); };
  a.getBrowserEnabled = async () => false;
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => [],
  };
  a._findCodeBuddyBinary = () => fakeBin;
  // Run the mock under THIS interpreter. Without it the adapter executes the
  // .js directly, which only works where the shebang can resolve `node` — and
  // the spawn env is the agent's env, so on a CI runner that fails with 127.
  a._findNodeBin = () => process.execPath;
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

describe('CodeBuddyAdapter — registration', () => {
  it('is reachable through the adapter registry', () => {
    assert.ok(ADAPTER_MAP.codebuddy);
    const a = createAdapter('codebuddy', {
      workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {},
    });
    assert.equal(a.constructor.name, 'CodeBuddyAdapter');
  });
});

describe('CodeBuddyAdapter — headless invocation', () => {
  it('pipes the prompt over stdin and keeps it out of argv', async () => {
    const a = makeAdapter();
    await send(a, 'refactor the auth module');
    const cap = readCapture(a);
    assert.ok(cap.stdin.includes('refactor the auth module'));
    assert.equal(cap.args[cap.args.indexOf('-p') + 1], '--output-format');
    assert.ok(!cap.args.some((x) => x.includes('refactor the auth module')));
  });

  it('sends the workspace briefing and the MCP config that carries the tools', async () => {
    const a = makeAdapter();
    await send(a);
    const cap = readCapture(a);
    const brief = cap.args[cap.args.indexOf('--append-system-prompt') + 1];
    assert.ok(brief.includes('cb-bot'), 'the briefing must name the agent');
    const mcpPath = cap.args[cap.args.indexOf('--mcp-config') + 1];
    assert.ok(mcpPath, 'the run must be given an MCP config');
    // Written 0600 into an OpenAgents-owned directory, and deleted after the
    // run — it carries the workspace token.
    assert.ok(mcpPath.includes(path.join('.openagents', 'mcp-configs')));
    assert.equal(fs.existsSync(mcpPath), false, 'the token-bearing config must not outlive the run');
  });

  it('disables the self-updater for the child', async () => {
    // A background update would swap the CLI, and the stream contract with it,
    // under a daemon that is mid-run.
    const a = makeAdapter();
    await send(a);
    assert.equal(readCapture(a).env.DISABLE_AUTOUPDATER, '1');
  });

  it('routes to the China site when the agent is configured for it', async () => {
    const a = makeAdapter({ agentEnv: { CODEBUDDY_REGION: 'china' } });
    await send(a);
    assert.equal(readCapture(a).env.CODEBUDDY_INTERNET_ENVIRONMENT, 'internal');
  });

  it('runs read-only in plan mode', async () => {
    const a = makeAdapter({ mode: 'plan' });
    await send(a);
    const cap = readCapture(a);
    assert.equal(cap.args[cap.args.indexOf('--permission-mode') + 1], 'plan');
    assert.ok(!cap.args.includes('-y'));
  });

  it('passes the workspace-selected model ahead of the configured one', async () => {
    const a = makeAdapter({ agentEnv: { CODEBUDDY_MODEL: 'configured-model' } });
    a.workspaceModel = 'picked-model';
    await send(a);
    assert.equal(readCapture(a).args[readCapture(a).args.indexOf('--model') + 1], 'picked-model');
  });
});

describe('CodeBuddyAdapter — replies', () => {
  it('answers from the result frame and streams progress along the way', async () => {
    const a = makeAdapter();
    await send(a);
    assert.deepEqual(a._captured.response, ['Done - read src/app.js.']);
    assert.deepEqual(a._captured.thinking, ['Reading the file.']);
    assert.ok(a._captured.status.some((s) => s.includes('Read › src/app.js')));
    assert.deepEqual(a._captured.error, []);
  });

  it('reports an auth failure even though the CLI exited 0', async () => {
    // The regression this adapter is built around: trusting the exit code here
    // would post an empty answer over a 401.
    const a = makeAdapter({ scenario: 'auth' });
    await send(a);
    assert.deepEqual(a._captured.response, []);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /CODEBUDDY_API_KEY/);
    assert.match(a._captured.error[0], /login/i);
  });

  it('reports a startup failure that only reached stderr', async () => {
    const a = makeAdapter({ scenario: 'startup_error' });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /502/);
  });

  it('delivers a partial answer with the reason appended rather than dropping it', async () => {
    const a = makeAdapter({ scenario: 'text_then_failure' });
    await send(a);
    assert.equal(a._captured.error.length, 0);
    assert.match(a._captured.response[0], /Half an answer\./);
    assert.match(a._captured.response[0], /rate limited|out of credits/i);
  });

  it('falls back to the streamed text when a clean run summarizes nothing', async () => {
    // Posting "no response generated" over text the user already watched
    // arrive is the worse of the two failures.
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

describe('CodeBuddyAdapter — session continuity', () => {
  it('resumes the channel session on the next turn', async () => {
    const a = makeAdapter();
    await send(a);
    await send(a, 'and now the tests');
    const cap = readCapture(a);
    assert.equal(cap.args[cap.args.indexOf('--resume') + 1], 'sess-abc');
    // Resuming means the CLI already holds the history; only the bare turn is
    // sent, with no recap prepended.
    assert.equal(cap.stdin.trim(), 'and now the tests');
  });

  it('remembers the session id from the init frame even when the turn failed', async () => {
    // The id lands before the model call, so a failed turn stays resumable —
    // otherwise every auth blip would silently fork a new conversation.
    const a = makeAdapter({ scenario: 'auth' });
    await send(a);
    assert.equal(a._channelSessions.thread.sessionId, 'sess-abc');
  });

  it('drops a stale session and retries once from scratch', async () => {
    const a = makeAdapter({ scenario: 'stale_resume' });
    a._channelSessions.thread = { sessionId: 'gone-session', workingDir: tmpRoot };
    await send(a);
    assert.deepEqual(a._captured.response, ['Fresh answer.']);
    assert.equal(a._channelSessions.thread.sessionId, 'sess-abc');
  });

  it('never resumes a session recorded against a different working directory', () => {
    // CodeBuddy keys a transcript to the directory it ran in, so a resume from
    // elsewhere would fail — start fresh instead.
    const a = makeAdapter();
    a._channelSessions.thread = { sessionId: 's-1', workingDir: '/somewhere/else' };
    assert.equal(a._resumableSession('thread', tmpRoot), null);
    assert.equal(a._resumableSession('thread', '/somewhere/else'), 's-1');
  });
});

describe('CodeBuddyAdapter — preflight', () => {
  it('refuses a CLI below the version that has a stream to parse', async () => {
    const a = makeAdapter({ fakeVersion: '1.9.0' });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /below the minimum supported version/);
    assert.match(a._captured.error[0], /npm install -g @tencent-ai\/codebuddy-code/);
  });

  it('names the install command when the CLI is missing entirely', async () => {
    const a = makeAdapter();
    a._findCodeBuddyBinary = () => null;
    await send(a);
    assert.match(a._captured.error[0], /npm install -g @tencent-ai\/codebuddy-code/);
  });

  it('refuses to run against a working directory that does not exist', async () => {
    // A wrong cwd is a destructive surprise, not a default to fall back from.
    const a = makeAdapter({ workingDir: path.join(tmpRoot, 'no-such-dir') });
    await send(a);
    assert.match(a._captured.error[0], /Working directory does not exist/);
  });
});
