'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BrowserLogin, BROWSER_LOGIN_TYPES, loginDetails, loginMethods } = require('../src/browser-login');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function setup(verify = async () => true) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter(); proc.input = '';
  proc.stdin.write = input => { proc.input += input; };
  proc.kill = () => { proc.killed = true; };
  let spawnArgs;
  const manager = new BrowserLogin({ verify, spawnProcess: (...args) => { spawnArgs = args; return proc; } });
  return { proc, manager, args: () => spawnArgs };
}

it('relays only provider sign-in URLs and device codes, never arbitrary output', () => {
  assert.equal(loginDetails('claude', 'https://evil.example/oauth/authorize?x=1').url, undefined);
  assert.equal(loginDetails('claude', 'https://claude.ai.evil.example/oauth/authorize').url, undefined);
  assert.equal(loginDetails('codex', 'https://auth.openai.com/codex/device\nABCD-EFGH').code, 'ABCD-EFGH');
  const { manager, proc, args } = setup();
  try {
    const session = manager.start('owner', 'claude', '/some path/claude', { ANTHROPIC_API_KEY: 'secret' }, 'linux');
    assert.equal(args()[0], 'script');
    assert.equal(args()[2].env.ANTHROPIC_API_KEY, undefined);
    proc.stdout.emit('data', 'diagnostic secret\nhttps://claude.ai/oauth/authorize?state=one');
    const status = manager.read('owner', session.sessionId);
    assert.equal(status.status, 'waiting');
    assert.equal(status.url, 'https://claude.ai/oauth/authorize?state=one');
    assert.equal(JSON.stringify(status).includes('secret'), false);
    assert.throws(() => manager.read('another-workspace', session.sessionId));
    assert.throws(() => manager.input('another-workspace', session.sessionId, 'code'));
    manager.input('owner', session.sessionId, 'authorization#state');
    assert.equal(proc.input, 'authorization#state\r');
    assert.throws(() => manager.input('owner', session.sessionId, 'replay'));
  } finally { manager.close(); }
});

it('verifies native sign-in before reporting success and clears the URL', async () => {
  for (const verified of [true, false]) {
    const { manager, proc } = setup(async () => verified);
    const session = manager.start('owner', 'codex', '/bin/codex', {}, 'linux');
    proc.stdout.emit('data', 'https://auth.openai.com/codex/device\nABCD-EFGH');
    proc.emit('exit', 0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.read('owner', session.sessionId).status, verified ? 'done' : 'failed');
    assert.equal(manager.read('owner', session.sessionId).url, undefined);
    manager.close();
  }
});

it('cancels processes, rejects control input and does not report late success', async () => {
  let resolveVerify;
  const { manager, proc } = setup(() => new Promise(resolve => { resolveVerify = resolve; }));
  const session = manager.start('owner', 'claude', '/bin/claude', {}, 'darwin');
  proc.stdout.emit('data', 'https://claude.ai/oauth/authorize?x=1');
  assert.throws(() => manager.input('owner', session.sessionId, 'code\ncommand'));
  proc.emit('exit', 0);
  manager.cancel('owner', session.sessionId);
  resolveVerify(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.read('owner', session.sessionId).status, 'cancelled');
  assert.equal(proc.killed, true);
  assert.throws(() => manager.start('owner', 'other', '/bin/other', {}, 'linux'));
  assert.throws(() => manager.start('owner', 'claude', '/bin/claude', {}, 'win32'));
  manager.close();
});

