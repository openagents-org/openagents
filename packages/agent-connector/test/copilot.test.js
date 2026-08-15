'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CopilotAdapter = require('../src/adapters/copilot');

const MOCK = path.join(__dirname, 'fixtures', 'mock-copilot.js');
try { fs.chmodSync(MOCK, 0o755); } catch {}

let tmp;

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cop-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/**
 * Build a CopilotAdapter wired to the mock CLI with all network sends captured.
 */
function makeAdapter({ scenario = 'success', mode = 'execute', workingDir, model, argsFile, env = {} } = {}) {
  const a = new CopilotAdapter({
    workspaceId: 'ws1',
    channelName: 'general',
    token: 'tok',
    agentName: 'cop',
    agentType: 'copilot',
    workingDir: workingDir === undefined ? tmp : workingDir,
    agentEnv: {
      ...process.env,
      MOCK_COPILOT_SCENARIO: scenario,
      ...(argsFile ? { MOCK_COPILOT_ECHO_ARGS_FILE: argsFile } : {}),
      ...(model ? { COPILOT_MODEL: model } : {}),
      ...env,
    },
  });
  // Point at the mock CLI and isolate session storage.
  a._copilotBin = MOCK;
  a._model = model || '';
  a._sessionsFile = path.join(tmp, 'sessions.json');
  a._channelSessions = {};
  a._mode = mode;
  // The mock prints version 1.0.63 → passes the gate. Pre-seed the cache so the
  // common path doesn't spawn an extra `--version` probe per test.
  a._versionGate = { version: '1.0.63', compatible: true };
  // Capture all outbound messages; avoid real workspace HTTP.
  a.sent = [];
  a.client = { sendMessage: async () => ({}) };
  a._autoTitleChannel = async () => {};
  a.sendStatus = async (ch, content, meta) => { a.sent.push({ type: 'status', ch, content, meta }); };
  a.sendThinking = async (ch, content) => { a.sent.push({ type: 'thinking', ch, content }); };
  a.sendResponse = async (ch, content) => { a.sent.push({ type: 'response', ch, content }); };
  a.sendError = async (ch, content) => { a.sent.push({ type: 'error', ch, content }); };
  a.sendFinalResult = async (t, ch, content) => { a.sent.push({ type: 'response', ch, content }); };
  a.sendFinalError = async (t, ch, content) => { a.sent.push({ type: 'error', ch, content }); };
  // Capture logs to assert redaction.
  a.logs = [];
  a._log = (m) => { a.logs.push(m); };
  return a;
}

const msg = (content, channel = 'general') => ({ content, sessionId: channel, senderName: 'user', senderType: 'human' });

describe('CopilotAdapter — happy path & event mapping', () => {
  it('posts a single final response and maps tool/shell/file events to status', async () => {
    const a = makeAdapter({ scenario: 'success' });
    await a._handleMessage(msg('list files'));

    const responses = a.sent.filter((s) => s.type === 'response');
    assert.equal(responses.length, 1, 'exactly one final response (no delta/final duplication)');
    // The final `message.completed` text supersedes the streamed deltas — the
    // answer must be EXACTLY the final text, not "All\ndone.\nAll done. …".
    assert.equal(responses[0].content, 'All done. Created src/x.js.');

    const statuses = a.sent.filter((s) => s.type === 'status').map((s) => s.content).join('\n');
    assert.match(statuses, /ls -la/);                 // tool_start (shell tool)
    assert.match(statuses, /Running:.*npm test.*exit 0/); // dedicated shell event
    assert.match(statuses, /Editing:.*src\/x\.js/);

    // reasoning went to thinking, not the final answer
    assert.ok(a.sent.some((s) => s.type === 'thinking' && /Looking at the project/.test(s.content)));
  });

  it('captures and persists the real Copilot session id, then resumes with it', async () => {
    const argsFile = path.join(tmp, 'args1.json');
    const a = makeAdapter({ scenario: 'success', argsFile });
    await a._handleMessage(msg('hi'));

    // Session saved to disk under the real id from the JSONL.
    assert.equal(a._channelSessions.general, 'mock-sess-123');
    const saved = JSON.parse(fs.readFileSync(a._sessionsFile, 'utf-8'));
    assert.equal(saved.general, 'mock-sess-123');

    // Next turn resumes by that id (not the OpenAgents agent id).
    const argsFile2 = path.join(tmp, 'args2.json');
    a.agentEnv.MOCK_COPILOT_ECHO_ARGS_FILE = argsFile2;
    await a._handleMessage(msg('again'));
    const args2 = JSON.parse(fs.readFileSync(argsFile2, 'utf-8'));
    // Optional-value flag MUST be the `=` form (verified against real CLI).
    assert.ok(args2.includes('--resume=mock-sess-123'), 'resumes with the captured session id via =form');
    assert.ok(!args2.includes('--resume'), 'never the space form for an optional-value flag');
  });

  it('first turn seeds a stable, working-dir-bound session name (not the agent id)', async () => {
    const argsFile = path.join(tmp, 'args.json');
    const a = makeAdapter({ scenario: 'error_auth', argsFile }); // no session captured on failure
    await a._handleMessage(msg('hi'));
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    const ni = args.indexOf('--name');
    assert.ok(ni >= 0, 'first turn passes --name');
    assert.match(args[ni + 1], /^openagents-[0-9a-f]{12}$/);
    assert.notEqual(args[ni + 1], 'cop', 'must not impersonate the agent id as session');
  });
});

