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
  delete process.env.CURSOR_API_KEY;
  clearVersionCache();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = savedKey;
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

describe('loginVerdict', () => {
  const signedOut = { logged_out_pattern: 'not logged in|logged out' };
  const signedIn = { logged_in_pattern: 'logged in as' };

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
