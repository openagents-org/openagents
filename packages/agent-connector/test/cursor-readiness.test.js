'use strict';

/**
 * Cursor readiness. `cursor-agent login` signs in without any API key, and the
 * registry used to recognise only CURSOR_API_KEY — so a signed-in user read
 * "installed but not signed in" in the workspace, and the re-check refused to
 * even try a run. The signed-in account is recorded under `authInfo` in
 * ~/.cursor/cli-config.json.
 *
 * That record is a profile the CLI caches, not the sign-in. The tokens are in
 * the OS keychain on macOS, %APPDATA%\Cursor\auth.json on Windows and
 * ~/.config/cursor/auth.json on Linux, and `cursor-agent status` answers from
 * those alone. So without `authInfo` the CLI is asked, and only when it does
 * not answer is the state unknown.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer, clearVersionCache, loginVerdict } = require('../src/installer');
const { setBlockingProbes } = require('../src/probe-mode');
const registry = require('../registry.json');

const mockRegistry = { getEntry: () => null, getResolveRules: () => [] };
const cursor = registry.find((a) => a.name === 'cursor');
const IS_WINDOWS = process.platform === 'win32';

let tmpDir;
let savedKey;
let savedLocalAppData;

function evaluate(configPath, binary = '/fake/cursor-agent') {
  const entry = { ...cursor, check_ready: { ...cursor.check_ready, creds_file: configPath } };
  const inst = new Installer(mockRegistry, tmpDir);
  inst.env.getEffective = () => ({});
  return inst._evaluateReadiness('cursor', entry, binary);
}

/** A stand-in cursor-agent whose every command prints `line` and exits `code`. */
function fakeCli(line, code = 0) {
  const file = path.join(tmpDir, IS_WINDOWS ? 'cursor-agent.cmd' : 'cursor-agent');
  fs.writeFileSync(
    file,
    IS_WINDOWS ? `@echo ${line}\r\n@exit /b ${code}\r\n` : `#!/bin/sh\necho "${line}"\nexit ${code}\n`,
    'utf-8',
  );
  if (!IS_WINDOWS) fs.chmodSync(file, 0o755);
  return file;
}

/** A CLI config as the CLI writes it for a user with no cached profile. */
function configWithoutAuthInfo() {
  const p = path.join(tmpDir, 'cli-config.json');
  fs.writeFileSync(p, JSON.stringify({ version: 1 }));
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cursor-'));
  savedKey = process.env.CURSOR_API_KEY;
  savedLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(tmpDir, 'AppData', 'Local');
  delete process.env.CURSOR_API_KEY;
  clearVersionCache();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = savedKey;
  if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = savedLocalAppData;
  setBlockingProbes(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Cursor readiness', () => {
  it('reads the CLI config that `cursor-agent login` writes', () => {
    assert.equal(cursor.check_ready.creds_file, '~/.cursor/cli-config.json');
    assert.equal(cursor.check_ready.creds_key, 'authInfo');
  });

  it('signed in with cursor-agent login (no API key) → Ready', () => {
    const p = path.join(tmpDir, 'cli-config.json');
    fs.writeFileSync(p, JSON.stringify({ version: 1, authInfo: { email: 'ada@example.com' } }));
    const r = evaluate(p);
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });

  it('config without authInfo → unknown, so a re-check still tries a run', () => {
    const r = evaluate(configWithoutAuthInfo());
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
  });

  it('no config at all → unknown, not a definitive "no credentials"', () => {
    const r = evaluate(path.join(tmpDir, 'missing.json'));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
  });
});

