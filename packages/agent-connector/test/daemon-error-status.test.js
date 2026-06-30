'use strict';

/**
 * Daemon → daemon.status.json mapping: a real runtime failure surfaces as state
 * 'error' with a classified, REDACTED last_error + error_reason, while a clean
 * user stop is never written as an error.
 *
 * Run: node --test test/daemon-error-status.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { Daemon } = require('../src/daemon');
const { Config } = require('../src/config');
const { EnvManager } = require('../src/env');
const { Registry } = require('../src/registry');
const { REASON } = require('../src/adapters/health-status');

let tmpDir;
let daemon;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-daemon-status-'));
  daemon = new Daemon(new Config(tmpDir), new EnvManager(tmpDir), new Registry(tmpDir));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function freshInfo() {
  return {
    type: 'amp',
    network: 'ws1',
    state: 'running',
    restarts: 0,
    startedAt: null,
    lastError: null,
    errorReason: null,
  };
}

describe('_applyAdapterStatus', () => {
  it('error reason → state error + classified reason + REDACTED message', () => {
    const info = freshInfo();
    daemon._processes.amp = info;
    daemon._applyAdapterStatus('amp', info, {
      reason: REASON.WORKSPACE_JOIN_FAILED,
      message: 'Workspace join failed: HTTP 401 token=supersecretvalue123456',
    });
    assert.equal(info.state, 'error');
    assert.equal(info.errorReason, REASON.WORKSPACE_JOIN_FAILED);
    assert.match(info.lastError, /Workspace join failed/);
    assert.doesNotMatch(info.lastError, /supersecretvalue123456/);
    // and it is reflected in getStatus()
    const st = daemon.getStatus().amp;
    assert.equal(st.state, 'error');
    assert.equal(st.error_reason, REASON.WORKSPACE_JOIN_FAILED);
  });

  it('null reason → recovers from error back to running, clears lastError', () => {
    const info = freshInfo();
    info.state = 'error';
    info.errorReason = REASON.HEARTBEAT_FAILED;
    info.lastError = 'Workspace heartbeat failed: HTTP 503';
    daemon._processes.amp = info;
    daemon._applyAdapterStatus('amp', info, { reason: null });
    assert.equal(info.state, 'running');
    assert.equal(info.lastError, null);
    assert.equal(info.errorReason, null);
  });

  it('ignored once the agent is stopping (a user stop must win)', () => {
    const info = freshInfo();
    daemon._processes.amp = info;
    daemon._stoppedAgents.add('amp');
    daemon._applyAdapterStatus('amp', info, {
      reason: REASON.HEARTBEAT_FAILED,
      message: 'down',
    });
    assert.equal(info.state, 'running', 'a stopping agent is not flipped to error');
    assert.equal(info.errorReason, null);
  });

  it('login_required is NOT a hard error (readiness, not a failure)', () => {
    const info = freshInfo();
    daemon._processes.amp = info;
    daemon._applyAdapterStatus('amp', info, {
      reason: REASON.LOGIN_REQUIRED,
      message: 'Amp is installed but not signed in',
    });
    // not an error reason → treated as "healthy/clear", state stays running
    assert.equal(info.state, 'running');
    assert.equal(info.errorReason, null);
  });
});

describe('getStatus shape', () => {
  it('exposes error_reason alongside last_error', () => {
    daemon._processes.amp = {
      ...freshInfo(),
      state: 'error',
      lastError: 'Amp process failed to start: executable not found',
      errorReason: REASON.SPAWN_FAILED,
    };
    const st = daemon.getStatus().amp;
    assert.equal(st.last_error, 'Amp process failed to start: executable not found');
    assert.equal(st.error_reason, REASON.SPAWN_FAILED);
  });
});
