'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CommandCodeAdapter = require('../src/adapters/commandcode');
const { ADAPTER_MAP, createAdapter } = require('../src/adapters');

// ---------------------------------------------------------------------------
// A mock Command Code CLI: a Node script that records how it was invoked and
// emits a scripted NDJSON sequence matching the documented headless contract
// (`{"type":"event",...}` frames then one `{"type":"result",...}` line), so the
// adapter's spawn → pipe-prompt → parse → reply path runs with no real CLI,
// account, or network.
// ---------------------------------------------------------------------------
let tmpRoot;
let fakeBin;
let capturePath;

const FAKE_SCRIPT = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write((process.env.FAKE_VERSION || '1.36.0') + '\\n');
  process.exit(0);
}
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const ev = (event) => w({ type: 'event', event });

let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  // Record the invocation for assertions.
  if (process.env.FAKE_CAPTURE) {
    fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ args, stdin, env: {
      COMMANDCODE_SKIP_UPDATES: process.env.COMMANDCODE_SKIP_UPDATES || null,
    } }));
  }
  const scenario = process.env.FAKE_SCENARIO || 'success';

  if (scenario === 'success') {
    ev({ type: 'run_start' });
    ev({ type: 'tool_running', toolCallId: 't1', toolName: 'read_file', description: 'src/x.js' });
    ev({ type: 'tool_completed', toolCallId: 't1', toolName: 'read_file' });
    ev({ type: 'text_delta', text: 'partial' });
    w({ type: 'result', subtype: 'success', sessionId: 'sess-abc', stopReason: 'end_turn',
        usage: { inputTokens: 10 }, durationMs: 12, finalText: 'Done - read src/x.js.' });
    process.exit(0);
  }
  if (scenario === 'auth') {
    // A run that dies before a session exists: no sessionId, no stopReason.
    process.stderr.write('not authenticated\\n');
    w({ type: 'result', subtype: 'error', usage: {}, durationMs: 3, finalText: '', error: 'Not authenticated' });
    process.exit(3);
  }
  if (scenario === 'max_turns') {
    process.stderr.write('session: sess-partial-1\\n');
    w({ type: 'result', subtype: 'max_turns', sessionId: 'sess-partial-1', stopReason: 'max_turns',
        usage: {}, durationMs: 9, finalText: 'Got halfway.' });
    process.exit(8);
  }
  if (scenario === 'unknown_events') {
    ev({ type: 'brand_new_event', payload: { a: 1 } });
    ev({ type: 'another_unknown' });
    w({ type: 'result', subtype: 'success', sessionId: 'sess-u', stopReason: 'end_turn',
        usage: {}, durationMs: 1, finalText: 'Survived.' });
    process.exit(0);
  }
  if (scenario === 'no_result') {
    ev({ type: 'run_start' });
    process.exit(1);
  }
  if (scenario === 'session_only_stderr') {
    // sessionId absent from the result line, present on --verbose stderr.
    process.stderr.write('session: 9f4e1c0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b\\n');
    w({ type: 'result', subtype: 'error', usage: {}, durationMs: 2, finalText: '', error: 'boom' });
    process.exit(1);
  }
  process.exit(0);
});
`;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-commandcode-'));
  fakeBin = path.join(tmpRoot, 'fake-command-code.js');
  fs.writeFileSync(fakeBin, FAKE_SCRIPT, { mode: 0o755 });
  capturePath = path.join(tmpRoot, 'capture.json');
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  // The adapter persists sessions and the workspace skill under ~/.openagents.
  for (const p of [
    path.join(os.homedir(), '.openagents', 'sessions', 'ws-cc-test_cc-bot_commandcode.json'),
    path.join(os.homedir(), '.openagents', 'commandcode-skills', 'ws-cc-test_cc-bot'),
  ]) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
  }
});

beforeEach(() => {
  try { fs.rmSync(capturePath, { force: true }); } catch {}
  try {
    fs.rmSync(path.join(os.homedir(), '.openagents', 'sessions', 'ws-cc-test_cc-bot_commandcode.json'), { force: true });
  } catch {}
});

function makeAdapter(extra = {}) {
  const a = new CommandCodeAdapter({
    workspaceId: 'ws-cc-test',
    channelName: 'thread',
    token: 'token',
    agentName: 'cc-bot',
    endpoint: 'https://example.invalid',
    agentEnv: {
      ...(extra.agentEnv || {}),
      FAKE_CAPTURE: capturePath,
      FAKE_SCENARIO: extra.scenario || 'success',
      ...(extra.fakeVersion ? { FAKE_VERSION: extra.fakeVersion } : {}),
    },
    workingDir: extra.workingDir || tmpRoot,
  });
  a._captured = { thinking: [], status: [], response: [], error: [] };
  a.sendThinking = async (_c, t) => { a._captured.thinking.push(t); };
  a.sendStatus = async (_c, t) => { a._captured.status.push(t); };
  a.sendResponse = async (_c, t) => { a._captured.response.push(t); };
  a.sendError = async (_c, t) => { a._captured.error.push(t); };
  a._log = () => {};
  a.client = {
    getSession: async () => ({ title: 'Session 1', titleManuallySet: false, resumeFrom: null }),
    updateSession: async () => ({}),
    getRecentMessages: async () => [],
  };
  a._findCommandCodeBinary = () => fakeBin;
  if (extra.mode) a._mode = extra.mode;
  return a;
}

const readCapture = () => JSON.parse(fs.readFileSync(capturePath, 'utf-8'));
const send = (a, content = 'do the thing') =>
  a._handleMessage({ content, sessionId: 'thread', senderType: 'human', senderName: 'user' });

describe('CommandCodeAdapter — registration', () => {
  it('is reachable through the adapter registry', () => {
    assert.ok(ADAPTER_MAP.commandcode);
    const a = createAdapter('commandcode', {
      workspaceId: 'w', channelName: 'c', token: 't', agentName: 'n', endpoint: 'https://e', agentEnv: {},
    });
    assert.equal(a.constructor.name, 'CommandCodeAdapter');
  });
});

describe('CommandCodeAdapter — binary resolution', () => {
  it('never considers `cmd`, which is the Windows command shell', () => {
    // The npm package installs cmd/cmdc/command-code/commandcode at the same
    // entry point. Resolving `cmd` on Windows would launch cmd.exe instead.
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'adapters', 'commandcode.js'), 'utf-8');
    const names = src.match(/const BIN_NAMES = \[([^\]]+)\]/)[1];
    assert.ok(names.includes("'command-code'"));
    assert.ok(!/'cmd'/.test(names), `BIN_NAMES must not contain 'cmd': ${names}`);
  });

  it("only ever returns an interpreter that clears the CLI's Node 22 floor", () => {
    // Command Code requires Node 22+. The adapter prefers an
    // OpenAgents-managed runtime and falls back to the host interpreter, so
    // the invariant — not the specific path — is what matters: whatever comes
    // back must clear the floor, and declining is only allowed when nothing
    // available does. Asserting a path instead would encode whether THIS
    // machine happens to have a managed runtime, and demand a Node 22 runner.
    // Built directly rather than via makeAdapter(), which stubs _findNodeBin.
    const a = new CommandCodeAdapter({
      workspaceId: 'ws-cc-test',
      channelName: 'thread',
      token: 'token',
      agentName: 'cc-bot',
      endpoint: 'https://example.invalid',
      agentEnv: {},
    });
    const nodeBin = a._findNodeBin();
    if (nodeBin) {
      assert.ok(a._nodeMajor(nodeBin) >= 22, `${nodeBin} is below the Node 22 floor`);
    } else {
      const ownMajor = Number(process.versions.node.split('.')[0]);
      assert.ok(ownMajor < 22, 'declined despite a host Node that clears the floor');
    }
  });
});

describe('CommandCodeAdapter — headless invocation', () => {
  it('pipes the prompt over stdin and keeps it out of argv', async () => {
    const a = makeAdapter();
    await send(a, 'refactor the auth module');
    const cap = readCapture();
    assert.ok(cap.stdin.includes('refactor the auth module'));
    // -p must stay valueless, and no argument may carry the prompt text.
    assert.equal(cap.args[cap.args.indexOf('-p') + 1], '--output-format');
    assert.ok(!cap.args.some((x) => x.includes('refactor the auth module')));
  });

  it('sends the non-interactive flag set and disables self-update', async () => {
    const a = makeAdapter();
    await send(a);
    const cap = readCapture();
    for (const flag of ['--output-format', '--skip-onboarding', '--trust', '--no-auto-update', '--verbose', '--yolo']) {
      assert.ok(cap.args.includes(flag), `missing ${flag}`);
    }
    assert.equal(cap.env.COMMANDCODE_SKIP_UPDATES, '1');
  });

  it('runs read-only in plan mode', async () => {
    const a = makeAdapter({ mode: 'plan' });
    await send(a);
    const cap = readCapture();
    assert.ok(cap.args.includes('--plan'));
    assert.ok(!cap.args.includes('--yolo'));
  });

  it('loads the workspace skill from an OpenAgents-owned directory', async () => {
    const a = makeAdapter();
    await send(a);
    const cap = readCapture();
    const skillDir = cap.args[cap.args.indexOf('--skill') + 1];
    assert.ok(skillDir, 'expected --skill');
    // The skill carries the workspace token: it must not land in the user's
    // project (it would be committed) or in ~/.commandcode (their own config).
    assert.ok(skillDir.includes(path.join('.openagents', 'commandcode-skills')), skillDir);
    assert.ok(!skillDir.startsWith(tmpRoot), 'skill must not be written into the project dir');
    const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
    assert.ok(md.includes('shell_command'), 'skill must name the tool Command Code actually has');
  });
});

describe('CommandCodeAdapter — results', () => {
  it('delivers the reply from the result line', async () => {
    const a = makeAdapter();
    await send(a);
    assert.deepEqual(a._captured.response, ['Done - read src/x.js.']);
    assert.deepEqual(a._captured.error, []);
  });

  it('reports a tool ticker without repeating identical activity', async () => {
    const a = makeAdapter();
    await send(a);
    assert.ok(a._captured.status.some((s) => s.startsWith('reading')), a._captured.status.join('|'));
  });

  it('survives unknown event types', async () => {
    const a = makeAdapter({ scenario: 'unknown_events' });
    await send(a);
    assert.deepEqual(a._captured.response, ['Survived.']);
  });

  it('maps exit 3 to an actionable sign-in error', async () => {
    const a = makeAdapter({ scenario: 'auth' });
    await send(a);
    assert.equal(a._captured.response.length, 0);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /authenticat/i);
  });

  it('still delivers a partial answer when the turn limit is hit', async () => {
    const a = makeAdapter({ scenario: 'max_turns' });
    await send(a);
    assert.equal(a._captured.error.length, 0);
    assert.equal(a._captured.response.length, 1);
    assert.match(a._captured.response[0], /Got halfway\./);
    assert.match(a._captured.response[0], /turn limit/i);
  });

  it('reports a failure with no output as an error, not an empty reply', async () => {
    const a = makeAdapter({ scenario: 'no_result' });
    await send(a);
    assert.equal(a._captured.response.length, 0);
    assert.equal(a._captured.error.length, 1);
  });
});

describe('CommandCodeAdapter — session continuity', () => {
  it('records the session id and resumes it on the next turn', async () => {
    const a = makeAdapter();
    await send(a, 'first');
    const first = readCapture();
    assert.ok(!first.args.includes('--resume'), 'the first turn must start fresh');
    assert.equal(a._channelSessions.thread.sessionId, 'sess-abc');

    await send(a, 'second');
    const second = readCapture();
    assert.equal(second.args[second.args.indexOf('--resume') + 1], 'sess-abc');
    // A resumed turn must not re-send the context header: the CLI has it.
    assert.equal(second.stdin.trim(), 'second');
  });

  it('recovers the session id from --verbose stderr when the result omits it', async () => {
    // The documented shape of an early failure: the result line carries no
    // sessionId, so without this fallback the channel would lose continuity.
    const a = makeAdapter({ scenario: 'session_only_stderr' });
    await send(a);
    assert.equal(a._channelSessions.thread.sessionId, '9f4e1c0a-2b3d-4e5f-8a9b-0c1d2e3f4a5b');
  });

  it('does not resume a session recorded against a different working directory', () => {
    const a = makeAdapter();
    a._channelSessions.thread = { sessionId: 'sess-elsewhere', workingDir: path.join(tmpRoot, 'other') };
    assert.equal(a._resumableSession('thread', tmpRoot), null);
    assert.equal(a._resumableSession('thread', path.join(tmpRoot, 'other')), 'sess-elsewhere');
  });
});

describe('CommandCodeAdapter — version gate', () => {
  it('refuses a CLI older than the headless-JSON release', async () => {
    const a = makeAdapter({ fakeVersion: '0.37.0' });
    await send(a);
    assert.equal(a._captured.response.length, 0);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /1\.0\.0/);
    assert.ok(!fs.existsSync(capturePath), 'the run must not start');
  });

  it('accepts the pinned version', async () => {
    const a = makeAdapter({ fakeVersion: '1.36.0' });
    await send(a);
    assert.equal(a._captured.error.length, 0);
  });
});

describe('CommandCodeAdapter — working directory', () => {
  it('errors instead of silently falling back when the dir is missing', async () => {
    const a = makeAdapter({ workingDir: path.join(tmpRoot, 'does-not-exist') });
    await send(a);
    assert.equal(a._captured.error.length, 1);
    assert.match(a._captured.error[0], /Working directory does not exist/);
  });
});
