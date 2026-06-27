'use strict';

/**
 * Deterministic tests for the BaseAdapter connection self-healing (V1).
 *
 * No real waiting: time is injected via adapter._clock, backoff jitter via
 * adapter._jitter, and sleeps are replaced by a controllable gate that only
 * resolves when the test fires them (or when _wakeAll runs on stop/reconnect).
 * Heartbeat/join/poll outcomes are scripted through a mock WorkspaceClient.
 *
 * The final block is a protocol-level test against a real in-process HTTP
 * server using the real WorkspaceClient, exercising in-flight-task → reconnect
 * → completion post with server-side session validation.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BaseAdapter = require('../src/adapters/base.js');
const { WorkspaceClient, SessionRevokedError } = require('../src/workspace-client.js');

const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function httpErr(statusCode, message = `HTTP ${statusCode}`) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}
function netErr(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

class TestAdapter extends BaseAdapter {
  constructor(opts) {
    super(opts);
    this.dispatched = [];
  }
  async _handleMessage(msg) {
    this.dispatched.push(msg.id || msg.messageId);
  }
}

/**
 * Build an adapter with all external I/O mocked and all time/sleeps under
 * test control. Returns helpers to drive the supervised lifecycle step by step.
 */
function makeHarness({ pollPending } = {}) {
  const h = {
    now: 0,
    joinQueue: [],     // each: deferred-like {result} or {error}
    hbQueue: [],       // pending heartbeat deferreds (FIFO)
    sleeps: new Set(), // active interruptible sleeps (finish fns)
    disconnectCalls: 0,
    joinCalls: 0,
    hbCalls: 0,
  };

  const client = {
    async joinNetwork() {
      h.joinCalls++;
      const next = h.joinQueue.shift();
      if (!next) throw netErr('ETIMEDOUT'); // default: transient
      if (next.error) throw next.error;
      return next.result;
    },
    heartbeat() {
      h.hbCalls++;
      const d = deferred();
      h.hbQueue.push(d);
      return d.promise;
    },
    async pollPending(...args) {
      if (pollPending) return pollPending(...args);
      return { messages: [], cursor: null, composing: false };
    },
    async pollControl() { return []; },
    async pollToolResults() { return { events: [], cursor: null }; },
    async getHeadEventId() { return null; },
    async getAgents() { return []; },
    async disconnect() { h.disconnectCalls++; },
    async sendMessage() { return {}; },
  };

  const adapter = new TestAdapter({
    workspaceId: 'ws-1', channelName: 'general', token: 'tok',
    agentName: 'claude-1', endpoint: 'http://mock', agentType: 'claude',
  });
  adapter.client = client;
  adapter._clock = () => h.now;
  adapter._jitter = () => 0;                 // deterministic backoff
  adapter._syncSkillsFromWorkspace = async () => {};   // avoid skill-sync timer
  adapter._controlPollerLoop = async () => {};         // not under test
  // Controllable sleep: registers a waiter (so real _wakeAll wakes it) but does
  // NOT auto-fire on a timer — the test advances it explicitly via fireSleeps().
  adapter._interruptibleSleep = function (_ms) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this._waiters.delete(finish);
        h.sleeps.delete(finish);
        resolve();
      };
      this._waiters.add(finish);
      h.sleeps.add(finish);
      if (!this._running) finish();
    });
  };

  h.client = client;
  h.adapter = adapter;
  h.queueJoinSuccess = (sid) => h.joinQueue.push({ result: { session_id: sid } });
  h.queueJoinResult = (result) => h.joinQueue.push({ result });
  h.queueJoinError = (err) => h.joinQueue.push({ error: err });
  h.fireSleeps = () => { for (const f of [...h.sleeps]) f(); };
  h.settleHeartbeat = (mode, err) => {
    const d = h.hbQueue.shift();
    if (!d) return false;
    if (mode === 'ok') d.resolve({ status: 'online' }); else d.reject(err);
    return true;
  };
  h.start = () => { h.runPromise = adapter.run(); return h.runPromise; };
  h.flush = flush;
  return h;
}