describe('Cursor readiness — asking the CLI', () => {
  it('declares the status check the desktop app already uses', () => {
    assert.deepEqual(cursor.check_ready.status_args, ['status']);
    assert.match('Not logged in', new RegExp(cursor.check_ready.logged_out_pattern, 'i'));
  });

  it('signed in, but the config has no authInfo → Ready on the CLI\'s word', () => {
    const r = evaluate(configWithoutAuthInfo(), fakeCli('Logged in as ada@example.com'));
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
    assert.equal(r.auth_status, 'ready');
  });

  it('signed in, and the config is somewhere else entirely → Ready', () => {
    // XDG_CONFIG_HOME or CURSOR_CONFIG_DIR moves cli-config.json out of ~/.cursor.
    const r = evaluate(path.join(tmpDir, 'missing.json'), fakeCli('Logged in as ada@example.com'));
    assert.equal(r.ready, true);
  });

  it('offline: the CLI still reports the sign-in it holds → Ready', () => {
    const r = evaluate(configWithoutAuthInfo(), fakeCli('Logged in (unable to fetch user details)'));
    assert.equal(r.ready, true);
  });

  it('CLI says "Not logged in" → a definitive no_credentials, not unknown', () => {
    const r = evaluate(configWithoutAuthInfo(), fakeCli('Not logged in'));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'no_credentials');
    assert.match(r.message, /cursor-agent login/);
  });

  it('half a sign-in (no refresh token) is not signed in', () => {
    const r = evaluate(configWithoutAuthInfo(), fakeCli('Partially authenticated (missing refresh token)'));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'no_credentials');
  });

  for (const line of [
    'Not signed in',
    'Not authenticated',
    'Unauthenticated: run cursor-agent login',
    'Login required',
    'You are logged out',
    'Signed out',
  ]) {
    it(`CLI says "${line}" → not signed in`, () => {
      const r = evaluate(configWithoutAuthInfo(), fakeCli(line));
      assert.equal(r.ready, false);
      assert.equal(r.auth_status, 'no_credentials');
    });
  }

  it('the status command fails → unknown, never a verdict either way', () => {
    const r = evaluate(configWithoutAuthInfo(), fakeCli('Status check error: keychain is locked', 1));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
  });

  it('authInfo on disk is enough — the CLI is not started for it', () => {
    const p = path.join(tmpDir, 'cli-config.json');
    fs.writeFileSync(p, JSON.stringify({ version: 1, authInfo: { email: 'ada@example.com' } }));
    const inst = new Installer(mockRegistry, tmpDir);
    inst.env.getEffective = () => ({});
    inst._checkLoginStatus = () => { throw new Error('the CLI must not be asked'); };
    const entry = { ...cursor, check_ready: { ...cursor.check_ready, creds_file: p } };
    assert.equal(inst._evaluateReadiness('cursor', entry, fakeCli('Not logged in')).ready, true);
  });

  it('never waits on the CLI where the caller cannot block', () => {
    // The desktop app's main thread: a 1–3s `status` would freeze the window.
    setBlockingProbes(false);
    const r = evaluate(configWithoutAuthInfo(), fakeCli('Logged in as ada@example.com'));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
  });

  it('an agent that declares no status check is never run for one', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const bin = fakeCli('Logged in as ada@example.com');
    assert.equal(inst._checkLoginStatus({ logged_out_pattern: 'not logged in' }, bin), null);
    assert.equal(inst._checkLoginStatus({ status_args: ['status'] }, bin), null);
    assert.equal(
      inst._checkLoginStatus({ status_args: ['status; rm -rf /'], logged_out_pattern: 'x' }, bin),
      null,
    );
  });
});

