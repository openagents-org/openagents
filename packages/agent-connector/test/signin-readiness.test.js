'use strict';

/**
 * Sign-in detection for the agents whose smoke test said "not logged in" /
 * "not configured" to users who were. Runs the REAL registry check_ready
 * entries against a fake home directory, so a registry edit that breaks
 * detection fails here. No CLI is run (no binary is passed, so no status
 * command), no credential is read out.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer } = require('../src/installer');
const { Registry } = require('../src/registry');

const KEY_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'LOCALAPPDATA',
];

let home;
let cacheDir;
let savedVars;

function write(rel, content) {
  const p = path.join(home, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function evaluate(type, { savedEnv = {}, cliLogin = false } = {}) {
  const entry = new Registry(cacheDir).getEntry(type);
  const inst = new Installer({ getEntry: () => entry, getResolveRules: () => [] }, cacheDir);
  inst._homeForAgent = () => home;
  inst.env.getEffective = () => savedEnv;
  inst.env.getForAgent = () => savedEnv;
  return inst._evaluateReadiness(type, entry, null, cliLogin ? { cliLogin: true, agentEnv: {} } : {});
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-signin-home-'));
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-signin-cache-'));
  savedVars = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));
  for (const k of KEY_VARS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedVars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe('Claude Code', () => {
  it('a claude.ai sign-in in .credentials.json is ready', () => {
    write('.claude/.credentials.json', JSON.stringify({ claudeAiOauth: { accessToken: 'x' } }));
    const r = evaluate('claude');
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });

  it('a credentials file holding only MCP tokens is not a sign-in', () => {
    write('.claude/.credentials.json', JSON.stringify({ mcpOAuth: { a: {} } }));
    assert.equal(evaluate('claude').ready, false);
  });

  it('running-session files are not a sign-in', () => {
    // ~/.claude/sessions holds one file per running claude process. It used
    // to be the sign-in signal: signed-in users with no claude open read "Not
    // logged in", and anyone with a stray pid file read "Ready".
    write('.claude/sessions/1234.json', JSON.stringify({ pid: 1234, sessionId: 's' }));
    assert.equal(evaluate('claude').ready, false);
  });
});

describe('Kimi Code', () => {
  it('`kimi login` is recognised, also for an agent on the sign-in tab', () => {
    write('.kimi-code/credentials/kimi-code.json', JSON.stringify({ refresh_token: 'r' }));
    assert.equal(evaluate('kimi').ready, true);
    assert.equal(evaluate('kimi', { cliLogin: true }).ready, true);
  });

  it('a session file without a refresh token is not signed in', () => {
    write('.kimi-code/credentials/kimi-code.json', JSON.stringify({ access_token: 'a' }));
    assert.equal(evaluate('kimi').ready, false);
  });
});

describe('OpenCode', () => {
  it('a provider saved by `opencode auth login` is ready', () => {
    write('.local/share/opencode/auth.json', JSON.stringify({ deepseek: { type: 'api', key: 'k' } }));
    assert.equal(evaluate('opencode').ready, true);
  });

  it('an empty auth store is not', () => {
    write('.local/share/opencode/auth.json', '{}');
    assert.equal(evaluate('opencode').ready, false);
  });

  it('a free OpenCode Zen model needs nothing', () => {
    const r = evaluate('opencode', { savedEnv: { LLM_MODEL: 'opencode/gpt-5.6-sol' } });
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, null);
  });

  it('another provider\'s model still needs its key', () => {
    assert.equal(evaluate('opencode', { savedEnv: { LLM_MODEL: 'anthropic/claude-sonnet-4.6' } }).ready, false);
  });

  it('no longer tells the user to "press e"', () => {
    assert.doesNotMatch(evaluate('opencode').message, /press e/);
  });
});

describe('Hermes', () => {
  it('finds config.yaml under %LOCALAPPDATA%\\hermes on Windows', { skip: process.platform !== 'win32' }, () => {
    process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
    write('AppData/Local/hermes/config.yaml', 'model: x\n');
    assert.equal(evaluate('hermes').ready, true);
  });

  it('finds ~/.hermes/config.yaml elsewhere', { skip: process.platform === 'win32' }, () => {
    write('.hermes/config.yaml', 'model: x\n');
    assert.equal(evaluate('hermes').ready, true);
  });
});

describe('Codex', () => {
  it('a ChatGPT sign-in in ~/.codex/auth.json is ready', () => {
    write('.codex/auth.json', JSON.stringify({ tokens: { id_token: 'x' } }));
    const r = evaluate('codex');
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });
});

describe('version gate', () => {
  it('treats a 0.0.0 placeholder version as unknown, not too old', () => {
    const inst = new Installer({ getEntry: () => null, getResolveRules: () => [] }, cacheDir);
    const gate = inst._evaluateCompatibility({ name: 'pi', install: { min_version: '0.83.0' } }, '0.0.0');
    assert.equal(gate.compatible, null);
    assert.equal(inst._evaluateCompatibility({ name: 'pi', install: { min_version: '0.83.0' } }, '0.82.0').compatible, false);
  });
});
