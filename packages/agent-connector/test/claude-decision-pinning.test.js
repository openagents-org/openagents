'use strict';

/**
 * Adapter-level tests for decision-log pinning in the Claude adapter:
 * - _fetchDecisionLog caching, 404 fallback, duplicate handling, failure mode
 * - fast-path hash check killing a stale persistent process (respawn+resume)
 * - fast-path prompt-too-long detection resetting the session VISIBLY
 * - stale-session retry announcing itself
 * - head+tail recap fetching the channel opening ascending
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ClaudeAdapter = require('../src/adapters/claude');
const { hashDecisions, decisionLogTitle } = require('../src/adapters/decision-log');

function mkAdapter(overrides = {}) {
  const adapter = new ClaudeAdapter({
    workspaceId: `test-ws-${Math.random().toString(36).slice(2)}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'claude',
    ...overrides,
  });
  // Keep tests hermetic: no session files on disk, no real posting.
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
  adapter._titledSessions.add('general'); // skip the auto-title lookup
  return adapter;
}

/** A minimal persistent-proc stub the message flow can drive. */
function mkPP(overrides = {}) {
  return {
    alive: true,
    msgChannel: 'general',
    lastResponseText: [],
    lastErrorText: '',
    everPostedAnything: false,
    userStopped: false,
    decisionHash: hashDecisions(null),
    ...overrides,
  };
}

describe('_fetchDecisionLog', () => {
  it('is inactive (with one warning) when the knowledge module is disabled', async () => {
    const adapter = mkAdapter({ disabledModules: new Set(['knowledge']) });
    const logs = [];
    adapter._log = (m) => logs.push(m);
    const first = await adapter._fetchDecisionLog('general');
    const second = await adapter._fetchDecisionLog('general');
    assert.equal(first.available, false);
    assert.equal(second.available, false);
    assert.equal(logs.filter((l) => /pinning is INACTIVE/.test(l)).length, 1);
  });

  it('lists, matches by exact title, caches the id, then reads by id', async () => {
    const adapter = mkAdapter();
    const calls = [];
    adapter.client = {
      listKnowledge: async (ws, tok, opts) => {
        calls.push(['list', opts]);
        return { entries: [
          { id: 'other', title: 'unrelated' },
          { id: 'e-1', title: decisionLogTitle('general'), created_at: '2026-07-01T00:00:00Z' },
        ] };
      },
      getKnowledge: async (ws, tok, id, opts) => {
        calls.push(['get', id, opts]);
        return { id, content: '- pinned fact' };
      },
    };

    const res = await adapter._fetchDecisionLog('general');
    assert.deepEqual(res, { available: true, entryId: 'e-1', content: '- pinned fact', error: false });
    assert.equal(adapter._decisionEntryIds.general, 'e-1');
    // Short deadline on every request.
    for (const c of calls) assert.equal(c.at(-1).timeout, adapter._DECISION_FETCH_TIMEOUT_MS);

    // Steady state: a single GET, no listing.
    calls.length = 0;
    await adapter._fetchDecisionLog('general');
    assert.deepEqual(calls.map((c) => c[0]), ['get']);
  });

  it('invalidates the cached id on 404 and re-lists', async () => {
    const adapter = mkAdapter();
    adapter._decisionEntryIds.general = 'gone';
    let listed = false;
    adapter.client = {
      getKnowledge: async (ws, tok, id) => {
        if (id === 'gone') throw new Error('Knowledge entry not found');
        return { id, content: '- recreated' };
      },
      listKnowledge: async () => {
        listed = true;
        return { entries: [{ id: 'e-2', title: decisionLogTitle('general') }] };
      },
    };
    const res = await adapter._fetchDecisionLog('general');
    assert.equal(listed, true);
    assert.equal(res.entryId, 'e-2');
    assert.equal(res.content, '- recreated');
  });

  it('reports error=true with unknown content on transient failure', async () => {
    const adapter = mkAdapter();
    adapter._decisionEntryIds.general = 'e-1';
    adapter.client = {
      getKnowledge: async () => { throw new Error('Request timed out'); },
    };
    const res = await adapter._fetchDecisionLog('general');
    assert.equal(res.error, true);
    assert.equal(res.content, null);
  });

  it('warns about duplicate titles and uses the earliest entry', async () => {
    const adapter = mkAdapter();
    const logs = [];
    adapter._log = (m) => logs.push(m);
    adapter.client = {
      listKnowledge: async () => ({ entries: [
        { id: 'late', title: decisionLogTitle('general'), created_at: '2026-07-30T00:00:00Z' },
        { id: 'early', title: decisionLogTitle('general'), created_at: '2026-07-01T00:00:00Z' },
      ] }),
      getKnowledge: async (ws, tok, id) => ({ id, content: '- x' }),
    };
    const res = await adapter._fetchDecisionLog('general');
    assert.equal(res.entryId, 'early');
    assert.ok(logs.some((l) => /2 knowledge entries share the title/.test(l)));
  });
});