describe('Cursor readiness — how the status check is started', () => {
  /** _spawnLoginStatus as it runs on `platform`, recording each spawnSync call. */
  function spawnAs(platform, binary, env = {}) {
    const calls = [];
    const inst = new Installer(mockRegistry, tmpDir);
    inst._spawnSyncForTest = (...a) => { calls.push(a); return { status: 0, stdout: 'Not logged in', stderr: '' }; };
    const saved = Object.getOwnPropertyDescriptor(process, 'platform');
    const savedLocal = process.env.LOCALAPPDATA;
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    if (env.LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = env.LOCALAPPDATA;
    try {
      inst._spawnLoginStatus(binary, ['status'], `"${binary}" status`);
    } finally {
      Object.defineProperty(process, 'platform', saved);
      if (savedLocal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = savedLocal;
    }
    return calls;
  }

  it('Windows: starts Cursor\'s node.exe on index.js, no shell, window hidden', () => {
    const version = path.join(tmpDir, 'versions', '2026.10.01-e373342');
    fs.mkdirSync(version, { recursive: true });
    fs.writeFileSync(path.join(version, 'node.exe'), '');
    fs.writeFileSync(path.join(version, 'index.js'), '');
    const bin = path.join(tmpDir, 'cursor-agent.cmd');
    fs.writeFileSync(bin, '@echo off\r\n');
    const [call, ...rest] = spawnAs('win32', bin);
    assert.equal(rest.length, 0);
    assert.equal(call[0], path.join(version, 'node.exe'));
    assert.deepEqual(call[1], [path.join(version, 'index.js'), 'status']);
    assert.equal(call[2].shell, false);
    assert.equal(call[2].windowsHide, true);
    assert.equal(call[2].env.CURSOR_INVOKED_AS, 'cursor-agent.cmd');
  });

  it('Windows: a launcher with no node.exe to find keeps today\'s command line', () => {
    const bin = path.join(tmpDir, 'cursor-agent.cmd');
    fs.writeFileSync(bin, '@echo off\r\n');
    const [call] = spawnAs('win32', bin);
    assert.equal(call[0], `"${bin}" status`);
    assert.equal(call[1].shell, true);
  });

  it('Windows: preserves the bundled node status path for the supported agent.cmd alias', () => {
    const version = path.join(tmpDir, 'versions', '2026.10.01-e373342');
    fs.mkdirSync(version, { recursive: true });
    fs.writeFileSync(path.join(version, 'node.exe'), '');
    fs.writeFileSync(path.join(version, 'index.js'), '');
    const [call] = spawnAs('win32', path.join(tmpDir, 'agent.cmd'));
    assert.equal(call[0], path.join(version, 'node.exe'));
    assert.deepEqual(call[1], [path.join(version, 'index.js'), 'status']);
    assert.equal(call[2].env.CURSOR_INVOKED_AS, 'agent.cmd');
  });

  it('Windows: Hermes status must not run the installed Cursor instead', () => {
    const version = path.join(tmpDir, 'cursor-agent', 'versions', '2026.10.01-e373342');
    fs.mkdirSync(version, { recursive: true });
    fs.writeFileSync(path.join(version, 'node.exe'), '');
    fs.writeFileSync(path.join(version, 'index.js'), '');
    const bin = path.join(tmpDir, 'hermes.exe');
    const [call] = spawnAs('win32', bin, { LOCALAPPDATA: tmpDir });
    assert.equal(call[0], `"${bin}" status`);
    assert.equal(call[1].shell, true);
    assert.equal(call[1].env.PYTHONUNBUFFERED, '1');
  });

  it('elsewhere: runs the binary with its args, no shell', () => {
    const bin = fakeCli('Not logged in');
    const [call] = spawnAs('linux', bin);
    assert.equal(call[0], bin);
    assert.deepEqual(call[1], ['status']);
    assert.equal(call[2].shell, false);
  });
});

describe('Hermes readiness — status times out after reporting credentials', () => {
  function timedOutStatus(stdout, code = 'ETIMEDOUT') {
    const inst = new Installer(mockRegistry, tmpDir);
    inst._spawnLoginStatus = () => ({
      stdout,
      stderr: '',
      status: null,
      error: Object.assign(new Error('status did not exit'), { code }),
    });
    const spec = registry.find((entry) => entry.name === 'hermes').check_ready;
    return inst._checkLoginStatus(spec, '/fake/hermes.exe');
  }

  it('retains explicit login evidence when unrelated diagnostics time out', () => {
    assert.equal(timedOutStatus('OpenAI Codex  \x1b[32m✓\x1b[0m logged in\n◆ Terminal Backend\n'), true);
  });

  it('an incomplete signed-out report remains unknown', () => {
    assert.equal(timedOutStatus('Nous Portal  ✗ not logged in\n'), null);
  });

  it('does not accept output from an unrelated spawn failure', () => {
    assert.equal(timedOutStatus('OpenAI Codex  ✓ logged in\n', 'EACCES'), null);
  });

  it('keeps the summary Providers row printed before a slow gateway check', () => {
    assert.equal(timedOutStatus('  Provider:     Anthropic\n  Providers:    Anthropic\n'), true);
  });

  it('an incomplete summary without a provider remains unknown', () => {
    assert.equal(timedOutStatus('  Provider:     Auto\n  Providers:    none connected\n'), null);
  });
});

// `hermes status` since Hermes 2026-10 (upstream a3149156e) is a summary; the
// sections the patterns above read need --full. Layout from hermes_cli/status.py.
function hermesSummary(providers, eol = '\n') {
  return [
    '',
    '  Model:        claude-sonnet-4-6',
    '  Provider:     Anthropic',
    `  Providers:    ${providers}`,
    '  Gateway:      stopped',
    '  Platforms:    none configured',
    '  Jobs:         none',
    "  Run 'hermes status --full' for every section",
    '',
  ].join(eol);
}

describe('Hermes readiness — the default summary', () => {
  const spec = () => require('../registry.json').find((entry) => entry.name === 'hermes').check_ready;

  it('a provider with credentials is a sign-in, none connected is not', () => {
    assert.equal(loginVerdict(spec(), hermesSummary('Anthropic, OpenAI Codex'), 0), true);
    assert.equal(loginVerdict(spec(), hermesSummary('Nous Portal', '\r\n'), 0), true);
    assert.equal(loginVerdict(spec(), hermesSummary('none connected'), 0), false);
    assert.equal(loginVerdict(spec(), hermesSummary('none connected', '\r\n'), 0), false);
  });

  it("OpenAgents' own per-agent providers are not a sign-in", () => {
    assert.equal(loginVerdict(spec(), hermesSummary('openagents-hermes1'), 0), false);
    assert.equal(loginVerdict(spec(), hermesSummary('openagents-a, openagents-hermes-1-1a2b3c'), 0), false);
    assert.equal(loginVerdict(spec(), hermesSummary('openagents-a, Nous Portal'), 0), true);
  });

  it('leans to ready when Hermes could not list its providers', () => {
    assert.equal(loginVerdict(spec(), hermesSummary('unknown'), 0), true);
  });

  it('stays fast on a very long Providers row', () => {
    const started = Date.now();
    const row = `${'openagents-x, '.repeat(5000)}none connected`;
    assert.equal(loginVerdict(spec(), hermesSummary(row), 0), false);
    assert.ok(Date.now() - started < 1000);
  });
});

describe('loginVerdict', () => {
  const signedOut = { logged_out_pattern: 'not logged in|logged out' };
  const signedIn = { logged_in_pattern: 'logged in as' };

  it('recognises the registry Hermes OAuth status with ANSI colors', () => {
    const spec = require('../registry.json').find((entry) => entry.name === 'hermes').check_ready;
    assert.equal(loginVerdict(spec, 'Nous Portal  ✗ not logged in\nOpenAI Codex  \x1b[32m✓\x1b[0m logged in', 0), true);
    assert.equal(loginVerdict(spec, 'OpenAI Codex  \x1b[31m✗\x1b[0m not logged in', 0), false);
  });

  it('recognises Hermes Anthropic credentials without a Nous or Codex login', () => {
    const spec = require('../registry.json').find((entry) => entry.name === 'hermes').check_ready;
    assert.equal(loginVerdict(spec, '  Anthropic     \x1b[32m✓\x1b[0m sk-ant-...test\n  Nous Portal   ✗ not logged in\n  OpenAI Codex  ✗ not logged in', 0), true);
    assert.equal(loginVerdict(spec, '  Anthropic     ✗ (not set)\n  Nous Portal   ✗ not logged in', 0), false);
    assert.equal(loginVerdict(spec, '  GitHub        ✓ ghp-...test\n  Anthropic     ✗ (not set)', 0), false);
  });

  it('a signed-out pattern: match → false, clean run without it → true', () => {
    assert.equal(loginVerdict(signedOut, 'Not logged in\n', 0), false);
    assert.equal(loginVerdict(signedOut, 'Logged in as ada@example.com\n', 0), true);
  });

  it('a signed-in pattern: match → true, clean run without it → false', () => {
    assert.equal(loginVerdict(signedIn, 'Logged in as ada@example.com\n', 0), true);
    assert.equal(loginVerdict(signedIn, 'no account\n', 0), false);
  });

  it('no output, or a failed run that matched nothing → null', () => {
    assert.equal(loginVerdict(signedOut, '', 0), null);
    assert.equal(loginVerdict(signedOut, 'command not found', 127), null);
    assert.equal(loginVerdict(signedOut, 'boom', null), null);
  });

  it('a match counts even when the CLI exits non-zero', () => {
    assert.equal(loginVerdict(signedOut, 'Not logged in', 1), false);
  });

  it('no pattern, or one that does not compile → null', () => {
    assert.equal(loginVerdict({}, 'Logged in', 0), null);
    assert.equal(loginVerdict({ logged_out_pattern: '(' }, 'Logged in', 0), null);
  });
});