describe('CopilotAdapter — prompt & permission safety', () => {
  it('passes a unicode/multiline/special-char prompt as a discrete -p argv element', async () => {
    const argsFile = path.join(tmp, 'args.json');
    const a = makeAdapter({ scenario: 'success', argsFile });
    const tricky = '请修复这个 bug\n```js\nconst x = `${a}`;\n```\n"quotes" $VAR `back` & | ; rm -rf /';
    await a._handleMessage(msg(tricky));
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    const pi = args.indexOf('-p');
    assert.ok(pi >= 0, '-p present');
    // The exact prompt content (incl. the system-context prefix) sits in ONE argv
    // element — never split or shell-interpreted.
    assert.ok(args[pi + 1].includes(tricky), 'full prompt is a single argv element');
    // No shell metacharacters leaked into separate argv slots.
    assert.ok(!args.includes('rm'), 'prompt text not split into argv tokens');
  });

  it('act mode grants least-privilege tools (=form) scoped to the working dir; never all-access; disables remote', async () => {
    const argsFile = path.join(tmp, 'args.json');
    const a = makeAdapter({ scenario: 'success', mode: 'execute', argsFile });
    await a._handleMessage(msg('do it'));
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    assert.ok(args.includes('--no-ask-user'));
    assert.ok(args.includes('--no-remote'), 'remote control disabled for privacy');
    assert.ok(args.includes('--output-format') && args[args.indexOf('--output-format') + 1] === 'json');
    assert.ok(args.includes('--add-dir') && args[args.indexOf('--add-dir') + 1] === tmp);
    // Verified tool IDs, =form (real CLI optional-value flag).
    assert.ok(args.includes('--allow-tool=shell'), 'grants shell');
    assert.ok(args.includes('--allow-tool=write'), 'grants write');
    for (const banned of ['--allow-all', '--yolo', '--allow-all-paths', '--allow-all-urls', '--allow-url', '--share', '--share-gist', '--remote']) {
      assert.ok(!args.includes(banned), `must not use ${banned} by default`);
    }
  });

  it('plan mode uses --plan and grants no write tools', async () => {
    const argsFile = path.join(tmp, 'args.json');
    const a = makeAdapter({ scenario: 'success', mode: 'plan', argsFile });
    await a._handleMessage(msg('plan it'));
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    assert.ok(args.includes('--plan'));
    assert.ok(!args.some((x) => x.startsWith('--allow-tool')), 'plan mode does not pre-authorize write/shell tools');
  });

  it('--secret-env-vars passes only variable NAMES (=form), never token values, only when present', async () => {
    // With a token in the env, the flag lists its NAME, not its value.
    const argsFile = path.join(tmp, 'args.json');
    const secret = 'github_pat_' + 'Z'.repeat(30);
    const a = makeAdapter({ scenario: 'success', argsFile, env: { COPILOT_GITHUB_TOKEN: secret } });
    await a._handleMessage(msg('hi'));
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    const sev = args.find((x) => x.startsWith('--secret-env-vars='));
    assert.ok(sev, '--secret-env-vars present when a secret var is set');
    assert.ok(sev.includes('COPILOT_GITHUB_TOKEN'), 'lists the variable NAME');
    // The actual token value must NEVER appear in argv.
    assert.ok(!args.some((x) => x.includes(secret)), 'token value never in argv');
  });

  it('--secret-env-vars is omitted when no secret env var is present', async () => {
    const argsFile = path.join(tmp, 'args.json');
    // Strip any inherited token vars for this case.
    const a = makeAdapter({
      scenario: 'success', argsFile,
      env: { COPILOT_GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_TOKEN: '', OA_WORKSPACE_TOKEN: '' },
    });
    await a._handleMessage(msg('hi'));
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    assert.ok(!args.some((x) => x.startsWith('--secret-env-vars')), 'no meaningless secret-env-vars arg');
  });

  it('passes a configured model through --model', async () => {
    const argsFile = path.join(tmp, 'args.json');
    const a = makeAdapter({ scenario: 'success', model: 'gpt-x', argsFile });
    await a._handleMessage(msg('hi'));
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf-8'));
    assert.ok(args.includes('--model') && args[args.indexOf('--model') + 1] === 'gpt-x');
  });

  it('does not log the full prompt or any token (redaction)', async () => {
    const a = makeAdapter({ scenario: 'success' });
    await a._handleMessage(msg('secret task github_pat_' + 'A'.repeat(30)));
    const allLogs = a.logs.join('\n');
    assert.ok(!allLogs.includes('github_pat_' + 'A'.repeat(30)), 'token never logged');
    assert.ok(allLogs.includes('<prompt>'), 'spawn log uses a prompt placeholder');
  });
});

