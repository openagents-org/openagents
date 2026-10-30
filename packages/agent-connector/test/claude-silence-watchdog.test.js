'use strict';

/**
 * What the channel is told when Claude goes silent long enough for the
 * watchdog to stop it.
 *
 * Field report 2026-10-29 (Windows): one message produced, over 15 minutes,
 * three "Agent process became unresponsive and was restarted.", two
 * "No response generated (exit code unknown).", and the Anthropic API's own
 * "Request timed out" in between. The watchdog posted its own notice and the
 * caller posted another; on a fresh spawn the silence was taken for a session
 * that failed to resume, so the session was dropped and the turn run again.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ClaudeAdapter = require('../src/adapters/claude');
const { pinnedFingerprint } = require('../src/adapters/decision-log');

function mkAdapter() {
  const adapter = new ClaudeAdapter({
    workspaceId: `test-ws-${Math.random().toString(36).slice(2)}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'claude',
  });
  adapter._saveSessions = () => {};
  adapter.statuses = [];
  adapter.responses = [];
  adapter.errors = [];
  adapter.sendStatus = async (ch, text) => { adapter.statuses.push(text); };
  adapter.sendResponse = async (ch, text) => { adapter.responses.push(text); };
  adapter.sendError = async (ch, text) => { adapter.errors.push(text); };
  adapter.sendThinking = async () => {};
  adapter.getRemainingTodos = async () => [];
  adapter.getBrowserEnabled = async () => false;
  adapter._resetIdleTimer = () => {};
  adapter._titledSessions.add('general');
  adapter._fetchGlossary = async () => ({ available: true, state: 'absent', entryId: null, content: null, error: false });
  adapter._buildChannelRecap = async () => null;
  adapter._buildClaudeCmd = () => ({ cmd: ['claude'], mcpConfigFile: null });
  adapter._killPersistentProc = (ch) => { delete adapter._persistentProcs[ch]; };
  return adapter;
}

function mkPP(overrides = {}) {
  return {
    alive: true,
    msgChannel: 'general',
    lastResponseText: [],
    lastErrorText: '',
    everPostedAnything: false,
    userStopped: false,
    pinnedHash: pinnedFingerprint([{ entryId: null, content: null }]),
    spawnMode: 'execute',
    ...overrides,
  };
}

const SILENT = { exited: true, watchdog: true, stderrTail: '', error: new Error('watchdog timeout') };

describe('the watchdog itself', () => {
  it('stops the turn and leaves the telling to the caller', async () => {
    const adapter = mkAdapter();
    adapter._WATCHDOG_INTERVAL_MS = 10;
    adapter._WATCHDOG_MAX_TIMEOUTS = 2;
    const killed = [];
    adapter._killPersistentProc = (ch) => { killed.push(ch); };
    const pp = mkPP({ stderrBuf: 'some stderr line' });
    const result = await new Promise((resolve) => {
      pp.messageResolve = (r) => { adapter._stopWatchdog(pp); resolve(r); };
      adapter._startWatchdog(pp);
      pp.lastStdoutTime = 0;
    });
    assert.equal(result.watchdog, true);
    assert.equal(result.exited, true);
    assert.equal(result.stderrTail, 'some stderr line');
    assert.deepEqual(killed, ['general']);
    assert.deepEqual(adapter.errors, [], 'no notice of its own');
  });
});

describe('a fresh process that goes silent', () => {
  it('posts one notice naming the likely cause, keeps the session, and does not rerun', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    let spawned = 0;
    adapter._spawnPersistentProc = () => { spawned++; return mkPP(); };
    adapter._sendToPersistentProc = async () => SILENT;

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(spawned, 1, 'not run a second time');
    assert.equal(adapter._channelSessions.general, 'sess-1', 'session kept');
    assert.ok(!adapter.statuses.some((s) => /could not be resumed/i.test(s)), adapter.statuses.join(' | '));
    assert.equal(adapter.errors.length, 1, adapter.errors.join(' | '));
    assert.match(adapter.errors[0], /no output for 5 minutes/);
    assert.match(adapter.errors[0], /model API \(or the relay this agent uses\) is not responding/);
    assert.ok(!adapter.errors.some((e) => /No response generated/.test(e)));
  });

  it('quotes what the CLI wrote to stderr', async () => {
    const adapter = mkAdapter();
    adapter._spawnPersistentProc = () => mkPP();
    adapter._sendToPersistentProc = async () => ({ ...SILENT, stderrTail: 'API Error: Connection error.' });

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(adapter.errors.length, 1);
    assert.match(adapter.errors[0], /```\nAPI Error: Connection error\.\n```/);
  });

  it('still treats a process that exited on its own as a stale session', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._spawnPersistentProc = () => mkPP();
    let call = 0;
    adapter._sendToPersistentProc = async (p) => {
      call++;
      if (call === 1) return { exited: true, code: 1 };
      p.lastResponseText = ['fresh answer'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.ok(adapter.statuses.some((s) => /could not be resumed/i.test(s)));
    assert.deepEqual(adapter.responses, ['fresh answer']);
  });
});

describe('a long-lived process that goes silent', () => {
  it('is restarted once, with a status saying so, and the message sent again', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._persistentProcs.general = mkPP();
    let spawned = 0;
    adapter._spawnPersistentProc = () => { spawned++; return mkPP(); };
    let call = 0;
    adapter._sendToPersistentProc = async (p) => {
      call++;
      if (call === 1) return SILENT;
      p.lastResponseText = ['answer after restart'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(spawned, 1);
    assert.ok(adapter.statuses.some((s) => /Restarting it and sending your message again/.test(s)), adapter.statuses.join(' | '));
    assert.deepEqual(adapter.errors, []);
    assert.deepEqual(adapter.responses, ['answer after restart']);
  });

  it('stops after the restart goes silent too, with one notice', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._persistentProcs.general = mkPP();
    let spawned = 0;
    adapter._spawnPersistentProc = () => { spawned++; return mkPP(); };
    adapter._sendToPersistentProc = async () => SILENT;

    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });

    assert.equal(spawned, 1, 'two silences in all, not three');
    assert.equal(adapter.errors.length, 1, adapter.errors.join(' | '));
    assert.match(adapter.errors[0], /no output for 5 minutes/);
  });
});

describe('Claude Code\'s api_retry event', () => {
  const adapter = mkAdapter();

  it('reads as a status naming the attempt and the HTTP status', () => {
    assert.equal(
      adapter._apiRetryStatus({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, error_status: 529, error: 'overloaded' }),
      "Claude's API request failed (HTTP 529), retrying (2/10)…",
    );
  });

  it('names the error when there is no status (a request that timed out)', () => {
    assert.equal(
      adapter._apiRetryStatus({ attempt: 1, max_retries: 10, error_status: null, error: 'timeout' }),
      "Claude's API request failed (timeout), retrying (1/10)…",
    );
  });

  it('redacts what it quotes', () => {
    const s = adapter._apiRetryStatus({ attempt: 1, error: 'bad key sk-abcdef1234567890xyz' });
    assert.ok(!s.includes('sk-abcdef1234567890xyz'), s);
  });

  it('shows nothing for an event without an attempt number', () => {
    assert.equal(adapter._apiRetryStatus({ subtype: 'api_retry' }), '');
  });
});
