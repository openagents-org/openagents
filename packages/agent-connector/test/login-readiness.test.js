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
  'AI_GATEWAY_API_KEY', 'V0_API_KEY',
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

function evaluate(type, binary = null, savedEnv = {}) {
  const entry = registry.find((a) => a.name === type);
  const inst = new Installer({ getEntry: () => null, getResolveRules: () => [] }, tmpDir);
  inst.env.getEffective = () => ({ ...savedEnv });
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

// What `claude auth login` writes (Claude Code 2.1.304), minus real values.
const CLAUDE_OAUTH = {
  claudeAiOauth: {
    accessToken: 'at', refreshToken: 'rt', expiresAt: 4102444800000,
    scopes: ['user:inference', 'user:profile'], subscriptionType: 'pro',
  },
};

describe('claude', () => {
  it('reads its sign-in from ~/.claude/.credentials.json, whether or not a session is running', () => {
    homeFile('.claude/.credentials.json', CLAUDE_OAUTH);
    fs.mkdirSync(path.join(tmpDir, '.claude', 'sessions'), { recursive: true }); // idle: no sessions
    const r = evaluate('claude');
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'cli_login');
  });

  // Both make the real CLI (2.1.304, isolated CLAUDE_CONFIG_DIR) print
  // "loggedIn": false and exit 1. A file that merely parses is no sign-in: it
  // must not answer Ready and skip asking the CLI.
  const SIGNED_OUT_FILES = {
    'an empty object': {},
    'a null OAuth entry': { claudeAiOauth: null },
  };
  for (const [label, body] of Object.entries(SIGNED_OUT_FILES)) {
    it(`does not take ${label} in .credentials.json for a sign-in`, () => {
      homeFile('.claude/.credentials.json', body);
      const r = evaluate('claude');
      assert.equal(r.ready, false);
      assert.equal(r.auth_status, 'no_credentials');
    });

    it(`asks \`claude auth status\` past ${label}, and goes by its answer`, () => {
      homeFile('.claude/.credentials.json', body);
      const out = evaluate('claude', fakeCli('claude', '{ "loggedIn": false, "authMethod": "none" }', 1));
      assert.equal(out.ready, false);
      assert.equal(out.auth_status, 'no_credentials');
      // A sign-in the file does not show (Keychain, Credential Manager) still counts.
      const elsewhere = evaluate('claude', fakeCli('claude', '{ "loggedIn": true, "authMethod": "claude.ai" }'));
      assert.equal(elsewhere.ready, true);
      assert.equal(elsewhere.auth_mode, 'cli_login');
    });
  }

  // The Keychain item's presence is the signal: its secret is never read
  // (#842), so what it holds is not judged. A stand-in `security` finds it.
  for (const [label, body, ready] of [
    ['a full sign-in', CLAUDE_OAUTH, true],
  ]) {
    it(`counts ${label} in the macOS Keychain`, { skip: IS_WINDOWS }, () => {
      const dir = fs.mkdtempSync(path.join(tmpDir, 'keychain-'));
      fs.writeFileSync(path.join(dir, 'security'), `#!/bin/sh\necho '${JSON.stringify(body)}'\n`, 'utf-8');
      fs.chmodSync(path.join(dir, 'security'), 0o755);
      const entry = registry.find((a) => a.name === 'claude');
      const inst = new Installer({ getEntry: () => null, getResolveRules: () => [] }, tmpDir);
      const prevPath = process.env.PATH;
      process.env.PATH = `${dir}${path.delimiter}${prevPath}`;
      try {
        const cr = entry.check_ready;
        assert.equal(inst._checkMacKeychain(cr.keychain_service, cr.creds_key), ready);
      } finally {
        process.env.PATH = prevPath;
      }
    });
  }

  it('is ready on an API key without reading any sign-in', () => {
    homeFile('.claude/.credentials.json', {});
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const r = evaluate('claude', fakeCli('claude', '{ "loggedIn": false }', 1));
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'api_key');
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
    const r = evaluate('cline');
    assert.equal(r.ready, true);
    assert.equal(r.auth_status, 'ready');
  });

  it('does not take a provider with a model and no key for a credential', () => {
    homeFile('.cline/data/settings/providers.json', {
      lastUsedProvider: 'openrouter',
      providers: { openrouter: { settings: { model: 'anthropic/claude-sonnet-4.5' } } },
    });
    const r = evaluate('cline');
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'no_credentials');
  });

  it('cannot tell for a Cline account sign-in, and says unknown rather than signed out', () => {
    homeFile('.cline/data/settings/providers.json', {
      lastUsedProvider: 'cline',
      providers: { cline: { settings: { model: 'anthropic/claude-sonnet-4.5' } } },
    });
    const r = evaluate('cline');
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'unknown');
  });

  it('says unknown for a file it cannot make out', () => {
    homeFile('.cline/data/settings/providers.json', '{ not json');
    assert.equal(evaluate('cline').auth_status, 'unknown');
    homeFile('.cline/data/settings/providers.json', { version: 2 });
    assert.equal(evaluate('cline').auth_status, 'unknown');
  });

  it('has nothing to go on with no providers file', () => {
    const r = evaluate('cline');
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'no_credentials');
  });

  it('no longer lets the smoke test pass a provider with no key', async () => {
    const { probeAgentType, CODE } = require('../src/probe');
    homeFile('.cline/data/settings/providers.json', {
      lastUsedProvider: 'openrouter',
      providers: { openrouter: { settings: { model: 'anthropic/claude-sonnet-4.5' } } },
    });
    const entry = registry.find((a) => a.name === 'cline');
    const connector = {
      registry: { getEntry: (t) => (t === 'cline' ? entry : null) },
      healthCheck: () => ({ installed: true, binary: null, ...evaluate('cline') }),
      getAgentEnv: () => ({}),
      resolveAgentEnv: () => ({}),
    };
    const r = await probeAgentType(connector, 'cline', { agentEnv: {} });
    assert.equal(r.ok, false);
    assert.equal(r.code, CODE.NOT_READY);
  });

  // The adapter takes these two as well (CLINE_AUTH_ENV_VARS), and the health
  // check, which leaves keys in the environment to env_vars, did not list
  // them: an agent the adapter would run read no_credentials, and the smoke
  // test stopped before trying it.
  for (const key of ['AI_GATEWAY_API_KEY', 'V0_API_KEY']) {
    for (const where of ['the environment', 'its saved settings']) {
      it(`is ready on ${key} in ${where}`, () => {
        homeFile('.cline/data/settings/providers.json', {
          lastUsedProvider: 'openrouter',
          providers: { openrouter: { settings: { model: 'x' } } },
        });
        if (where === 'the environment') process.env[key] = 'k-test';
        const r = evaluate('cline', null, where === 'the environment' ? {} : { [key]: 'k-test' });
        assert.equal(r.ready, true);
        assert.equal(r.auth_mode, 'api_key');
      });
    }
  }

  it('lists every key the adapter takes', () => {
    const { CLINE_AUTH_ENV_VARS } = require('../src/adapters/cline-stream');
    const listed = registry.find((a) => a.name === 'cline').check_ready.env_vars;
    assert.deepEqual(CLINE_AUTH_ENV_VARS.filter((k) => !listed.includes(k)), []);
  });

  it('is ready on an API key, whatever the providers file says', () => {
    homeFile('.cline/data/settings/providers.json', {
      lastUsedProvider: 'openrouter',
      providers: { openrouter: { settings: { model: 'x' } } },
    });
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const r = evaluate('cline');
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'api_key');
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

  // Existing behaviour, kept: output that matches neither pattern is no
  // answer, and Command Code is not `unverifiable`, so no answer reads as
  // no_credentials. It is not reported as unknown.
  it('does not count an unreachable account service as a sign-in', () => {
    const r = evaluate('commandcode', fakeCli('command-code', 'Status check failed: connection error', 1));
    assert.equal(r.ready, false);
    assert.notEqual(r.auth_mode, 'cli_login');
    assert.equal(r.auth_status, 'no_credentials');
  });
});
