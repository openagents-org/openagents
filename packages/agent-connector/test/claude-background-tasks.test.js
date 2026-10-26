'use strict';
/**
 * Background work and session restarts in the Claude adapter.
 *
 * Regression for a thread where, right after the agent answered, a
 * decision-log edit restarted its process (killing a background sub-agent),
 * the resumed session's leftover empty result was posted as "the agent hit an
 * error", and the plan nudge made it re-launch the work.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

// claude.js destructures `spawn` from ../wsl at load time, so install a
// swappable spawn before requiring it; tests point it at a fake CLI.
const wsl = require('../src/wsl');
let spawnImpl = null;
const realWslSpawn = wsl.spawn;
wsl.spawn = (...args) => (spawnImpl ? spawnImpl(...args) : realWslSpawn(...args));

const ClaudeAdapter = require('../src/adapters/claude');

function mkAdapter() {
  const adapter = new ClaudeAdapter({
    workspaceId: `test-ws-${Math.random().toString(36).slice(2)}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'claude',
  });
  adapter._saveSessions = () => {};
  adapter.responses = [];
  adapter.errors = [];
  adapter.statuses = [];
  adapter.sendStatus = async (ch, t) => { adapter.statuses.push(t); };
  adapter.sendResponse = async (ch, t) => { adapter.responses.push(t); };
  adapter.sendError = async (ch, t) => { adapter.errors.push(t); };
  adapter.sendThinking = async () => {};
  adapter.sendTodos = async () => {};
  adapter.getBrowserEnabled = async () => false;
  adapter._resetIdleTimer = () => {};
  adapter._titledSessions.add('general');
  adapter._fetchDecisionLog = async () => ({ available: false });
  adapter._fetchGlossary = async () => ({ available: false });
  return adapter;
}

/** A fake CLI process whose stdout we drive line by line. */
function fakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { written: [], write(s) { this.written.push(s); } };
  proc.kill = () => {};
  proc.pid = 4242;
  proc.emitLine = (obj) => proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
  return proc;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (pp) => { await tick(); await pp.pendingLines; await tick(); };

describe('plan nudge vs background work', () => {
  it('holds the nudge while background tasks run', async () => {
    const adapter = mkAdapter();
    adapter.getRemainingTodos = async () => [{ content: 'merge and deploy', status: 'pending' }];
    adapter._persistentProcs.general = { alive: true, backgroundTasks: 1 };

    await adapter._queueTodoNudge('general', { content: 'do the work' });

    assert.equal((adapter._channelQueues.general || []).length, 0);
  });

  it('nudges as before when nothing runs in the background', async () => {
    const adapter = mkAdapter();
    adapter.getRemainingTodos = async () => [{ content: 'merge and deploy', status: 'pending' }];
    adapter._persistentProcs.general = { alive: true, backgroundTasks: 0 };

    await adapter._queueTodoNudge('general', { content: 'do the work' });

    assert.equal(adapter._channelQueues.general.length, 1);
    assert.equal(adapter._channelQueues.general[0]._todoNudge, true);
  });

  it('never queues two nudges for the same channel', async () => {
    const adapter = mkAdapter();
    adapter.getRemainingTodos = async () => [{ content: 'x', status: 'pending' }];

    await adapter._queueTodoNudge('general', { content: 'a' });
    await adapter._queueTodoNudge('general', { content: 'b' });

    assert.equal(adapter._channelQueues.general.length, 1);
  });

  it('resumes the plan as its own turn once background work finishes on an idle channel', async () => {
    const adapter = mkAdapter();
    adapter.getRemainingTodos = async () => [{ content: 'merge and deploy', status: 'pending' }];
    adapter._persistentProcs.general = { alive: true, backgroundTasks: 0 };
    const started = [];
    adapter._channelWorker = (ch, msg) => { started.push([ch, msg]); };

    await adapter._resumePlanAfterBackground('general');

    assert.equal(started.length, 1);
    assert.equal(started[0][1]._todoNudge, true);
    assert.match(started[0][1].content, /merge and deploy/);
  });

  it('queues the resumed plan behind a busy channel instead of starting a second worker', async () => {
    const adapter = mkAdapter();
    adapter.getRemainingTodos = async () => [{ content: 'merge', status: 'pending' }];
    adapter._channelBusy.add('general');
    let workers = 0;
    adapter._channelWorker = () => { workers++; };

    await adapter._resumePlanAfterBackground('general');

    assert.equal(workers, 0);
    assert.equal(adapter._channelQueues.general.length, 1);
  });
});

