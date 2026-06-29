'use strict';

/**
 * Tests for the connector's auth-guidance helpers — the layer that stops Gemini
 * (env_config: []) from being mislabeled "No configuration required" in the TUI
 * (`showConfigureScreen`) and CLI (`agn env`). Verifies:
 *   - the OPT-IN gate (hasCredentialMetadata) so agents WITHOUT credential
 *     metadata keep their original "no configuration" behavior;
 *   - the four Gemini auth states (no creds, OAuth, API key, unreadable) map to
 *     the right, NON-sensitive guidance;
 *   - `agn env gemini` no longer prints "No env vars configured".
 * No real Gemini CLI, no model call, no credential contents are read or printed.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  hasCredentialMetadata,
  readyLabel,
  formatAuthGuidance,
} = require('../src/auth-guidance');

const registry = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf-8'),
);
const geminiEntry = (Array.isArray(registry) ? registry : registry.agents).find(
  (a) => a.name === 'gemini',
);

describe('auth-guidance — opt-in gate (regression safety)', () => {
  it('detects credential metadata for Gemini', () => {
    assert.equal(hasCredentialMetadata(geminiEntry.check_ready), true);
  });

  it('is FALSE for agents with no credential metadata (keep "No configuration required")', () => {
    assert.equal(hasCredentialMetadata({}), false);
    assert.equal(hasCredentialMetadata(null), false);
    assert.equal(hasCredentialMetadata(undefined), false);
    assert.equal(hasCredentialMetadata({ some_other_field: true }), false);
  });

  it('each individual credential signal is enough to opt in', () => {
    assert.equal(hasCredentialMetadata({ creds_file: '~/x' }), true);
    assert.equal(hasCredentialMetadata({ env_vars: ['K'] }), true);
    assert.equal(hasCredentialMetadata({ creds_path_env: ['P'] }), true);
    assert.equal(hasCredentialMetadata({ login_command: 'gemini' }), true);
    // Empty arrays are not a signal.
    assert.equal(hasCredentialMetadata({ env_vars: [], creds_path_env: [] }), false);
  });
});

describe('auth-guidance — Gemini auth states', () => {
  it('NOT authenticated → login guidance, never "No configuration required"', () => {
    const g = formatAuthGuidance(geminiEntry, {
      installed: true,
      ready: false,
      auth_status: 'no_credentials',
      message: geminiEntry.check_ready.not_ready_message,
    });
    assert.equal(g.ready, false);
    const text = g.lines.join('\n');
    // Explicit "run `gemini` and refresh" guidance + API-key alternative.
    assert.match(text, /run `gemini`/i);
    assert.match(text, /refresh/i);
    assert.match(text, /GEMINI_API_KEY/);
    assert.match(text, /GOOGLE_API_KEY/);
    // Must NOT reuse the misleading copy.
    assert.doesNotMatch(text, /No configuration required/i);
    assert.doesNotMatch(text, /No env vars configured/i);
  });

  it('OAuth ready → "Ready — Google account sign-in detected"', () => {
    const g = formatAuthGuidance(geminiEntry, {
      installed: true,
      ready: true,
      auth_mode: 'cli_login',
      auth_status: 'ready',
      message: 'Ready',
    });
    assert.equal(g.ready, true);
    assert.match(g.lines.join('\n'), /Ready — Google account sign-in detected/);
  });

  it('API key ready → "Ready — API key detected" (no `gemini` login prompt)', () => {
    const g = formatAuthGuidance(geminiEntry, {
      installed: true,
      ready: true,
      auth_mode: 'api_key',
      auth_status: 'ready',
      message: 'Ready',
    });
    assert.equal(g.ready, true);
    const text = g.lines.join('\n');
    assert.match(text, /Ready — API key detected/);
    assert.doesNotMatch(text, /run `gemini`/i);
  });

  it('credential file unreadable → not ready, surfaces the unreadable message', () => {
    const g = formatAuthGuidance(geminiEntry, {
      installed: true,
      ready: false,
      auth_status: 'unknown',
      message: geminiEntry.check_ready.unreadable_message,
    });
    assert.equal(g.ready, false);
    assert.match(g.lines.join('\n'), /could not be read/i);
  });

  it('not installed → clear "not installed" line, never Ready', () => {
    const g = formatAuthGuidance(geminiEntry, { installed: false, ready: false });
    assert.equal(g.ready, false);
    assert.equal(g.status, 'not_installed');
    assert.match(g.lines.join('\n'), /not installed/i);
  });

  it('ready labels are registry-driven, with generic fallbacks', () => {
    assert.equal(readyLabel(geminiEntry.check_ready, 'cli_login'), 'Google account sign-in detected');
    assert.equal(readyLabel(geminiEntry.check_ready, 'api_key'), 'API key detected');
    // An agent without labels still reads sensibly.
    assert.equal(readyLabel({}, 'cli_login'), 'CLI sign-in detected');
    assert.equal(readyLabel({}, 'api_key'), 'API key detected');
  });
});

describe('auth-guidance — never leaks credential contents', () => {
  it('guidance lines contain only declared NAMES, no token/key values', () => {
    // Simulate a health object that (wrongly) carried a token; the formatter
    // ignores everything except the declared, non-sensitive fields.
    const g = formatAuthGuidance(geminiEntry, {
      installed: true,
      ready: true,
      auth_mode: 'cli_login',
      auth_status: 'ready',
      message: 'Ready',
      access_token: 'ya29.SECRET-DO-NOT-PRINT',
      email: 'user@example.com',
    });
    const text = g.lines.join('\n');
    assert.doesNotMatch(text, /ya29\.SECRET/);
    assert.doesNotMatch(text, /user@example\.com/);
  });
});

describe('agn env gemini — CLI integration', () => {
  const CLI = path.join(__dirname, '..', 'bin', 'agent-connector.js');

  it('prints an authentication status block, not "No env vars configured"', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-gemini-'));
    try {
      const out = execFileSync(
        process.execPath,
        [CLI, 'env', 'gemini', '--config', tmp],
        { encoding: 'utf-8', timeout: 20000 },
      );
      assert.match(out, /authentication status/i);
      assert.doesNotMatch(out, /No env vars configured for gemini/);
      assert.doesNotMatch(out, /No configuration required/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
