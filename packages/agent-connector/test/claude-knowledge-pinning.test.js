'use strict';

/**
 * Adapter-level tests for knowledge pinning in the Claude adapter:
 * - pinned-entry fetch caching, 404 fallback, duplicate handling, failure mode
 * - fast-path hash check killing a stale persistent process (respawn+resume)
 * - fast-path prompt-too-long detection resetting the session VISIBLY
 * - stale-session retry announcing itself
 * - head+tail recap fetching the channel opening ascending
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ClaudeAdapter = require('../src/adapters/claude');
const { glossaryTitle, pinnedFingerprint } = require('../src/adapters/decision-log');

/** Pin fingerprint of the glossary. */
function pinHash(entryId = null, content = null) {
  return pinnedFingerprint([{ entryId, content }]);
}

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
  // Message-flow tests stub _fetchGlossary per case; default it to absent so
  // no test reaches the network.
  adapter._fetchGlossary = async () => ({ available: true, state: 'absent', entryId: null, content: null, error: false });
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
    pinnedHash: pinHash(),
    spawnMode: 'execute',
    ...overrides,
  };
}

describe('_fetchGlossary (pinned-entry fetch)', () => {
  // mkAdapter stubs the glossary fetch for the message-flow tests; drop the
  // stub here so the real fetch runs.
  const real = (overrides) => { const a = mkAdapter(overrides); delete a._fetchGlossary; return a; };

  it('is inactive (with one warning) when the knowledge module is disabled', async () => {
    const adapter = real({ disabledModules: new Set(['knowledge']) });
    const logs = [];
    adapter._log = (m) => logs.push(m);
    const first = await adapter._fetchGlossary('general');
    const second = await adapter._fetchGlossary('general');
    assert.equal(first.available, false);
    assert.equal(second.available, false);
    assert.equal(logs.filter((l) => /pinning is INACTIVE/.test(l)).length, 1);
  });

  it('lists, matches by exact title, caches the id, then reads by id', async () => {
    const adapter = real();
    const calls = [];
    adapter.client = {
      listKnowledge: async (ws, tok, opts) => {
        calls.push(['list', opts]);
        return { entries: [
          { id: 'other', title: 'unrelated' },
          { id: 'e-1', title: glossaryTitle('general'), created_at: '2026-07-01T00:00:00Z' },
        ] };
      },
      getKnowledge: async (ws, tok, id, opts) => {
        calls.push(['get', id, opts]);
        return { id, content: '- pinned fact' };
      },
    };

    const res = await adapter._fetchGlossary('general');
    assert.deepEqual(res, { available: true, state: 'found', entryId: 'e-1', title: glossaryTitle('general'), content: '- pinned fact', error: false, scope: 'channel' });
    assert.equal(adapter._glossaryEntryIds.general, 'e-1');
    // Short deadline on every request.
    for (const c of calls) assert.equal(c.at(-1).timeout, adapter._DECISION_FETCH_TIMEOUT_MS);

    // Steady state: a single GET, no listing.
    calls.length = 0;
    await adapter._fetchGlossary('general');
    assert.deepEqual(calls.map((c) => c[0]), ['get']);
  });

  it('invalidates the cached id on 404 and re-lists', async () => {
    const adapter = real();
    adapter._glossaryEntryIds.general = 'gone';
    let listed = false;
    adapter.client = {
      getKnowledge: async (ws, tok, id) => {
        if (id === 'gone') throw new Error('Knowledge entry not found');
        return { id, content: '- recreated' };
      },
      listKnowledge: async () => {
        listed = true;
        return { entries: [{ id: 'e-2', title: glossaryTitle('general') }] };
      },
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(listed, true);
    assert.equal(res.entryId, 'e-2');
    assert.equal(res.content, '- recreated');
  });

  it('reports error=true with unknown content on transient failure', async () => {
    const adapter = real();
    adapter._glossaryEntryIds.general = 'e-1';
    adapter.client = {
      getKnowledge: async () => { throw new Error('Request timed out'); },
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.error, true);
    assert.equal(res.content, null);
    // The id is still known, so the state stays found — not unknown.
    assert.equal(res.state, 'found');
  });

  it('reports state unknown on cold-start failure so the prompt cannot claim absence', async () => {
    const adapter = real();
    adapter.client = {
      listKnowledge: async () => { throw new Error('Request timed out'); },
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.error, true);
    assert.equal(res.state, 'unknown');
    assert.equal(res.entryId, null);
  });

  it('treats a soft-deleted cached entry as gone and re-lists', async () => {
    const adapter = real();
    adapter._glossaryEntryIds.general = 'dead';
    let listed = false;
    adapter.client = {
      // The backend keeps deleted rows readable by id with status "deleted".
      getKnowledge: async (ws, tok, id) => {
        if (id === 'dead') return { id, status: 'deleted', content: '- stale definition' };
        return { id, status: 'active', content: '- fresh definition' };
      },
      listKnowledge: async () => {
        listed = true;
        return { entries: [{ id: 'e-new', title: glossaryTitle('general'), status: 'active' }] };
      },
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(listed, true);
    assert.equal(res.entryId, 'e-new');
    assert.equal(res.content, '- fresh definition');
    assert.equal(res.state, 'found');
  });

  it('reports absent when the entry vanishes between listing and read', async () => {
    const adapter = real();
    adapter.client = {
      listKnowledge: async () => ({ entries: [{ id: 'e-1', title: glossaryTitle('general') }] }),
      getKnowledge: async (ws, tok, id) => ({ id, status: 'deleted', content: '- was here' }),
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.state, 'absent');
    assert.equal(res.entryId, null);
    assert.equal(adapter._glossaryEntryIds.general, undefined);
  });

  it('warns about duplicate titles and uses the earliest entry', async () => {
    const adapter = real();
    const logs = [];
    adapter._log = (m) => logs.push(m);
    adapter.client = {
      listKnowledge: async () => ({ entries: [
        { id: 'late', title: glossaryTitle('general'), created_at: '2026-07-30T00:00:00Z' },
        { id: 'early', title: glossaryTitle('general'), created_at: '2026-07-01T00:00:00Z' },
      ] }),
      getKnowledge: async (ws, tok, id) => ({ id, content: '- x' }),
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.entryId, 'early');
    assert.ok(logs.some((l) => /2 knowledge entries share the title/.test(l)));
  });
});

describe('fast-path pinned hash check', () => {
  it('hands a changed glossary to the running session instead of restarting it', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._fetchGlossary = async () => ({ available: true, state: 'found', entryId: 'e-1', content: '- NEW definition', error: false });

    const livePP = mkPP({ pinnedHash: pinHash('e-1', '- old definition') });
    adapter._persistentProcs.general = livePP;
    const killed = [];
    adapter._killPersistentProc = async (ch) => { killed.push(ch); delete adapter._persistentProcs[ch]; };
    let spawned = 0;
    adapter._spawnPersistentProc = () => { spawned++; return mkPP(); };
    let sent = null;
    adapter._sendToPersistentProc = async (pp, content) => {
      sent = { pp, content };
      pp.lastResponseText = ['done with new pin'];
      pp.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'next task', sessionId: 'general' });

    // No restart: a restart kills background sub-agents mid-work.
    assert.deepEqual(killed, []);
    assert.equal(spawned, 0);
    assert.equal(sent.pp, livePP);
    // The new version rides in ahead of the message and supersedes the old pin.
    assert.match(sent.content, /Pinned knowledge was updated/);
    assert.match(sent.content, /- NEW definition/);
    assert.ok(sent.content.endsWith('next task'));
    // Recorded as pinned, so the next message does not repeat the update.
    assert.equal(livePP.pinnedHash, pinHash('e-1', '- NEW definition'));
    assert.deepEqual(adapter.responses, ['done with new pin']);
  });

  it('sends the pinned update only once', async () => {
    const adapter = mkAdapter();
    adapter._fetchGlossary = async () => ({ available: true, state: 'found', entryId: 'e-1', content: '- NEW definition', error: false });
    adapter._persistentProcs.general = mkPP({ pinnedHash: pinHash('e-1', '- old definition') });
    const contents = [];
    adapter._sendToPersistentProc = async (pp, content) => {
      contents.push(content);
      pp.lastResponseText = ['ok'];
      pp.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'first', sessionId: 'general' });
    await adapter._handleMessage({ content: 'second', sessionId: 'general' });

    assert.match(contents[0], /Pinned knowledge was updated/);
    assert.equal(contents[1], 'second');
  });

  it('still respawns with resume when the mode changed', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    adapter._fetchGlossary = async () => ({ available: true, state: 'found', entryId: 'e-1', content: '- same', error: false });
    adapter._persistentProcs.general = mkPP({ pinnedHash: pinHash('e-1', '- same'), spawnMode: 'plan' });
    const killed = [];
    adapter._killPersistentProc = async (ch) => { killed.push(ch); delete adapter._persistentProcs[ch]; };
    let builtOpts = null;
    adapter._buildClaudeCmd = (prompt, ch, opts) => { builtOpts = opts; return { cmd: ['claude'], mcpConfigFile: null }; };
    adapter._spawnPersistentProc = () => mkPP();
    adapter._sendToPersistentProc = async (pp) => {
      pp.lastResponseText = ['respawned'];
      pp.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'go', sessionId: 'general' });

    assert.deepEqual(killed, ['general']);
    assert.equal(builtOpts.skipResume, false);
  });

  it('passes a recreated entry (new id, same content) to the running session', async () => {
    const adapter = mkAdapter();
    adapter._channelSessions.general = 'sess-1';
    // Same content, but the entry was deleted and recreated under a new id —
    // the prompt still pins the old id, so the update must name the new one.
    adapter._fetchGlossary = async () => ({ available: true, state: 'found', entryId: 'e-recreated', content: '- same content', error: false });
    adapter._persistentProcs.general = mkPP({ pinnedHash: pinHash('e-original', '- same content') });
    const killed = [];
    adapter._killPersistentProc = async (ch) => { killed.push(ch); delete adapter._persistentProcs[ch]; };
    let sent = '';
    adapter._sendToPersistentProc = async (p, content) => {
      sent = content;
      p.lastResponseText = ['ok'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };

    await adapter._handleMessage({ content: 'go', sessionId: 'general' });

    assert.deepEqual(killed, []);
    // The update names the new entry id, so later edits target the right entry.
    assert.match(sent, /e-recreated/);
  });

  it('reuses the process when the glossary is unchanged', async () => {
    const adapter = mkAdapter();
    adapter._fetchGlossary = async () => ({ available: true, state: 'found', entryId: 'e-1', content: '- same', error: false });
    const pp = mkPP({ pinnedHash: pinHash('e-1', '- same') });
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

  it('does not respawn on a failed glossary fetch (unknown content is not a change)', async () => {
    const adapter = mkAdapter();
    adapter._fetchGlossary = async () => ({ available: true, state: 'found', entryId: 'e-1', content: null, error: true });
    const pp = mkPP({ pinnedHash: pinHash('e-1', '- whatever') });
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
    adapter._fetchGlossary = async () => ({ available: true, entryId: null, content: '', error: false });
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
    adapter._fetchGlossary = async () => ({ available: false, entryId: null, content: null, error: false });
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

describe('fast-path mode staleness check', () => {
  // Mode is baked into the spawn twice over — the system prompt and the CLI
  // permission flags (plan is read-only, execute skips permissions) — so a
  // process from the other mode must never be reused.
  const runModeSwitch = async (fromMode, toMode) => {
    const adapter = mkAdapter();
    adapter._mode = toMode;
    adapter._channelSessions.general = 'sess-1';
    adapter._fetchGlossary = async () => ({ available: true, state: 'absent', entryId: null, content: null, error: false });
    adapter._persistentProcs.general = mkPP({ spawnMode: fromMode });
    const killed = [];
    adapter._killPersistentProc = async (ch) => { killed.push(ch); delete adapter._persistentProcs[ch]; };
    let builtOpts = null;
    adapter._buildClaudeCmd = (prompt, ch, opts) => { builtOpts = opts; return { cmd: ['claude'], mcpConfigFile: null }; };
    const freshPP = mkPP({ spawnMode: toMode });
    adapter._spawnPersistentProc = () => freshPP;
    adapter._sendToPersistentProc = async (p) => {
      p.lastResponseText = ['ok'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };
    await adapter._handleMessage({ content: 'go', sessionId: 'general' });
    return { adapter, killed, builtOpts, freshPP };
  };

  it('plan-spawned process is replaced once the mode switches to execute', async () => {
    const { killed, builtOpts, freshPP } = await runModeSwitch('plan', 'execute');
    assert.deepEqual(killed, ['general']);
    assert.equal(builtOpts.skipResume, false); // history survives via resume
    assert.equal(freshPP.spawnMode, 'execute');
  });

  it('execute-spawned process is replaced once the mode switches to plan', async () => {
    const { killed, freshPP } = await runModeSwitch('execute', 'plan');
    assert.deepEqual(killed, ['general']);
    assert.equal(freshPP.spawnMode, 'plan');
  });

  it('same mode keeps reusing the process', async () => {
    const adapter = mkAdapter();
    adapter._fetchGlossary = async () => ({ available: true, state: 'absent', entryId: null, content: null, error: false });
    adapter._persistentProcs.general = mkPP({ spawnMode: 'execute' });
    let spawned = 0;
    adapter._spawnPersistentProc = () => { spawned++; return mkPP(); };
    adapter._sendToPersistentProc = async (p) => {
      p.lastResponseText = ['reused'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };
    await adapter._handleMessage({ content: 'hi', sessionId: 'general' });
    assert.equal(spawned, 0);
    assert.deepEqual(adapter.responses, ['reused']);
  });

  it('a failed glossary fetch does not keep a wrong-mode process alive', async () => {
    const adapter = mkAdapter();
    adapter._mode = 'execute';
    adapter._fetchGlossary = async () => ({ available: true, state: 'unknown', entryId: null, content: null, error: true });
    adapter._persistentProcs.general = mkPP({ spawnMode: 'plan' });
    const killed = [];
    adapter._killPersistentProc = async (ch) => { killed.push(ch); delete adapter._persistentProcs[ch]; };
    adapter._buildClaudeCmd = () => ({ cmd: ['claude'], mcpConfigFile: null });
    adapter._buildChannelRecap = async () => null;
    adapter._spawnPersistentProc = () => mkPP();
    adapter._sendToPersistentProc = async (p) => {
      p.lastResponseText = ['ok'];
      p.everPostedAnything = true;
      return { resultEvent: {} };
    };
    await adapter._handleMessage({ content: 'run it', sessionId: 'general' });
    assert.deepEqual(killed, ['general']);
  });
});

describe('process registration race', () => {
  it('a predecessor exit never unhooks the replacement registration', () => {
    const adapter = mkAdapter();
    const oldProc = {};
    const oldPP = mkPP();
    const newProc = {};
    const newPP = mkPP();
    // The replacement is already registered when the killed predecessor's
    // exit event finally fires.
    adapter._persistentProcs.general = newPP;
    adapter._channelProcesses.general = newProc;

    adapter._unregisterProc('general', oldPP, oldProc);
    assert.equal(adapter._persistentProcs.general, newPP);
    assert.equal(adapter._channelProcesses.general, newProc);

    // The registered process unhooks itself normally.
    adapter._unregisterProc('general', newPP, newProc);
    assert.equal(adapter._persistentProcs.general, undefined);
    assert.equal(adapter._channelProcesses.general, undefined);
  });

  it('_killPersistentProc resolves and deregisters before the stop settles', async () => {
    const adapter = mkAdapter();
    let stopped = false;
    adapter._stopProcess = async () => { stopped = true; };
    adapter._persistentProcs.general = mkPP({ proc: {} });

    await adapter._killPersistentProc('general');
    assert.equal(stopped, true);
    assert.equal(adapter._persistentProcs.general, undefined);
    // Killing a channel with no process is a settled no-op.
    await adapter._killPersistentProc('general');
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

    assert.deepEqual(fetches, [{ limit: 30, sort: 'asc' }, { limit: 60, sort: 'desc' }]);
    const headIdx = recap.indexOf('original requirement');
    const tailIdx = recap.indexOf('latest talk');
    assert.ok(headIdx !== -1 && tailIdx !== -1 && headIdx < tailIdx);
    assert.ok(recap.includes('[… earlier messages omitted …]'));
  });

  // OA-026: the caller's content already carries the thread-history block,
  // so the trigger must be excluded by event, not by text.
  it('leaves out the trigger and anything posted after it', async () => {
    const adapter = mkAdapter();
    const tailOpts = [];
    const mk = (id, content, at) => ({
      messageId: id, content, createdAt: at, senderType: 'human', senderName: 'u', messageType: 'chat',
    });
    adapter.client = {
      getRecentMessages: async (ws, ch, tok, limit, opts = {}) => {
        if (opts.sort === 'asc') {
          return [mk('m1', 'opening', '2026-10-01T00:00:00Z'), mk('m2', 'please fix', '2026-10-01T00:01:00Z'),
            mk('m3', 'queued follow-up', '2026-10-01T00:02:00Z')];
        }
        tailOpts.push(opts);
        return [mk('m1', 'opening', '2026-10-01T00:00:00Z')];
      },
    };

    const recap = await adapter._buildChannelRecap('general', 'please fix',
      { messageId: 'm2', createdAt: '2026-10-01T00:01:00Z' });

    assert.equal(tailOpts[0].before, 'm2');
    assert.ok(recap.includes('opening'));
    assert.ok(!recap.includes('please fix'));
    assert.ok(!recap.includes('queued follow-up'));
  });
});