// ---------------------------------------------------------------------------
// 1. First join succeeds → connected, active generation set.
// ---------------------------------------------------------------------------
test('first join succeeds → connected with active generation', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  assert.strictEqual(h.adapter._sessionId, 's1');
  assert.strictEqual(h.adapter._connState, 'connected');
  assert.notStrictEqual(h.adapter._activeGen, null);
  assert.strictEqual(h.joinCalls, 1);
  h.adapter.stop();
  h.settleHeartbeat('ok');
  h.fireSleeps();
  await h.runPromise;
});

// ---------------------------------------------------------------------------
// 2. Join returns 2xx but no session_id → not connected; ambiguous retry,
//    then terminal after JOIN_MAX_ATTEMPTS_AMBIGUOUS.
// ---------------------------------------------------------------------------
test('join without session_id → never connects, becomes terminal after cap', async () => {
  const h = makeHarness();
  for (let i = 0; i < 6; i++) h.queueJoinResult({ session_id: '' }); // empty → ambiguous
  h.start();
  // Step through ambiguous retries by firing the backoff sleeps.
  for (let i = 0; i < 8; i++) { await h.flush(); h.fireSleeps(); }
  await h.runPromise; // terminal → run() returns
  assert.strictEqual(h.adapter._activeGen, null);
  assert.strictEqual(h.adapter._connState, 'disconnected');
  assert.strictEqual(h.adapter._terminalReason, 'join_failed');
  assert.strictEqual(h.joinCalls, 5, 'should stop at JOIN_MAX_ATTEMPTS_AMBIGUOUS');
});

