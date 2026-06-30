'use strict';

/**
 * BaseAdapter lifecycle status reporting — the mechanism that surfaces the REAL
 * workspace failure (join / heartbeat / session-revoked) to the daemon status
 * instead of swallowing it in a log line.
 *
 *   - join 401            → onStatus(workspace_join_failed), returns false
 *   - join ok             → onStatus(null) [healthy], returns true
 *   - heartbeat 5xx       → onStatus(heartbeat_failed)
 *   - heartbeat ok        → onStatus(null)
 *   - session revoked     → getExitInfo() = session_revoked, _running=false
 *   - none of the above   → message NEVER contains "not installed"
 *
 * Run: node --test test/adapter-status-lifecycle.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const BaseAdapter = require('../src/adapters/base');
const { SessionRevokedError } = require('../src/workspace-client');
const { REASON } = require('../src/adapters/health-status');

function makeAdapter() {
  const calls = [];
  const a = new BaseAdapter({
    workspaceId: 'w',
    channelName: 'general',
    token: 't',
    agentName: 'a',
    endpoint: 'http://127.0.0.1:0',
    onStatus: (u) => calls.push(u),
  });
  a._log = () => {};
  return { a, calls };
}

const httpErr = (statusCode) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

describe('preflight default', () => {
  it('BaseAdapter is runnable by default', () => {
    const { a } = makeAdapter();
    assert.deepEqual(a.preflight(), { ok: true });
  });
});

describe('_reportStatus dedupe', () => {
  it('collapses identical consecutive reports, fires on change', () => {
    const { a, calls } = makeAdapter();
    a._reportStatus(REASON.HEARTBEAT_FAILED, 'down');
    a._reportStatus(REASON.HEARTBEAT_FAILED, 'down'); // deduped
    a._reportStatus(null); // recovered → fires
    a._reportStatus(null); // deduped
    assert.equal(calls.length, 2);
    assert.equal(calls[0].reason, REASON.HEARTBEAT_FAILED);
    assert.equal(calls[1].reason, null);
  });
});

describe('_joinWorkspace', () => {
  it('success → reports healthy (null), returns true, records session', async () => {
    const { a, calls } = makeAdapter();
    a.client.joinNetwork = async () => ({ session_id: 'sess-123' });
    const ok = await a._joinWorkspace();
    assert.equal(ok, true);
    assert.equal(a._sessionId, 'sess-123');
    assert.equal(calls.at(-1).reason, null);
  });

  it('401 → workspace_join_failed, returns false, NOT a terminal exit, no "not installed"', async () => {
    const { a, calls } = makeAdapter();
    a.client.joinNetwork = async () => { throw httpErr(401); };
    const ok = await a._joinWorkspace();
    assert.equal(ok, false);
    assert.equal(calls.at(-1).reason, REASON.WORKSPACE_JOIN_FAILED);
    assert.doesNotMatch(calls.at(-1).message, /not installed/i);
    assert.equal(a.getExitInfo(), null, 'a join failure is non-terminal — keeps retrying');
  });
});

describe('_heartbeat', () => {
  it('success → reports healthy (clears prior error)', async () => {
    const { a, calls } = makeAdapter();
    a.client.heartbeat = async () => ({ ok: true });
    await a._heartbeat();
    assert.equal(calls.at(-1).reason, null);
  });

  it('a SINGLE transient failure does NOT flip to error (no flapping)', async () => {
    const { a, calls } = makeAdapter();
    a.client.heartbeat = async () => { throw httpErr(503); };
    await a._heartbeat(); // one blip
    assert.equal(
      calls.filter((c) => c.reason === REASON.HEARTBEAT_FAILED).length,
      0,
      'one heartbeat blip must not report a hard error',
    );
    assert.equal(a.getExitInfo(), null);
  });

  it('repeated consecutive failures → heartbeat_failed (not terminal, not "not installed")', async () => {
    const { a, calls } = makeAdapter();
    a.client.heartbeat = async () => { throw httpErr(503); };
    await a._heartbeat();
    await a._heartbeat(); // threshold reached
    assert.equal(calls.at(-1).reason, REASON.HEARTBEAT_FAILED);
    assert.doesNotMatch(calls.at(-1).message, /not installed/i);
    assert.equal(a.getExitInfo(), null);
  });

  it('a success between blips resets the streak (transient recovery clears)', async () => {
    const { a, calls } = makeAdapter();
    let fail = true;
    a.client.heartbeat = async () => { if (fail) throw httpErr(503); return { ok: true }; };
    await a._heartbeat(); // blip 1
    fail = false;
    await a._heartbeat(); // recovered → streak reset, reports healthy
    fail = true;
    await a._heartbeat(); // blip 1 again (streak was reset) → still no hard error
    assert.equal(
      calls.filter((c) => c.reason === REASON.HEARTBEAT_FAILED).length,
      0,
    );
  });

  it('session revoked → terminal exit info, stops running', async () => {
    const { a, calls } = makeAdapter();
    a._running = true;
    a.client.heartbeat = async () => { throw new SessionRevokedError('revoked'); };
    await a._heartbeat();
    assert.equal(a._running, false);
    assert.equal(a.getExitInfo().reason, REASON.SESSION_REVOKED);
    assert.equal(calls.at(-1).reason, REASON.SESSION_REVOKED);
  });
});

describe('wasStopRequested', () => {
  it('false until stop() is called, true after (clean user stop)', () => {
    const { a } = makeAdapter();
    assert.equal(a.wasStopRequested(), false);
    a.stop();
    assert.equal(a.wasStopRequested(), true);
    assert.equal(a._running, false);
  });
});
