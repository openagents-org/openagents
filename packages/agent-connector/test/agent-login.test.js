'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isHeadless, loginArgs, loginPlan, agnLoginCommand } = require('../src/agent-login');
const BUNDLED = require('../registry.json');

const CLI = path.join(__dirname, '..', 'bin', 'agent-connector.js');
const entryOf = (name) => BUNDLED.find((e) => e.name === name);
const DESKTOP = { DISPLAY: ':0' };

describe('agent-login', () => {
  it('drops the binary from the login command', () => {
    assert.deepEqual(loginArgs('claude auth login'), ['auth', 'login']);
    assert.deepEqual(loginArgs('  codex   login '), ['login']);
    assert.deepEqual(loginArgs('gemini'), []);
  });

  it('treats SSH sessions and display-less Linux as headless', () => {
    assert.equal(isHeadless({}, 'linux'), true);
    assert.equal(isHeadless({ DISPLAY: ':0' }, 'linux'), false);
    assert.equal(isHeadless({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
    assert.equal(isHeadless({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22', DISPLAY: ':0' }, 'linux'), true);
    assert.equal(isHeadless({}, 'darwin'), false);
    assert.equal(isHeadless({}, 'win32'), false);
    assert.equal(isHeadless({ SSH_TTY: '/dev/pts/0' }, 'win32'), true);
  });

  it('runs the registry login command, with codex on device auth when headless', () => {
    assert.deepEqual(loginPlan(entryOf('codex'), { env: DESKTOP, platform: 'linux' }).args, ['login']);
    assert.deepEqual(loginPlan(entryOf('codex'), { env: {}, platform: 'linux' }).args, ['login', '--device-auth']);
    // Claude's sign-in already works from another machine (the code is pasted back).
    assert.deepEqual(loginPlan(entryOf('claude'), { env: {}, platform: 'linux' }).args, ['auth', 'login']);
    assert.equal(loginPlan(entryOf('claude'), { env: {}, platform: 'linux' }).command, 'claude auth login');
  });

  it('has no plan for an agent with no sign-in of its own', () => {
    assert.equal(loginPlan(entryOf('openclaw')), null);
    assert.equal(loginPlan({ name: 'x', check_ready: {} }), null);
    assert.equal(loginPlan(null), null);
  });

  it('names the command the workspace shows', () => {
    assert.equal(agnLoginCommand('codex'), 'agn login codex');
  });
});

describe('agn login', () => {
  const runLogin = (home, env, ...args) => {
    try {
      const stdout = execFileSync(process.execPath, [CLI, 'login', ...args, '--config', path.join(home, '.openagents')], {
        encoding: 'utf-8',
        timeout: 30000,
        env: {
          PATH: path.dirname(process.execPath),
          HOME: home,
          USERPROFILE: home,
          OPENAGENTS_SKIP_UPDATE_CHECK: '1',
          ...env,
        },
      });
      return { code: 0, stdout };
    } catch (e) {
      return { code: e.status, stdout: String(e.stdout || '') };
    }
  };

  /** A codex that records how it was called, where OpenAgents installs codex. */
  const fakeCodex = (home) => {
    const pkg = path.join(home, '.openagents', 'runtimes', 'codex', 'node_modules', '@openai', 'codex');
    const bin = path.join(home, '.openagents', 'runtimes', 'codex', 'node_modules', '.bin');
    fs.mkdirSync(pkg, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.160.0' }));
    const log = path.join(home, 'calls.log');
    const script = path.join(bin, 'codex');
    fs.writeFileSync(script, `#!/bin/sh\necho "$*" >> "${log}"\necho "fake codex $*"\nexit 0\n`);
    fs.chmodSync(script, 0o755);
    return log;
  };

  it('signs in the codex OpenAgents installed, on device auth over SSH', { skip: process.platform === 'win32' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-login-'));
    const log = fakeCodex(home);
    const r = runLogin(home, { SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' }, 'codex');
    const calls = fs.readFileSync(log, 'utf-8').trim().split('\n');
    assert.equal(calls[0], 'login --device-auth', r.stdout);
    assert.match(r.stdout, /fake codex login --device-auth/);
    assert.match(r.stdout, /open the link below on any device/);
  });

  it('accepts an agent name and signs in its type', { skip: process.platform === 'win32' }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-login-'));
    const log = fakeCodex(home);
    const cfgDir = path.join(home, '.openagents');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'daemon.yaml'), 'agents:\n  - name: my-bot\n    type: codex\n');
    runLogin(home, { DISPLAY: ':0' }, 'my-bot');
    assert.equal(fs.readFileSync(log, 'utf-8').trim().split('\n')[0], 'login');
  });

  it('says what is missing instead of running anything', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agn-login-'));
    const missing = runLogin(home, {}, 'codex');
    assert.equal(missing.code, 1);
    assert.match(missing.stdout, /not installed on this device.*agn install codex/);

    const keyOnly = runLogin(home, {}, 'openclaw');
    assert.equal(keyOnly.code, 1);
    assert.match(keyOnly.stdout, /has no sign-in of its own/);

    const unknown = runLogin(home, {}, 'nope-not-an-agent');
    assert.equal(unknown.code, 1);
    assert.match(unknown.stdout, /Unknown agent type or agent 'nope-not-an-agent'/);

    const usage = runLogin(home, {});
    assert.equal(usage.code, 1);
    assert.match(usage.stdout, /Usage: agn login/);
  });
});