describe('CopilotAdapter — _resolveExec cross-platform launch (Windows-safe)', () => {
  const nodeLike = (p) => /node(\.exe)?$/i.test(p) || p === process.execPath;

  it('routes a .js binary through node on BOTH platforms (Windows cannot spawn .js directly)', () => {
    const a = makeAdapter();
    for (const isWin of [false, true]) {
      const r = a._resolveExec(MOCK, isWin);
      assert.equal(r.length, 2, `[node, js] on ${isWin ? 'win' : 'unix'}`);
      assert.ok(nodeLike(r[0]), 'first element is node');
      assert.equal(r[1], MOCK, 'second element is the JS entry');
    }
  });

  it('REGRESSION: a .js on Windows must NOT resolve to the bare path (the spawn UNKNOWN cause)', () => {
    const a = makeAdapter();
    const r = a._resolveExec(MOCK, /* isWindows */ true);
    assert.notDeepEqual(r, [MOCK], 'bare .js would throw spawn UNKNOWN on Windows');
    assert.ok(nodeLike(r[0]));
  });

  it('resolves a real-style Windows copilot.cmd npm shim to [node, <entry>.js] (prompt-safe, no cmd.exe)', () => {
    const a = makeAdapter();
    const cmdPath = path.join(tmp, 'copilot.cmd');
    // Mirrors an npm-generated .cmd shim for @github/copilot (bin → npm-loader.js).
    fs.writeFileSync(cmdPath,
      '@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\n' +
      '"%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*\r\n');
    const r = a._resolveExec(cmdPath, /* isWindows */ true);
    assert.ok(nodeLike(r[0]), 'spawned via node, not the .cmd or cmd.exe');
    assert.notEqual(r[0].toLowerCase(), 'cmd.exe', 'must not fall back to cmd.exe string handling');
    assert.ok(r[1].endsWith('npm-loader.js'), 'resolved to the shim target JS');
    assert.ok(!r.includes(cmdPath), 'the .cmd is never spawned directly');
  });

  it('resolves a .cmd that forwards to an .exe → [exe]', () => {
    const a = makeAdapter();
    const cmdPath = path.join(tmp, 'copilot.cmd');
    fs.writeFileSync(cmdPath, 'SET dp0=%~dp0\r\n"%dp0%\\copilot-win.exe" %*\r\n');
    const r = a._resolveExec(cmdPath, true);
    assert.equal(r.length, 1);
    assert.ok(r[0].endsWith('copilot-win.exe'));
  });

  it('spawns a native .exe directly on Windows', () => {
    const a = makeAdapter();
    const r = a._resolveExec('C:\\tools\\copilot.exe', true);
    assert.deepEqual(r, ['C:\\tools\\copilot.exe']);
  });

  it('unparseable .cmd falls back to cmd.exe /c (last resort) without string concatenation', () => {
    const a = makeAdapter();
    const cmdPath = path.join(tmp, 'weird.cmd');
    fs.writeFileSync(cmdPath, '@echo nothing useful here\r\n');
    const r = a._resolveExec(cmdPath, true);
    assert.deepEqual(r, ['cmd.exe', '/c', cmdPath], 'args still pass as a literal argv array, not a concatenated string');
  });
});

