'use strict';

/**
 * Gemini credential/readiness detection (the "logged in via OAuth but UI shows
 * Not logged in" fix). Verifies the installer detects ALL of Gemini CLI's auth
 * paths — OAuth credential file, GEMINI_API_KEY / GOOGLE_API_KEY, and a
 * GOOGLE_APPLICATION_CREDENTIALS service-account file — without parsing or
 * logging the token, and maps an unreadable credential to a distinct 'unknown'
 * state rather than "no credentials". No real Gemini CLI or model call.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Installer } = require('../src/installer');

const mockRegistry = { getEntry: () => null, getResolveRules: () => [] };

let tmpDir;
let savedEnvVars;

function geminiEntry(credsPath, overrides = {}) {
  return {
    name: 'gemini',
    install: { binary: 'gemini', macos: 'npm install -g @google/gemini-cli', linux: 'npm install -g @google/gemini-cli' },
    check_ready: {
      creds_file: credsPath,
      creds_no_parse: true,
      creds_path_env: ['GOOGLE_APPLICATION_CREDENTIALS'],
      env_vars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      saved_env_key: 'GEMINI_API_KEY',
      login_command: 'gemini',
      not_ready_message: 'Needs sign-in — run `gemini` to sign in, or set GEMINI_API_KEY.',
      unreadable_message: 'Gemini credentials were found but could not be read.',
      ...overrides,
    },
  };
}

// Evaluate readiness with a deterministic saved-env (no files, no PATH).
function evaluate(entry, savedEnv = {}) {
  const inst = new Installer(mockRegistry, tmpDir);
  inst.env.getEffective = () => savedEnv;
  return inst._evaluateReadiness('gemini', entry, '/fake/gemini');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-gemini-'));
  savedEnvVars = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnvVars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Gemini readiness — OAuth credential file (6.1)', () => {
  it('OAuth creds file present & readable → Ready', () => {
    const p = path.join(tmpDir, 'oauth_creds.json');
    fs.writeFileSync(p, '{"access_token":"REDACTED"}');
    const r = evaluate(geminiEntry(p));
    assert.equal(r.ready, true);
    assert.equal(r.auth_status, 'ready');
    assert.equal(r.auth_mode, 'cli_login');
  });

  it('OAuth creds file absent → not ready, no_credentials, "Needs sign-in" (not "Not logged in")', () => {
    const r = evaluate(geminiEntry(path.join(tmpDir, 'does-not-exist.json')));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'no_credentials');
    assert.match(r.message, /Needs sign-in/);
    assert.doesNotMatch(r.message, /^Not logged in/);
  });

  it('OAuth creds file exists but unreadable → unknown (NOT "Not logged in"), never Ready', () => {
    if (process.platform === 'win32') {
      return; // chmod(0o000) is a no-op on Windows; an unreadable file can't be simulated
    }
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return; // root bypasses file permissions; the unreadable path can't be simulated
    }
    const p = path.join(tmpDir, 'oauth_creds.json');
    fs.writeFileSync(p, '{"access_token":"REDACTED"}');
    fs.chmodSync(p, 0o000);
    try {
      const r = evaluate(geminiEntry(p));
      assert.equal(r.ready, false);
      assert.equal(r.auth_status, 'unknown');
      assert.match(r.message, /could not be read/);
    } finally {
      fs.chmodSync(p, 0o600);
    }
  });

  it('empty OAuth creds file is treated as absent (not Ready)', () => {
    const p = path.join(tmpDir, 'oauth_creds.json');
    fs.writeFileSync(p, '');
    const r = evaluate(geminiEntry(p));
    assert.equal(r.ready, false);
  });

  it('credential check never reads file contents (no JSON parse) — invalid JSON still Ready', () => {
    const p = path.join(tmpDir, 'oauth_creds.json');
    fs.writeFileSync(p, 'not-json-at-all'); // content-free check ⇒ still present
    const r = evaluate(geminiEntry(p));
    assert.equal(r.ready, true);
  });
});

describe('Gemini readiness — API key & service account (6.2)', () => {
  const noFile = () => path.join(tmpDir, 'absent.json');

  it('only GEMINI_API_KEY (process env) → Ready', () => {
    process.env.GEMINI_API_KEY = 'AIza-REDACTED';
    const r = evaluate(geminiEntry(noFile()));
    assert.equal(r.ready, true);
    assert.equal(r.auth_mode, 'api_key');
  });

  it('only GOOGLE_API_KEY (process env) → Ready', () => {
    process.env.GOOGLE_API_KEY = 'AIza-REDACTED';
    assert.equal(evaluate(geminiEntry(noFile())).ready, true);
  });

  it('only GEMINI_API_KEY saved in agent env → Ready (saved_env_key)', () => {
    const r = evaluate(geminiEntry(noFile()), { GEMINI_API_KEY: 'AIza-REDACTED' });
    assert.equal(r.ready, true);
  });

  it('GOOGLE_APPLICATION_CREDENTIALS → existing readable file → Ready', () => {
    const sa = path.join(tmpDir, 'sa.json');
    fs.writeFileSync(sa, '{"type":"service_account"}');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = sa;
    assert.equal(evaluate(geminiEntry(noFile())).ready, true);
  });

  it('GOOGLE_APPLICATION_CREDENTIALS non-empty but file missing → NOT Ready', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmpDir, 'missing-sa.json');
    const r = evaluate(geminiEntry(noFile()));
    assert.equal(r.ready, false);
    assert.equal(r.auth_status, 'no_credentials');
  });

  it('OAuth file AND API key both present → Ready', () => {
    const p = path.join(tmpDir, 'oauth_creds.json');
    fs.writeFileSync(p, '{"access_token":"REDACTED"}');
    process.env.GEMINI_API_KEY = 'AIza-REDACTED';
    assert.equal(evaluate(geminiEntry(p)).ready, true);
  });
});

describe('Gemini readiness — helpers are additive / opt-in (regression safety)', () => {
  it('_evaluateCredsFile is inert without creds_no_parse (existing creds_file agents unchanged)', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const p = path.join(tmpDir, 'creds.json');
    fs.writeFileSync(p, '{}');
    assert.deepEqual(inst._evaluateCredsFile({ creds_file: p }), { ready: false, unreadable: false });
    assert.deepEqual(inst._evaluateCredsFile({ creds_file: p, creds_no_parse: true }), { ready: true, unreadable: false });
  });

  it('_checkCredsPathEnv is false when creds_path_env absent', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    assert.equal(inst._checkCredsPathEnv({}, {}), false);
  });

  it('_credsFileState distinguishes present / absent', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    const p = path.join(tmpDir, 'f.json');
    fs.writeFileSync(p, 'x');
    assert.equal(inst._credsFileState({ creds_file: p }), 'present');
    assert.equal(inst._credsFileState({ creds_file: path.join(tmpDir, 'nope') }), 'absent');
    assert.equal(inst._credsFileState({}), 'absent');
  });

  it('_expandHome resolves a leading ~ against the running user home', () => {
    const inst = new Installer(mockRegistry, tmpDir);
    assert.equal(inst._expandHome('~/.gemini/oauth_creds.json'), path.join(os.homedir(), '.gemini', 'oauth_creds.json'));
    assert.equal(inst._expandHome('/abs/path'), '/abs/path');
  });
});

describe('Gemini readiness — registry config (status mapping)', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'));
  const entry = (registry.agents || registry).find((a) => a.name === 'gemini');

  it('registry declares OAuth file + env + service-account detection', () => {
    assert.equal(entry.check_ready.creds_file, '~/.gemini/oauth_creds.json');
    assert.equal(entry.check_ready.creds_no_parse, true);
    assert.deepEqual(entry.check_ready.creds_path_env, ['GOOGLE_APPLICATION_CREDENTIALS']);
    assert.ok(entry.check_ready.env_vars.includes('GEMINI_API_KEY'));
    assert.ok(entry.check_ready.env_vars.includes('GOOGLE_API_KEY'));
  });

  it('not_ready_message no longer says "Not logged in", and dead alt_check is gone', () => {
    assert.doesNotMatch(entry.check_ready.not_ready_message, /Not logged in/);
    assert.equal(entry.check_ready.alt_check, undefined);
  });
});
