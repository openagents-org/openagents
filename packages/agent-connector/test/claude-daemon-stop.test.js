'use strict';

/**
 * What a channel is told when the daemon stops the agent mid-turn.
 *
 * Field report 2026-11-13: one restart of a just-added agent left three
 * messages under the user's first message: "No response generated (exit code
 * 143). Please try again." and "Task interrupted — daemon restarting. Send
 * another message to continue." twice. The turn read the SIGTERM as a
 * failure, and the daemon calls stop() twice per restart (directly, then from
 * its checkStop poll), each call posting the notice for the same run.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ClaudeAdapter = require('../src/adapters/claude');
const { pinnedFingerprint } = require('../src/adapters/decision-log');

const INTERRUPTED = 'Task interrupted — daemon restarting. Send another message to continue.';

function mkAdapter() {
  const adapter = new ClaudeAdapter({
    workspaceId: `test-ws-${Math.random().toString(36).slice(2)}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'claude',
  });
  adapter._saveSessions = () => {};
  adapter.posted = [];
  adapter.sendStatus = async () => {};
  adapter.sendResponse = async (ch, text) => { adapter.posted.push(text); };
  adapter.sendError = async (ch, text) => { adapter.posted.push(text); };
  adapter.sendThinking = async () => {};
  adapter.getRemainingTodos = async () => [];
  adapter.getBrowserEnabled = async () => false;
  adapter._resetIdleTimer = () => {};
  adapter._titledSessions.add('general');
  adapter._fetchGlossary = async () => ({ available: true, state: 'absent', entryId: null, content: null, error: false });
  adapter._buildChannelRecap = async () => null;
  adapter._buildClaudeCmd = () => ({ cmd: ['claude'], mcpConfigFile: null });
  adapter._stopProcess = async () => {};
  return adapter;
}

/** A Claude process that runs until killed, then exits 143 like SIGTERM. */
function mkKillablePP(adapter, channel) {
  const proc = { pid: 1, exitCode: null };
  const pp = {
    alive: true,
    proc,
    msgChannel: channel,
    lastResponseText: [],
    lastErrorText: '',
    everPostedAnything: false,
    userStopped: false,
    pinnedHash: pinnedFingerprint([{ entryId: null, content: null }]),
    spawnMode: 'execute',
  };
  adapter._persistentProcs[channel] = pp;
  adapter._channelProcesses[channel] = proc;
  adapter._killPersistentProc = (ch) => {
    const p = adapter._persistentProcs[ch];
    delete adapter._persistentProcs[ch];
    if (p && p.messageResolve) {
      const resolve = p.messageResolve;
      p.messageResolve = null;
      setImmediate(() => resolve({ exited: true, code: 143 }));
    }
    return Promise.resolve();
  };
  return pp;
}

describe('a daemon stop during a turn', () => {
  it('posts one notice, not "exit code 143" and not a second notice', async () => {
    const adapter = mkAdapter();
    let spawned = 0;
    adapter._spawnPersistentProc = (channel) => { spawned++; return mkKillablePP(adapter, channel); };
    adapter._sendToPersistentProc = (pp) => new Promise((resolve) => { pp.messageResolve = resolve; });

    const turn = adapter._handleMessage({ content: '你好', sessionId: 'general' });
    await new Promise((r) => setImmediate(r));
    assert.equal(spawned, 1);

    // As the daemon does it: stopAgent, then checkStop a moment later.
    adapter.stop();
    adapter.stop();
    await turn;
    await new Promise((r) => setTimeout(r, 10));

    assert.deepEqual(adapter.posted, [INTERRUPTED]);
    assert.equal(spawned, 1, 'not retried as a stale session');
  });

  it('a turn that already finished still posts its answer', async () => {
    const adapter = mkAdapter();
    adapter._spawnPersistentProc = (channel) => mkKillablePP(adapter, channel);
    adapter._composeFinalResponse = () => 'Hello!';
    adapter._sendToPersistentProc = async () => {
      adapter.stop();
      return { resultEvent: { type: 'result', subtype: 'success' } };
    };

    await adapter._handleMessage({ content: '你好', sessionId: 'general' });
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(adapter.posted.includes('Hello!'), adapter.posted.join(' | '));
  });
});