it('runs the sign-in bridge through a real pseudo-terminal', { skip: !['linux', 'darwin'].includes(process.platform), timeout: 8000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-browser-login-'));
  const binary = path.join(dir, 'fake claude');
  fs.writeFileSync(binary, '#!/bin/sh\nprintf "https://claude.ai/oauth/authorize?state=test\\n"\nIFS= read -r code\n[ "$code" = "code#state" ]\n', { mode: 0o700 });
  const manager = new BrowserLogin({ verify: async () => true });
  try {
    const session = manager.start('owner', 'claude', binary, process.env);
    const until = async expected => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const current = manager.read('owner', session.sessionId);
        if (current.status === expected) return;
        assert.notEqual(current.status, 'failed');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.fail(`Sign-in did not reach ${expected}`);
    };
    await until('waiting');
    manager.input('owner', session.sessionId, 'code#state');
    await until('done');
  } finally { manager.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

it('relays Cursor and OpenCode sign-ins with the exact login each CLI needs', () => {
  assert.deepEqual(BROWSER_LOGIN_TYPES, ['claude', 'codex', 'cursor', 'opencode']);
  assert.deepEqual(loginMethods('opencode'), ['chatgpt', 'copilot']);
  assert.deepEqual(loginMethods('deepseek'), []);
  // Captured from cursor-agent 2026.11.22: a link only, the CLI polls by itself.
  const cursorOut = 'Open a browser and navigate to this link: https://cursor.com/loginDeepControl?challenge=abc&uuid=1&mode=login&redirectTarget=cli\r\n';
  assert.deepEqual(loginDetails('cursor', cursorOut), { url: 'https://cursor.com/loginDeepControl?challenge=abc&uuid=1&mode=login&redirectTarget=cli', code: undefined });
  assert.equal(loginDetails('cursor', 'https://cursor.com.evil.example/loginDeepControl?x').url, undefined);
  assert.equal(loginDetails('cursor', 'https://cursor.com/settings').url, undefined);
  // Captured from opencode 1.17.11/1.19.6 (clack prompts with box drawing).
  assert.deepEqual(loginDetails('opencode', '●  Go to: https://auth.openai.com/codex/device\n│\n●  Enter code: X51S-2VSP5\n', 'chatgpt'),
    { url: 'https://auth.openai.com/codex/device', code: 'X51S-2VSP5' });
  assert.deepEqual(loginDetails('opencode', '●  Go to: https://github.com/login/device\n│\n●  Enter code: EA15-212B\n', 'copilot'),
    { url: 'https://github.com/login/device', code: 'EA15-212B' });
  // A ChatGPT sign-in never accepts the Copilot page, and vice versa.
  assert.equal(loginDetails('opencode', 'https://github.com/login/device', 'chatgpt').url, undefined);
  assert.equal(loginDetails('opencode', 'https://auth.openai.com/codex/device', 'copilot').url, undefined);

  const { manager, proc, args } = setup();
  try {
    manager.start('owner', 'cursor', '/bin/cursor-agent', {}, 'linux');
    assert.match(args()[1][3], /'\/bin\/cursor-agent' 'login'$/);
    const s = manager.start('owner', 'opencode', '/bin/opencode', {}, 'linux', 'copilot');
    assert.match(args()[1][3], /'\/bin\/opencode' 'auth' 'login' '-p' 'github-copilot'$/);
    assert.equal(manager.read('owner', s.sessionId).method, 'copilot');
    // The deployment-type menu comes first: pick GitHub.com once, then the link.
    proc.stdout.emit('data', '◆  Select GitHub deployment type\n│  ● GitHub.com (Public)\n');
    proc.stdout.emit('data', '◆  Select GitHub deployment type\n');
    assert.equal(proc.input, '\r');
    proc.stdout.emit('data', '●  Go to: https://github.com/login/device\n●  Enter code: EA15-212B\n');
    assert.deepEqual({ ...manager.read('owner', s.sessionId), sessionId: 0, expiresAt: 0 },
      { sessionId: 0, type: 'opencode', method: 'copilot', status: 'waiting', url: 'https://github.com/login/device', code: 'EA15-212B', expiresAt: 0 });
    // Only Claude reads a pasted code.
    assert.throws(() => manager.input('owner', s.sessionId, 'code'));
    manager.start('owner', 'opencode', '/bin/opencode', {}, 'linux', 'chatgpt');
    assert.match(args()[1][3], /'-p' 'openai' '-m' 'ChatGPT Pro\/Plus \(headless\)'$/);
    assert.throws(() => manager.start('owner', 'deepseek', '/bin/dsh', {}, 'linux'), /not supported/);
    assert.throws(() => manager.start('owner', 'cursor', '/bin/cursor-agent', {}, 'win32'), /not supported/);
  } finally { manager.close(); }
});