describe('CopilotAdapter — registry/adapter consistency', () => {
  it('adapter MIN_VERSION matches registry.json copilot install.min_version', () => {
    const registry = require('../registry.json');
    const copilot = registry.find((e) => e.name === 'copilot');
    assert.ok(copilot, 'copilot entry exists in registry.json');
    assert.equal(copilot.install.min_version, CopilotAdapter.MIN_VERSION,
      'registry min_version must equal adapter MIN_VERSION');
    assert.equal(copilot.install.binary, 'copilot', 'detects the official binary, not gh');
    assert.equal(copilot.install.npm_package, '@github/copilot');
  });
});

describe('CopilotAdapter — version gate (pre-launch)', () => {
  it('refuses to spawn when the CLI is below the minimum version', async () => {
    const argsFile = path.join(tmp, 'args.json');
    const a = makeAdapter({ scenario: 'success', argsFile });
    a._versionGate = { version: '0.0.500', compatible: false }; // simulate too-old
    await a._handleMessage(msg('hi'));
    const err = a.sent.find((s) => s.type === 'error');
    assert.match(err.content, /too old|requires 1\.0\.0|upgrade/i);
    assert.ok(!fs.existsSync(argsFile), 'no turn was spawned (no args written)');
  });

  it('proceeds when the version is unknown (compatible=null), never falsely blocking', async () => {
    const argsFile = path.join(tmp, 'args.json');
    const a = makeAdapter({ scenario: 'success', argsFile });
    a._versionGate = { version: null, compatible: null };
    await a._handleMessage(msg('hi'));
    assert.ok(a.sent.some((s) => s.type === 'response'), 'unknown version still runs');
  });

  it('_checkVersionGate detects/compares the real CLI version output', () => {
    const orig = process.env.MOCK_COPILOT_VERSION;
    try {
      const a = makeAdapter({ scenario: 'success' });
      a._versionGate = null; process.env.MOCK_COPILOT_VERSION = '1.2.0';
      assert.equal(a._checkVersionGate().compatible, true);

      const b = makeAdapter({ scenario: 'success' });
      b._versionGate = null; process.env.MOCK_COPILOT_VERSION = '0.0.421';
      assert.equal(b._checkVersionGate().compatible, false);

      const c = makeAdapter({ scenario: 'success' });
      c._versionGate = null; process.env.MOCK_COPILOT_VERSION = 'nightly';
      assert.equal(c._checkVersionGate().compatible, null, 'unparseable → unknown, not false-pass');
    } finally {
      if (orig === undefined) delete process.env.MOCK_COPILOT_VERSION;
      else process.env.MOCK_COPILOT_VERSION = orig;
    }
  });
});