// ---------------------------------------------------------------------------
// 3. Join fails transiently then succeeds (workspace late / network blip).
// ---------------------------------------------------------------------------
test('join retries transient failures then connects', async () => {
  const h = makeHarness();
  h.queueJoinError(netErr('ECONNREFUSED'));
  h.queueJoinError(httpErr(503));
  h.queueJoinSuccess('s9');
  h.start();
  for (let i = 0; i < 4; i++) { await h.flush(); h.fireSleeps(); }
  await h.flush();
  assert.strictEqual(h.adapter._connState, 'connected');
  assert.strictEqual(h.adapter._sessionId, 's9');
  assert.strictEqual(h.joinCalls, 3);
  h.adapter.stop(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 4. Join auth failure (401) → immediate terminal, no retry.
// ---------------------------------------------------------------------------
test('join 401 → terminal immediately, no retry', async () => {
  const h = makeHarness();
  h.queueJoinError(httpErr(401, 'Invalid network token'));
  h.start();
  await h.runPromise;
  assert.strictEqual(h.joinCalls, 1);
  assert.strictEqual(h.adapter._terminalReason, 'auth');
  assert.strictEqual(h.adapter._connState, 'disconnected');
});

// ---------------------------------------------------------------------------
// 5. Heartbeat single-flight: a slow heartbeat never overlaps the next.
// ---------------------------------------------------------------------------
test('heartbeat is single-flight (no overlap while in flight)', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  assert.strictEqual(h.hbCalls, 1, 'initial heartbeat fired');
  // Do NOT settle the first heartbeat; fire sleeps repeatedly.
  for (let i = 0; i < 5; i++) { h.fireSleeps(); await h.flush(); }
  assert.strictEqual(h.hbCalls, 1, 'no second heartbeat while first is in flight');
  // Settle it → loop sleeps → fire → second heartbeat.
  h.settleHeartbeat('ok');
  await h.flush(); h.fireSleeps(); await h.flush();
  assert.strictEqual(h.hbCalls, 2);
  h.adapter.stop(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 6. AND reconnect judgement: neither / only-time / only-count → no reconnect;
//    both → reconnect (when idle).
// ---------------------------------------------------------------------------
test('reconnect requires BOTH freshness window AND failure threshold (AND, not OR)', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');     // attempt 1
  h.queueJoinSuccess('s2');     // attempt 2 (after reconnect)
  h.start();
  await h.flush();
  const gen1 = h.adapter._activeGen;

  // Only count, time still fresh (now small): 3 failures, lapsed ~0 → no reconnect.
  h.now = 0;
  for (let i = 0; i < 3; i++) {
    h.settleHeartbeat('fail', netErr('ETIMEDOUT'));
    await h.flush(); h.fireSleeps(); await h.flush();
  }
  assert.strictEqual(h.adapter._consecutiveHeartbeatFailures >= 3, true);
  assert.strictEqual(h.adapter._activeGen, gen1, 'count-only must NOT reconnect');

  // Only time: jump clock past window but reset failures via a success first.
  h.settleHeartbeat('ok'); await h.flush(); h.fireSleeps(); await h.flush();
  assert.strictEqual(h.adapter._consecutiveHeartbeatFailures, 0);
  h.now = 200000; // far past window, but only 1 upcoming failure
  h.settleHeartbeat('fail', netErr('ETIMEDOUT'));
  await h.flush(); h.fireSleeps(); await h.flush();
  assert.strictEqual(h.adapter._activeGen, gen1, 'time-only (1 failure) must NOT reconnect');

  // Both: keep failing past threshold with clock past window → reconnect.
  // (The reconnect + re-join to s2 completes within a flush, so assert the
  // observable OUTCOME — a re-join happened — rather than the transient null.)
  let guard = 0;
  while (h.adapter._activeGen === gen1 && guard++ < 6) {
    h.settleHeartbeat('fail', netErr('ETIMEDOUT'));
    await h.flush(); h.fireSleeps(); await h.flush();
  }
  assert.strictEqual(h.joinCalls, 2, 'both conditions → re-join occurred');
  assert.strictEqual(h.adapter._sessionId, 's2');
  assert.notStrictEqual(h.adapter._activeGen, gen1, 'new active generation after reconnect');
  h.adapter.stop(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 7. Transient failures that recover before the window → soft recovery, no re-join.
// ---------------------------------------------------------------------------
test('transient failures recovering before window → soft recovery, no re-join', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  const gen1 = h.adapter._activeGen;
  h.now = 1000;
  h.settleHeartbeat('fail', httpErr(500)); await h.flush(); h.fireSleeps(); await h.flush();
  h.settleHeartbeat('fail', httpErr(500)); await h.flush(); h.fireSleeps(); await h.flush();
  h.now = 2000;
  h.settleHeartbeat('ok'); await h.flush();
  assert.strictEqual(h.adapter._consecutiveHeartbeatFailures, 0);
  assert.strictEqual(h.adapter._activeGen, gen1, 'must not re-join');
  assert.strictEqual(h.joinCalls, 1);
  assert.strictEqual(h.adapter._connState, 'connected');
  h.adapter.stop(); h.fireSleeps(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 8. Heartbeat 401/403 → immediate terminal disconnected (no 90s wait).
// ---------------------------------------------------------------------------
test('heartbeat 403 → terminal immediately, no reconnect', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  h.now = 1000; // fresh — proves we do NOT wait for the 90s window
  h.settleHeartbeat('fail', httpErr(403, 'forbidden'));
  await h.flush();
  assert.strictEqual(h.adapter._terminalReason, 'auth');
  assert.strictEqual(h.adapter._activeGen, null);
  h.fireSleeps();
  await h.runPromise; // run() exits terminal
  assert.strictEqual(h.joinCalls, 1, 'no auto re-join after auth-terminal');
});

// ---------------------------------------------------------------------------
// 9. SessionRevokedError on heartbeat → terminal, never auto-reconnect.
// ---------------------------------------------------------------------------
test('heartbeat session_revoked → terminal, no auto re-join', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  h.settleHeartbeat('fail', new SessionRevokedError('session_revoked'));
  await h.flush();
  assert.strictEqual(h.adapter._terminalReason, 'session_revoked');
  assert.strictEqual(h.adapter._connState, 'session_revoked');
  assert.strictEqual(h.adapter._activeGen, null);
  h.fireSleeps();
  await h.runPromise;
  assert.strictEqual(h.joinCalls, 1, 'no re-join after session_revoked');
});

// ---------------------------------------------------------------------------
// 10. stop() during join-retry backoff → wakes immediately, no further join.
// ---------------------------------------------------------------------------
test('stop during join backoff → exits immediately, no further join', async () => {
  const h = makeHarness();
  h.queueJoinError(netErr('ECONNREFUSED'));
  h.queueJoinError(netErr('ECONNREFUSED'));
  h.queueJoinSuccess('sX'); // would be used if it kept retrying
  h.start();
  await h.flush();               // first join fails → now sleeping in backoff
  assert.strictEqual(h.joinCalls, 1);
  assert.strictEqual(h.sleeps.size >= 1, true, 'backoff sleep registered');
  h.adapter.stop();              // wakes the backoff sleep via _wakeAll
  await h.runPromise;
  assert.strictEqual(h.joinCalls, 1, 'must not attempt another join after stop');
});

// ---------------------------------------------------------------------------
// 11. Multi-waiter: stop wakes heartbeat-sleep AND poll-sleep AND backoff
//     simultaneously (Set-based, no single-callback overwrite).
// ---------------------------------------------------------------------------
test('stop wakes all concurrent interruptible sleeps', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  // Settle initial heartbeat so the hb loop proceeds to its 30s sleep; poll
  // loop is already at its pacing sleep. Now multiple sleeps are registered.
  h.settleHeartbeat('ok');
  await h.flush();
  assert.strictEqual(h.sleeps.size >= 2, true, 'heartbeat + poll sleeps both registered');
  const before = h.sleeps.size;
  h.adapter.stop(); // real _wakeAll
  await h.flush();
  assert.strictEqual(h.sleeps.size, 0, `all ${before} waiters woken and removed`);
  await h.runPromise;
});

// ---------------------------------------------------------------------------
// 12. Stale heartbeat success after reconnect must NOT overwrite new state.
// ---------------------------------------------------------------------------
test('stale heartbeat result is ignored after generation changes', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.queueJoinSuccess('s2');
  h.start();
  await h.flush();
  const gen1 = h.adapter._activeGen;
  // Force a reconnect: both conditions met.
  h.now = 200000;
  for (let i = 0; i < 3; i++) {
    h.settleHeartbeat('fail', netErr('ETIMEDOUT'));
    await h.flush(); h.fireSleeps(); await h.flush();
  }
  // gen1 invalidated; an OLD heartbeat from gen1 now resolves late:
  const stillPending = h.hbQueue.length;
  // The reconnect already began; activeGen should be null or s2's gen.
  h.fireSleeps(); await h.flush();                 // let re-join (s2) complete
  const gen2 = h.adapter._activeGen;
  assert.notStrictEqual(gen2, gen1);
  assert.strictEqual(h.adapter._sessionId, 's2');
  // Any leftover gen1 heartbeat resolving now must not change consecutive count
  // or session for gen2.
  const failBefore = h.adapter._consecutiveHeartbeatFailures;
  for (let i = 0; i < stillPending; i++) h.settleHeartbeat('ok');
  await h.flush();
  assert.strictEqual(h.adapter._sessionId, 's2', 'stale hb must not change session');
  assert.strictEqual(h.adapter._activeGen, gen2, 'stale hb must not change active gen');
  assert.strictEqual(h.adapter._consecutiveHeartbeatFailures, failBefore);
  h.adapter.stop(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 13. Active-task DEFER: threshold met while a task is in flight → only
//     _reconnectPending; activeGen NOT invalidated; heartbeat/poll not stopped.
//     Then: heartbeat recovers → pending cleared, no re-join.
// ---------------------------------------------------------------------------
test('reconnect deferred while task active; cleared on heartbeat recovery', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  const gen1 = h.adapter._activeGen;
  // Simulate an active task.
  h.adapter._channelBusy.add('general');
  assert.strictEqual(h.adapter._hasActiveWork(), true);

  h.now = 200000;
  for (let i = 0; i < 3; i++) {
    h.settleHeartbeat('fail', netErr('ETIMEDOUT'));
    await h.flush(); h.fireSleeps(); await h.flush();
  }
  assert.strictEqual(h.adapter._reconnectPending, true, 'threshold met → pending');
  assert.strictEqual(h.adapter._reconnectInProgress, false);
  assert.strictEqual(h.adapter._activeGen, gen1, 'activeGen NOT invalidated while task active');
  assert.strictEqual(h.joinCalls, 1, 'no re-join while deferred');

  // Heartbeat recovers before the task ends → pending cleared, no re-join.
  h.settleHeartbeat('ok'); await h.flush();
  assert.strictEqual(h.adapter._reconnectPending, false, 'pending cleared on recovery');
  assert.strictEqual(h.adapter._activeGen, gen1);
  assert.strictEqual(h.joinCalls, 1);
  h.adapter._channelBusy.delete('general');
  h.adapter.stop(); h.fireSleeps(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 14. Active-task DEFER then task ends with heartbeat still failing → real
//     reconnect begins only after work drains.
// ---------------------------------------------------------------------------
test('deferred reconnect proceeds only after active task ends', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.queueJoinSuccess('s2');
  h.start();
  await h.flush();
  const gen1 = h.adapter._activeGen;
  h.adapter._channelBusy.add('general');
  h.now = 200000;
  for (let i = 0; i < 3; i++) {
    h.settleHeartbeat('fail', netErr('ETIMEDOUT'));
    await h.flush(); h.fireSleeps(); await h.flush();
  }
  assert.strictEqual(h.adapter._reconnectPending, true);
  assert.strictEqual(h.adapter._activeGen, gen1);

  // Task ends; next failing heartbeat re-evaluates and now begins reconnect.
  // (Begin + re-join to s2 completes within the flush — assert the outcome.)
  h.adapter._channelBusy.delete('general');
  h.settleHeartbeat('fail', netErr('ETIMEDOUT'));
  await h.flush(); h.fireSleeps(); await h.flush();
  assert.strictEqual(h.joinCalls, 2, 'reconnect proceeds after work drains');
  assert.strictEqual(h.adapter._sessionId, 's2');
  assert.notStrictEqual(h.adapter._activeGen, gen1);
  h.adapter.stop(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 15. Poll failures never trigger reconnect.
// ---------------------------------------------------------------------------
test('poll failures do not trigger reconnect', async () => {
  let pollCalls = 0;
  const h = makeHarness({
    pollPending: async () => { pollCalls++; throw httpErr(500); },
  });
  h.queueJoinSuccess('s1');
  h.now = 500000; // even with a stale clock, poll failures alone must not reconnect
  h.start();
  await h.flush();
  const gen1 = h.adapter._activeGen;
  for (let i = 0; i < 5; i++) { h.fireSleeps(); await h.flush(); }
  assert.ok(pollCalls >= 1, 'poll was attempted and failed');
  assert.strictEqual(h.adapter._activeGen, gen1, 'poll failures must not change generation');
  assert.strictEqual(h.adapter._consecutiveHeartbeatFailures, 0, 'poll failures must not count as heartbeat failures');
  assert.strictEqual(h.joinCalls, 1);
  h.adapter.stop(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});

// ---------------------------------------------------------------------------
// 16. Supervised path never calls remote leave (decision table: all auto exits).
// ---------------------------------------------------------------------------
test('supervised lifecycle never calls remote disconnect (leave)', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');
  h.start();
  await h.flush();
  // session_revoked terminal exit
  h.settleHeartbeat('fail', new SessionRevokedError('session_revoked'));
  await h.flush(); h.fireSleeps();
  await h.runPromise;
  assert.strictEqual(h.disconnectCalls, 0, 'no POST /v1/leave on any supervised exit');
});

// ---------------------------------------------------------------------------
// 17. Backoff jitter spreads a fleet (different delays for same attempt index).
// ---------------------------------------------------------------------------
test('backoff applies jitter so a fleet does not retry in lockstep', () => {
  const a = new TestAdapter({ workspaceId: 'w', channelName: 'general', token: 't', agentName: 'a', endpoint: 'http://x' });
  const b = new TestAdapter({ workspaceId: 'w', channelName: 'general', token: 't', agentName: 'b', endpoint: 'http://x' });
  // Deterministic-but-different jitter per instance.
  a._jitter = () => -0.5; b._jitter = () => 0.5;
  const da = a._backoff(2); // base 8000
  const db = b._backoff(2);
  assert.notStrictEqual(da, db, 'jittered delays differ');
  assert.ok(da >= 6400 && da <= 9600 && db >= 6400 && db <= 9600, 'within ±20% of 8s');
  // Cap holds.
  assert.ok(a._backoff(10) <= 30000 * 1.2);
});

// ---------------------------------------------------------------------------
// 18. Kill-switch: OA_ADAPTER_RECONNECT=0 routes to the legacy lifecycle
//     (one-shot join, setInterval heartbeat, finally remote disconnect).
// ---------------------------------------------------------------------------
test('kill-switch=0 uses legacy lifecycle (one-shot join + finally leave)', async () => {
  const prev = process.env.OA_ADAPTER_RECONNECT;
  process.env.OA_ADAPTER_RECONNECT = '0';
  try {
    let joinCalls = 0, disconnectCalls = 0, pollCalls = 0;
    const adapter = new TestAdapter({
      workspaceId: 'ws', channelName: 'general', token: 't',
      agentName: 'legacy-1', endpoint: 'http://mock', agentType: 'claude',
    });
    assert.strictEqual(adapter._reconnectEnabled, false, 'kill-switch disables reconnect');
    adapter._sleep = () => Promise.resolve();          // avoid the real 5s legacy poll pacing wait
    adapter.client = {
      async joinNetwork() { joinCalls++; return { session_id: 's1' }; },
      async heartbeat() { return {}; },
      async pollControl() { return []; },
      async pollToolResults() { return { events: [], cursor: null }; },
      async getHeadEventId() { return null; },
      // Throw synchronously so legacy's `Promise.race([getAgents(), <10s timer>])`
      // never constructs the 10s setTimeout (skill sync is best-effort).
      getAgents() { throw new Error('skip skill sync'); },
      async disconnect() { disconnectCalls++; },
      async pollPending() {
        pollCalls++;
        // Stop after the first poll so the legacy loop exits deterministically.
        adapter._running = false;
        return { messages: [], cursor: null, composing: false };
      },
    };
    await adapter.run(); // legacy path; pollPending stops it after one iteration
    assert.strictEqual(joinCalls, 1, 'legacy one-shot join');
    assert.strictEqual(disconnectCalls, 1, 'legacy finally calls remote disconnect (verbatim old behavior)');
    assert.ok(pollCalls >= 1);
    // Supervised-only state must be untouched by the legacy path.
    assert.strictEqual(adapter._activeGen, null);
  } finally {
    if (prev === undefined) delete process.env.OA_ADAPTER_RECONNECT;
    else process.env.OA_ADAPTER_RECONNECT = prev;
  }
});

// ---------------------------------------------------------------------------
// 19. PROTOCOL-LEVEL: in-flight task → reconnect → completion post.
//     Real WorkspaceClient against a mock HTTP server that rotates and
//     validates session_id exactly like the backend. Asserts the result post
//     is accepted under the current session and a stale-session post is 401.
// ---------------------------------------------------------------------------
test('protocol: session rotation + message-post validation (real client + mock server)', async () => {
  let currentSession = null;
  let sessionSeq = 0;
  const posted = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/v1/join') {
        sessionSeq++; currentSession = `sess-${sessionSeq}`;
        return send(200, { data: { network_id: 'w', agent_name: json.agent_name, status: 'online', session_id: currentSession } });
      }
      if (req.url === '/v1/heartbeat') {
        if (json.session_id && json.session_id !== currentSession) {
          return send(401, { message: 'session_revoked: another client is now running as this agent' });
        }
        return send(200, { data: { status: 'online' } });
      }
      if (req.url === '/v1/events' && req.method === 'POST') {
        // Mirrors _validate_session: claim != stored → session_revoked.
        const claimed = (json.metadata && json.metadata.session_id) || json.session_id;
        if (claimed && claimed !== currentSession) {
          return send(401, { message: 'session_revoked: another client is now running as this agent' });
        }
        posted.push({ session: claimed });
        return send(200, { data: { id: `evt-${posted.length}` } });
      }
      return send(404, { message: 'Network not found' });
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}`;

  try {
    const client = new WorkspaceClient(endpoint);

    // 1. Initial join → session 1.
    const j1 = await client.joinNetwork('claude-1', 'tok', { network: 'w' });
    assert.strictEqual(j1.session_id, 'sess-1');

    // 2. Task arrives under session 1. Reconnect happens → session 2.
    const j2 = await client.joinNetwork('claude-1', 'tok', { network: 'w' });
    assert.strictEqual(j2.session_id, 'sess-2');

    // 3. Old task completes; adapter posts result with the CURRENT session id
    //    (sess-2, as base.js reads this._sessionId at send time) → accepted.
    await client.sendMessage('w', 'general', 'tok', 'task done', {
      senderName: 'claude-1', sessionId: 'sess-2',
    });
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(posted[0].session, 'sess-2');

    // 4. A genuinely stale post (sess-1, e.g. another client took over) → 401
    //    SessionRevokedError, NOT silently accepted.
    await assert.rejects(
      client.sendMessage('w', 'general', 'tok', 'stale', { senderName: 'claude-1', sessionId: 'sess-1' }),
      (e) => e instanceof SessionRevokedError,
    );
    assert.strictEqual(posted.length, 1, 'stale post not persisted');

    // 5. Heartbeat with current session ok; with stale session → revoked.
    await client.heartbeat('w', 'claude-1', 'tok', 'sess-2');
    await assert.rejects(
      client.heartbeat('w', 'claude-1', 'tok', 'sess-1'),
      (e) => e instanceof SessionRevokedError,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// 20. workspace-client error enrichment: statusCode / code attached, message
//     text unchanged; SessionRevokedError still typed.
// ---------------------------------------------------------------------------
test('workspace-client attaches statusCode/code without changing message text', async () => {
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/auth') return send(401, { message: 'Invalid network token' });
      if (req.url === '/missing') return send(404, { message: 'Network not found' });
      if (req.url === '/boom') return send(503, { message: 'upstream unavailable' });
      if (req.url === '/revoked') return send(401, { message: 'session_revoked: taken over' });
      return send(200, { data: {} });
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const client = new WorkspaceClient(`http://127.0.0.1:${port}`);
    await assert.rejects(client._post('/auth', {}), (e) => {
      assert.strictEqual(e.statusCode, 401);
      assert.strictEqual(e.message, 'Invalid network token'); // text preserved
      assert.ok(!(e instanceof SessionRevokedError));
      return true;
    });
    await assert.rejects(client._post('/missing', {}), (e) => { assert.strictEqual(e.statusCode, 404); return true; });
    await assert.rejects(client._post('/boom', {}), (e) => { assert.strictEqual(e.statusCode, 503); return true; });
    await assert.rejects(client._post('/revoked', {}), (e) => { assert.ok(e instanceof SessionRevokedError); return true; });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// 21. Heartbeat 404 (member lost server-side): classified by statusCode, counts
//     as a heartbeat failure, reconnects ONLY under the AND judgement, exactly
//     once, resets state on rejoin, never calls remote leave, and a stale
//     generation callback cannot pollute the new session.
// ---------------------------------------------------------------------------
test('heartbeat 404 → counts as failure, reconnects under AND only, no leave', async () => {
  const h = makeHarness();
  h.queueJoinSuccess('s1');   // attempt 1
  h.queueJoinSuccess('s2');   // attempt 2 after reconnect
  h.start();
  await h.flush();
  const gen1 = h.adapter._activeGen;

  // (a) Structured classification: 404 → 'ambiguous' via statusCode, not message.
  assert.strictEqual(h.adapter._classifyError(httpErr(404, 'Network not found')), 'ambiguous');
  assert.strictEqual(h.adapter._classifyError(httpErr(404, 'literally anything else')), 'ambiguous');

  // (b) AND not yet satisfied: 2 × 404 while the clock is fresh → no reconnect,
  //     but the 404s ARE counted as heartbeat failures.
  h.now = 1000;
  for (let i = 0; i < 2; i++) {
    h.settleHeartbeat('fail', httpErr(404, 'Network not found'));
    await h.flush(); h.fireSleeps(); await h.flush();
  }
  assert.strictEqual(h.adapter._activeGen, gen1, 'no reconnect before BOTH conditions met');
  assert.ok(h.adapter._consecutiveHeartbeatFailures >= 2, '404 counted as heartbeat failures');
  assert.strictEqual(h.joinCalls, 1);
  assert.strictEqual(h.disconnectCalls, 0);

  // (c) Both conditions: advance clock past the freshness window and keep 404-ing
  //     → exactly ONE reconnect (one extra join), then connected again.
  h.now = 200000;
  let guard = 0;
  while (h.adapter._activeGen === gen1 && guard++ < 6) {
    h.settleHeartbeat('fail', httpErr(404, 'Network not found'));
    await h.flush(); h.fireSleeps(); await h.flush();
  }
  assert.strictEqual(h.joinCalls, 2, 'exactly one reconnect (one additional join)');
  assert.strictEqual(h.adapter._sessionId, 's2');
  assert.notStrictEqual(h.adapter._activeGen, gen1, '_activeGen updated after rejoin');
  assert.strictEqual(h.adapter._consecutiveHeartbeatFailures, 0, 'failure count reset on rejoin');
  assert.strictEqual(h.adapter._connState, 'connected');
  assert.strictEqual(h.disconnectCalls, 0, 'reconnect never calls remote leave (/v1/leave)');

  // (d) A stale (old-generation) heartbeat callback must NOT pollute new state.
  const liveGen = h.adapter._activeGen;
  const sidBefore = h.adapter._sessionId;
  const livenessBefore = h.adapter._lastLivenessOkAt;
  const origHb = h.client.heartbeat;
  h.client.heartbeat = async () => ({ status: 'online' });  // resolves without queueing
  h.now = 999999;
  await h.adapter._heartbeatOnce(liveGen + 1000);           // a generation that is NOT active
  h.client.heartbeat = origHb;
  assert.strictEqual(h.adapter._sessionId, sidBefore, 'stale-gen hb did not change session');
  assert.strictEqual(h.adapter._activeGen, liveGen, 'stale-gen hb did not change active gen');
  assert.strictEqual(h.adapter._lastLivenessOkAt, livenessBefore, 'stale-gen hb did not refresh liveness');

  h.adapter.stop(); h.settleHeartbeat('ok'); h.fireSleeps(); await h.runPromise;
});
