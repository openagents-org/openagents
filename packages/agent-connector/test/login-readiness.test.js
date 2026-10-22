'use strict';

/**
 * Readiness for agents signed in through their own CLI, with no API key.
 *
 * The launcher's desktop checks (packages/launcher auth-specs.ts) find these
 * sign-ins; the registry's check_ready, which the workspace health check and
 * smoke test go by, did not. A signed-in agent then read "Not logged in", and
 * the smoke test stopped there without trying a run. Claude was the sharpest
 * case: its check looked at ~/.claude/sessions, the sessions of claude
 * processes running right now, so it passed while one ran and failed once the
 * agent sat idle.
 *
 * These run the registry's own entries against a fake home and fake CLIs.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer, clearVersionCache } = require('../src/installer');
const { setBlockingProbes } = require('../src/probe-mode');
const registry = require('../registry.json');

const IS_WINDOWS = process.platform === 'win32';
const KEY_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY',
  'CLINE_API_KEY', 'OPENROUTER_API_KEY', 'COMMAND_CODE_API_KEY', 'AMP_API_KEY',
];

let tmpDir;
let saved;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-login-'));
  saved = {};
  for (const k of ['HOME', 'USERPROFILE', ...KEY_VARS]) saved[k] = process.env[k];
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  for (const k of KEY_VARS) delete process.env[k];
  clearVersionCache();
  setBlockingProbes(true);
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setBlockingProbes(null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function evaluate(type, binary = null) {
  const entry = registry.find((a) => a.name === type);
  const inst = new Installer({ getEntry: () => null, getResolveRules: () => [] }, tmpDir);
  inst.env.getEffective = () => ({});
  inst._whichBinary = () => binary;
  return inst._evaluateReadiness(type, entry, binary);
}

/** A file under the fake home. */
function homeFile(rel, content) {
  const p = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
}

/** A stand-in CLI whose every command prints `text` and exits `code`. */
function fakeCli(name, text, code = 0) {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'bin-'));
  const file = path.join(dir, IS_WINDOWS ? `${name}.cmd` : name);
  fs.writeFileSync(
    file,
    IS_WINDOWS ? `@echo ${text}\r\n@exit /b ${code}\r\n` : `#!/bin/sh\necho '${text}'\nexit ${code}\n`,
    'utf-8',
  );
  if (!IS_WINDOWS) fs.chmodSync(file, 0o755);
  return file;
}

describe('claude', () => {
  it('reads its sign-in from ~/.claude/.credentials.json, whether or not a session is running', () => {
    homeFile('.claude/.credentials.json', { claudeAiOauth: { subscriptionType: 'pro' } });
    fs.mkdirSync(path.join(tmpDir, '.claude', 'sessions'), { recursive: true }); // idle: no sessions
    const r = evaluate('claude');
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });

  it('asks `claude auth status` when no credentials file says so', () => {
    const signedIn = fakeCli('claude', '{ "loggedIn": true, "authMethod": "claude.ai" }');
    assert.equal(evaluate('claude', signedIn).ready, true);
    const signedOut = fakeCli('claude', '{ "loggedIn": false, "authMethod": "none" }', 1);
    const r = evaluate('claude', signedOut);
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'no_credentials');
  });
});

describe('kimi', () => {
  it('reads the `kimi login` account file', () => {
    homeFile('.kimi-code/credentials/kimi-code.json', { refresh_token: 'rt' });
    assert.equal(evaluate('kimi').ready, true);
  });

  it('does not count a file with no refresh token', () => {
    homeFile('.kimi-code/credentials/kimi-code.json', { refresh_token: '' });
    assert.equal(evaluate('kimi').ready, false);
  });
});

describe('opencode', () => {
  it('reads the providers OpenCode signed in to', () => {
    homeFile('.local/share/opencode/auth.json', { anthropic: { type: 'oauth' } });
    assert.equal(evaluate('opencode').ready, true);
  });

  it('does not count an empty store', () => {
    homeFile('.local/share/opencode/auth.json', {});
    assert.equal(evaluate('opencode').ready, false);
  });
});

describe('cline', () => {
  it('reads the providers `cline auth` saved', () => {
    homeFile('.cline/data/settings/providers.json', { providers: { anthropic: { settings: { apiKey: 'k' } } } });
    assert.equal(evaluate('cline').ready, true);
  });
});

describe('amp', () => {
  it('asks `amp usage`, which fails signed out', () => {
    assert.equal(evaluate('amp', fakeCli('amp', 'Amp Free: 10 credits left')).ready, true);
    assert.equal(evaluate('amp', fakeCli('amp', 'Error: Invalid or missing API key. Run amp login.', 1)).ready, false);
  });
});

describe('commandcode', () => {
  it('asks `command-code status`', () => {
    assert.equal(evaluate('commandcode', fakeCli('command-code', 'Authenticated as quan')).ready, true);
    assert.equal(evaluate('commandcode', fakeCli('command-code', 'Not authenticated. Run cmd auth login to authenticate.', 1)).ready, false);
  });

  it('stays unknown when its account service cannot be reached', () => {
    const r = evaluate('commandcode', fakeCli('command-code', 'Status check failed: connection error', 1));
    assert.equal(r.ready, false);
    assert.notEqual(r.auth_mode, 'cli_login');
  });
});