describe('fast-path decision hash check', () => {
  it('respawns with resume when the decision log changed since spawn', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._fetchDecisionLog = async () => ({ available: true, entryId: 'e-1', content: '- NEW decision', error: false });

    const stalePP = mkPP({ decisionHash: hashDecisions('- old decision') });
    adapter._persistentProcs.general = stalePP;
    const killed = [];
    adapter._killPersistentProc = (ch) => { killed.push(ch); delete adapter._persistentProcs[ch]; };

    let builtOpts = null;
    adapter._buildClaudeCmd = (prompt, ch, opts) => { builtOpts = opts; return { cmd: ['claude'], mcpConfigFile: null }; };
    const freshPP = mkPP();
    adapter._spawnPersistentProc = () => freshPP;
    adapter._sendToPersistentProc = async (pp) => {
      pp.lastResponseText = ['done with new pin'];
      pp.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'next task', sessionId: 'general' });

    assert.deepEqual(killed, ['general']);
    // Session kept → the fresh spawn resumes instead of starting blank.
    assert.equal(builtOpts.skipResume, false);
    assert.equal(builtOpts.decisionLog.content, '- NEW decision');
    assert.equal(builtOpts.decisionLog.entryId, 'e-1');
    // The new process records the state it was spawned with.
    assert.equal(freshPP.decisionHash, hashDecisions('- NEW decision'));
    assert.deepEqual(adapter.responses, ['done with new pin']);
  });

  it('reuses the process when the log is unchanged', async () => {
    const adapter = mkAdapter();
    adapter._fetchDecisionLog = async () => ({ available: true, entryId: 'e-1', content: '- same', error: false });
    const pp = mkPP({ decisionHash: hashDecisions('- same') });
    adapter._persistentProcs.general = pp;
    let spawned = 0;
    adapter._spawnPersistentProc = () => { spawned++; return mkPP(); };
    adapter._sendToPersistentProc = async (p) => {
      p.lastResponseText = ['reused'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'hello', sessionId: 'general' });

    assert.equal(spawned, 0);
    assert.deepEqual(adapter.responses, ['reused']);
  });

  it('does not respawn on a failed decision fetch (unknown content is not a change)', async () => {
    const adapter = mkAdapter();
    adapter._fetchDecisionLog = async () => ({ available: true, entryId: 'e-1', content: null, error: true });
    const pp = mkPP({ decisionHash: hashDecisions('- whatever') });
    adapter._persistentProcs.general = pp;
    let spawned = 0;
    adapter._spawnPersistentProc = () => { spawned++; return mkPP(); };
    adapter._sendToPersistentProc = async (p) => {
      p.lastResponseText = ['still here'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'hello', sessionId: 'general' });

    assert.equal(spawned, 0);
    assert.deepEqual(adapter.responses, ['still here']);
  });
});

describe('context-limit and stale-session visibility', () => {
  it('fast-path prompt-too-long resets the session, announces it, and retries fresh', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._fetchDecisionLog = async () => ({ available: true, entryId: null, content: '', error: false });
    adapter._buildChannelRecap = async () => 'RECAP';

    const pp = mkPP();
    adapter._persistentProcs.general = pp;
    adapter._killPersistentProc = (ch) => { delete adapter._persistentProcs[ch]; };

    let builtPrompt = null;
    adapter._buildClaudeCmd = (prompt, ch, opts) => { builtPrompt = prompt; return { cmd: ['claude'], mcpConfigFile: null }; };
    adapter._spawnPersistentProc = () => mkPP();
    let call = 0;
    adapter._sendToPersistentProc = async (p) => {
      call++;
      if (call === 1) {
        p.lastResponseText = ['Prompt is too long'];
        p.everPostedAnything = true;
        return { resultEvent: {} };
      }
      p.lastResponseText = ['recovered'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'go on', sessionId: 'general' });

    assert.ok(adapter.statuses.some((s) => /context reached its limit/i.test(s)));
    assert.equal(adapter._channelSessions.general, undefined);
    // The raw overflow error never reaches the user as a chat reply.
    assert.deepEqual(adapter.responses, ['recovered']);
    // Fresh session had no id left → recap prepended.
    assert.ok(builtPrompt.startsWith('RECAP'));
  });

  it('stale-session retry posts a visible status', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._fetchDecisionLog = async () => ({ available: false, entryId: null, content: null, error: false });
    adapter._buildChannelRecap = async () => null;
    adapter._buildClaudeCmd = () => ({ cmd: ['claude'], mcpConfigFile: null });
    adapter._killPersistentProc = () => {};
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

describe('_buildChannelRecap head+tail sampling', () => {
  it('fetches the channel opening ascending and merges it before the tail', async () => {
    const adapter = mkAdapter();
    const fetches = [];
    adapter.client = {
      getRecentMessages: async (ws, ch, tok, limit, opts = {}) => {
        fetches.push({ limit, sort: opts.sort || 'desc' });
        const mk = (id, content) => ({ messageId: id, content, senderType: 'human', senderName: 'u', messageType: 'chat' });
        if (opts.sort === 'asc') return [mk('h1', 'original requirement')];
        return [mk('t1', 'latest talk')];
      },
    };

    const recap = await adapter._buildChannelRecap('general', 'current msg');

    assert.deepEqual(fetches, [{ limit: 15, sort: 'asc' }, { limit: 60, sort: 'desc' }]);
    const headIdx = recap.indexOf('original requirement');
    const tailIdx = recap.indexOf('latest talk');
    assert.ok(headIdx !== -1 && tailIdx !== -1 && headIdx < tailIdx);
    assert.ok(recap.includes('[… earlier messages omitted …]'));
  });
});
