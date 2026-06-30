'use strict';

/**
 * Unit tests for the shared readiness / failure-classification module.
 *
 * This is the single source of truth the Install page, the Agents list, the
 * daemon and the TUI all use, so its rules are pinned here:
 *   - "not installed" ONLY for a missing executable (login_required otherwise),
 *   - Windows .cmd/.bat must be launched through a shell,
 *   - join / heartbeat / spawn failures classify to distinct reasons,
 *   - secrets are redacted out of every diagnostic string.
 *
 * Run: node --test test/health-status.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  REASON,
  isErrorReason,
  readinessReason,
  shouldUseShellForBinary,
  redactDiagnostic,
  classifyJoinError,
  classifyHeartbeatError,
  classifySpawnError,
} = require('../src/adapters/health-status');

describe('readinessReason — installed vs login_required vs not_installed', () => {
  it('missing executable → not_installed', () => {
    assert.equal(readinessReason(false, false), REASON.NOT_INSTALLED);
    assert.equal(readinessReason(false, true), REASON.NOT_INSTALLED);
  });
  it('installed but not ready → login_required (NEVER not_installed)', () => {
    assert.equal(readinessReason(true, false), REASON.LOGIN_REQUIRED);
    assert.notEqual(readinessReason(true, false), REASON.NOT_INSTALLED);
  });
  it('installed and ready → ready', () => {
    assert.equal(readinessReason(true, true), REASON.READY);
  });
});

describe('isErrorReason — only real failures are hard errors', () => {
  it('runtime/connectivity failures are errors', () => {
    for (const r of [
      REASON.RUNTIME_MISSING,
      REASON.SPAWN_FAILED,
      REASON.WORKSPACE_JOIN_FAILED,
      REASON.HEARTBEAT_FAILED,
      REASON.SESSION_REVOKED,
      REASON.ADAPTER_CRASHED,
    ]) {
      assert.equal(isErrorReason(r), true, `${r} should be an error reason`);
    }
  });
  it('readiness states are NOT hard errors', () => {
    assert.equal(isErrorReason(REASON.READY), false);
    assert.equal(isErrorReason(REASON.LOGIN_REQUIRED), false);
    assert.equal(isErrorReason(REASON.NOT_INSTALLED), false);
  });
});

describe('shouldUseShellForBinary — Windows .cmd/.bat', () => {
  it('uses a shell for .cmd / .bat on win32 (case-insensitive)', () => {
    assert.equal(shouldUseShellForBinary('C:/Users/x/.amp/bin/amp.cmd', 'win32'), true);
    assert.equal(shouldUseShellForBinary('C:/x/amp.CMD', 'win32'), true);
    assert.equal(shouldUseShellForBinary('C:/x/amp.bat', 'win32'), true);
  });
  it('no shell for a real .exe / extensionless binary on win32', () => {
    assert.equal(shouldUseShellForBinary('C:/Users/x/.amp/bin/amp.exe', 'win32'), false);
    assert.equal(shouldUseShellForBinary('C:/x/amp', 'win32'), false);
  });
  it('never uses a shell on POSIX', () => {
    assert.equal(shouldUseShellForBinary('/usr/local/bin/amp', 'linux'), false);
    assert.equal(shouldUseShellForBinary('amp.cmd', 'linux'), false);
    assert.equal(shouldUseShellForBinary('/opt/homebrew/bin/amp', 'darwin'), false);
  });
});

describe('classifyJoinError', () => {
  it('401/403 → workspace_join_failed with auth detail', () => {
    const r = classifyJoinError({ statusCode: 401 });
    assert.equal(r.reason, REASON.WORKSPACE_JOIN_FAILED);
    assert.match(r.message, /Workspace join failed/);
    assert.match(r.message, /401/);
    assert.equal(classifyJoinError({ statusCode: 403 }).reason, REASON.WORKSPACE_JOIN_FAILED);
  });
  it('404 → workspace not found', () => {
    const r = classifyJoinError({ statusCode: 404 });
    assert.match(r.message, /not found/i);
  });
  it('network error (no status) → workspace_join_failed, never "not installed"', () => {
    const r = classifyJoinError(new Error('ECONNREFUSED 1.2.3.4:443'));
    assert.equal(r.reason, REASON.WORKSPACE_JOIN_FAILED);
    assert.doesNotMatch(r.message, /not installed/i);
  });
});

describe('classifyHeartbeatError', () => {
  it('classifies as heartbeat_failed with the HTTP status', () => {
    const r = classifyHeartbeatError({ statusCode: 503 });
    assert.equal(r.reason, REASON.HEARTBEAT_FAILED);
    assert.match(r.message, /heartbeat failed/i);
    assert.match(r.message, /503/);
    assert.doesNotMatch(r.message, /not installed/i);
  });
});

describe('classifySpawnError', () => {
  it('ENOENT → spawn_failed (NOT not_installed) with the resolved path', () => {
    const r = classifySpawnError({ code: 'ENOENT' }, { label: 'Amp', bin: '/home/u/.amp/bin/amp.cmd' });
    assert.equal(r.reason, REASON.SPAWN_FAILED);
    assert.match(r.message, /Amp process failed to start/);
    assert.match(r.message, /amp\.cmd/);
    assert.doesNotMatch(r.message, /not installed/i);
  });
  it('EACCES → permission denied', () => {
    const r = classifySpawnError({ code: 'EACCES' }, { label: 'Amp', bin: '/x/amp' });
    assert.match(r.message, /permission denied/i);
  });
});

describe('redactDiagnostic — never leak secrets', () => {
  it('redacts token / api key / bearer / url credentials / long blobs', () => {
    const out = redactDiagnostic(
      'join failed token=abc123secret AMP_API_KEY=sgp_supersecrettoken Authorization: Bearer xyz.987 ' +
        'at https://user:p4ss@host/path key=' + 'A'.repeat(50),
    );
    assert.doesNotMatch(out, /abc123secret/);
    assert.doesNotMatch(out, /sgp_supersecrettoken/);
    assert.doesNotMatch(out, /xyz\.987/);
    assert.doesNotMatch(out, /p4ss/);
    assert.doesNotMatch(out, /A{50}/);
    assert.match(out, /<redacted>/);
  });
  it('caps length and never throws on odd input', () => {
    assert.equal(typeof redactDiagnostic(null), 'string');
    assert.equal(typeof redactDiagnostic(undefined), 'string');
    assert.ok(redactDiagnostic('x'.repeat(5000), 100).length <= 101);
  });
});
