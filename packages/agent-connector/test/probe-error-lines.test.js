'use strict';

/**
 * Connection-test messages quoted on the daily errors dashboard (2026-11)
 * where a harmless notice stood in for the reason the test failed.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure, failureMessage, CODE } = require('../src/probe');

const msg = (res, code) => failureMessage({ code: 1, stdout: '', stderr: '', ...res }, code, 120000);

describe('connection test: the reason, not the notice before it', () => {
  it('Codex with no sign-in: drops the WebSocket notice and reads it as not signed in', () => {
    const stderr = 'warning: Falling back from WebSockets to HTTPS transport. unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: wss://api.openai.com/v1/responses';
    const code = classifyFailure(stderr);
    assert.equal(code, CODE.NOT_LOGGED_IN);
    assert.match(msg({ stderr }, code), /^unexpected status 401 Unauthorized: Missing bearer/);
    assert.equal(classifyFailure('warning: Falling back from WebSockets to HTTPS transport. workspace routing discovery unauthorized (401)'), CODE.NOT_LOGGED_IN);
  });

  it('Gemini: the error line, not the account record dumped before it', () => {
    const stderr = [
      "  tierId: 'free-tier',",
      "  tierName: 'Gemini Code Assist for individuals'",
      '  }',
      ' ]',
      '}',
      'Ripgrep is not available. Falling back to GrepTool.',
      'Skill conflict detected: "agents-sdk" from "C:\\Users\\o\\.agents\\skills\\agents-sdk\\SKILL.md" is overriding the same skill from "C:\\Users\\o\\.gemini\\skills\\agents-sdk\\SKILL.md".',
      'An unexpected critical error occurred:IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.',
    ].join('\n');
    const code = classifyFailure(stderr);
    assert.equal(msg({ stderr }, code), 'An unexpected critical error occurred:IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.');
  });

  it("Codex timeout: config notices aren't the reason", () => {
    const stderr = [
      'warning: Codex is ignoring 2 unrecognized configuration settings. Check for typos or deprecated settings.',
      'user (C:\\Users\\x\\.codex\\config.toml): `network_access` is ignored.',
      'user (C:\\Users\\x\\.codex\\config.toml): `windows_wsl_setup_acknowledged` is ignored.',
      'warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably.',
      'hook: SessionStart',
    ].join('\n');
    const code = classifyFailure(stderr, { timedOut: true });
    assert.equal(code, CODE.TIMEOUT);
    assert.equal(msg({ stderr, timedOut: true }, code), 'Timed out after 120s');
  });

  it("Claude: the sign-in reminder isn't \"not logged in\"", () => {
    const stderr = 'Warning: this sign-in ends between 2026-11-15 and 2026-11-18 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then.';
    const code = classifyFailure(stderr, { timedOut: true });
    assert.equal(code, CODE.TIMEOUT);
    assert.equal(msg({ stderr, timedOut: true }, code), 'Timed out after 120s');
  });

  it("Claude: the untrusted-folder notice isn't the reason", () => {
    const stderr = 'Ignoring 14 permissions.allow entries from .claude/settings.local.json: this workspace has not been trusted.\nAPI Error: 401 invalid x-api-key';
    const code = classifyFailure(stderr);
    assert.equal(code, CODE.INVALID_API_KEY);
    assert.equal(msg({ stderr }, code), 'API Error: 401 invalid x-api-key');
  });

  it('a clean exit with no reply says so, not "Exited with code 0"', () => {
    assert.equal(msg({ code: 0 }, CODE.EMPTY_RESPONSE), 'The CLI finished without replying');
    assert.equal(msg({ code: 3 }, CODE.CLI_ERROR), 'Exited with code 3');
  });
});