describe('CopilotAdapter — errors & resilience', () => {
  it('classifies an auth failure into an actionable message', async () => {
    const a = makeAdapter({ scenario: 'error_auth' });
    await a._handleMessage(msg('hi'));
    const err = a.sent.find((s) => s.type === 'error');
    assert.ok(err, 'an error was surfaced');
    assert.match(err.content, /sign|token|Copilot/i);
  });

  it('classifies an invalid/unvalidatable token (401 / Bad credentials)', async () => {
    const a = makeAdapter({ scenario: 'error_token' });
    await a._handleMessage(msg('hi'));
    const err = a.sent.find((s) => s.type === 'error');
    assert.match(err.content, /invalid|expired|revoked|401/i);
    // The fixed guidance mentions classic-token caveat from the real CLI.
    assert.match(err.content, /Copilot Requests|ghp_|fine-grained/i);
  });

  it('classifies an organization-policy block', async () => {
    const a = makeAdapter({ scenario: 'error_org' });
    await a._handleMessage(msg('hi'));
    const err = a.sent.find((s) => s.type === 'error');
    assert.match(err.content, /organization|enterprise|policy/i);
  });

  it('retries with a fresh session when a resume is stale', async () => {
    const a = makeAdapter({ scenario: 'stale_session' });
    a._channelSessions.general = 'old-session'; // force a --resume on attempt 0
    a._saveSessions();
    await a._handleMessage(msg('hi'));
    const responses = a.sent.filter((s) => s.type === 'response');
    assert.equal(responses.length, 1);
    assert.match(responses[0].content, /Fresh session answer/);
    assert.equal(a._channelSessions.general, 'mock-sess-fresh');
  });

  it('treats an ask_user prompt as a clear failure (workspace cannot answer)', async () => {
    const a = makeAdapter({ scenario: 'ask_user' });
    await a._handleMessage(msg('ambiguous'));
    const err = a.sent.find((s) => s.type === 'error');
    assert.match(err.content, /interactive input|specific/i);
  });

  it('surfaces an abnormal crash exit without hanging', async () => {
    const a = makeAdapter({ scenario: 'crash' });
    await a._handleMessage(msg('hi'));
    assert.ok(a.sent.some((s) => s.type === 'error'));
    assert.equal(Object.keys(a._channelProcesses).length, 0, 'process map cleaned up');
  });

  it('errors when the working directory does not exist (no silent cwd fallback)', async () => {
    const a = makeAdapter({ scenario: 'success', workingDir: path.join(tmp, 'does-not-exist') });
    await a._handleMessage(msg('hi'));
    const err = a.sent.find((s) => s.type === 'error');
    assert.match(err.content, /Working directory does not exist/);
    assert.equal(a.sent.filter((s) => s.type === 'response').length, 0);
  });

  it('errors when the binary is missing', async () => {
    const a = makeAdapter({ scenario: 'success' });
    a._copilotBin = null;
    await a._handleMessage(msg('hi'));
    const err = a.sent.find((s) => s.type === 'error');
    assert.match(err.content, /not found|install/i);
  });
});

describe('CopilotAdapter — interrupt & process-tree cleanup', () => {
  it('stops an in-flight turn, cleans up the process, and settles the UI', async () => {
    const a = makeAdapter({ scenario: 'timeout_silent' });
    const turn = a._handleMessage(msg('long task'));

    // Wait until the subprocess is registered.
    const start = Date.now();
    while (!a._channelProcesses.general && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(a._channelProcesses.general, 'process registered');

    await a._onControlAction('stop', { channel: 'general' });
    await turn;

    assert.equal(a._channelProcesses.general, undefined, 'process map cleared after stop');
    assert.ok(a.sent.some((s) => s.type === 'status' && /stopped by user/i.test(s.content)));
    // No response/error posted after an explicit user stop.
    assert.ok(!a.sent.some((s) => s.type === 'response'));
  });
});

describe('CopilotAdapter — session/working-dir binding', () => {
  it('binds the session name to the working directory (no cross-project resume)', () => {
    const a1 = makeAdapter({ scenario: 'success', workingDir: path.join(tmp, 'projA') });
    const a2 = makeAdapter({ scenario: 'success', workingDir: path.join(tmp, 'projB') });
    assert.notEqual(a1._stableSessionName('general'), a2._stableSessionName('general'),
      'different working dirs must yield different session names');
  });
});