describe('stream handling (fake CLI)', () => {
  function attach(adapter) {
    const proc = fakeProc();
    spawnImpl = () => proc;
    try {
      const pp = adapter._spawnPersistentProc('general', ['claude'], process.env);
      return { pp, proc };
    } finally {
      spawnImpl = null;
    }
  }

  it('tracks background_tasks_changed and holds then resumes the plan', async () => {
    const adapter = mkAdapter();
    const remaining = [{ content: 'merge and deploy', status: 'pending' }];
    adapter.getRemainingTodos = async () => remaining;
    const started = [];
    adapter._channelWorker = (ch, msg) => { started.push(msg); };
    const { pp, proc } = attach(adapter);
    assert.equal(pp.proc, proc);

    proc.emitLine({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'a1' }] });
    await settle(pp);
    assert.equal(pp.backgroundTasks, 1);

    await adapter._queueTodoNudge('general', { content: 'turn' });
    assert.equal((adapter._channelQueues.general || []).length, 0);

    // The task finishes; the CLI runs its own wrap-up turn.
    proc.emitLine({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
    proc.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'Background build finished.' }] } });
    proc.emitLine({ type: 'result', is_error: false, result: 'Background build finished.', session_id: 's1' });
    await settle(pp);

    assert.equal(pp.backgroundTasks, 0);
    assert.deepEqual(adapter.responses, ['Background build finished.']);
    assert.equal(started.length, 1);
    assert.equal(started[0]._todoNudge, true);
    adapter._stopWatchdog(pp);
    if (pp.idleTimer) clearTimeout(pp.idleTimer);
  });

  it('does not replay the completed answer when a background task reports later', async () => {
    const adapter = mkAdapter();
    adapter.getRemainingTodos = async () => [];
    const { pp, proc } = attach(adapter);
    try {
      const turn = adapter._sendToPersistentProc(pp, 'Fix the issue');
      proc.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'The fix is committed.' }] } });
      proc.emitLine({ type: 'result', session_id: 's1' });
      await turn;
      await adapter._postTurnOutcome(pp, 'general', adapter._composeFinalResponse(pp));
      // No new user message resets the buffer before this background turn.
      proc.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'The background search timed out.' }] } });
      proc.emitLine({ type: 'result', session_id: 's1' });
      await settle(pp);
      assert.deepEqual(adapter.responses, ['The fix is committed.', 'The background search timed out.']);
      proc.emitLine({ type: 'result', session_id: 's1' });
      await settle(pp);
      assert.equal(adapter.responses.length, 2);
    } finally {
      adapter._stopWatchdog(pp);
      if (pp.idleTimer) clearTimeout(pp.idleTimer);
    }
  });

  it('waits past an empty leftover result after resume instead of posting an error', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter.getRemainingTodos = async () => [];
    const proc = fakeProc();
    adapter._buildClaudeCmd = () => ({ cmd: ['claude'], mcpConfigFile: null });
    spawnImpl = () => proc;
    let pp;
    const realSpawnPP = adapter._spawnPersistentProc.bind(adapter);
    adapter._spawnPersistentProc = (...a) => { pp = realSpawnPP(...a); return pp; };
    try {
      const done = adapter._handleMessage({ content: 'continue', sessionId: 'general' });
      for (let i = 0; i < 50 && !pp; i++) await new Promise((r) => setTimeout(r, 10));
      assert.ok(pp, 'process spawned');
      assert.equal(pp.proc, proc);
      // Leftover from before the restart: a result with no text, no error.
      proc.emitLine({ type: 'result', is_error: true, result: '', session_id: 'sess-1' });
      await settle(pp);
      // Then the real turn.
      proc.emitLine({ type: 'assistant', message: { content: [{ type: 'text', text: 'Resumed the frontend agent.' }] } });
      proc.emitLine({ type: 'result', is_error: false, result: 'Resumed the frontend agent.', session_id: 'sess-1' });
      await done;
    } finally {
      spawnImpl = null;
    }

    assert.deepEqual(adapter.errors, []);
    assert.deepEqual(adapter.responses, ['Resumed the frontend agent.']);
    // The session survives, so the next restart still resumes the conversation.
    assert.equal(adapter._channelSessions.general, 'sess-1');
    adapter._stopWatchdog(pp);
    if (pp.idleTimer) clearTimeout(pp.idleTimer);
  });
});
