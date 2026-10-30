'use strict';

/**
 * Tests for knowledge pinning shared across adapters:
 * - BaseAdapter._fetchGlossary channel→workspace fallback and caching
 * - BaseAdapter.pinnedPromptOpts / _prefetchPinnedContext gating
 * - the knowledge-disabled status warning (once per channel)
 * - glossary prompt sections
 * - buildOpenclawSystemPrompt / buildOpenCodeSystemPrompt opt-in
 * - the Claude MCP allowlist naming the knowledge tools the glossary
 *   protocol instructs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const BaseAdapter = require('../src/adapters/base');
const ClaudeAdapter = require('../src/adapters/claude');
const {
  glossaryTitle,
  WORKSPACE_GLOSSARY_TITLE,
  pinnedFingerprint,
  decisionFingerprint,
} = require('../src/adapters/decision-log');
const {
  buildGlossaryPrompt,
  buildOpenclawSystemPrompt,
  buildOpenCodeSystemPrompt,
} = require('../src/adapters/workspace-prompt');

function mkBase(overrides = {}) {
  const adapter = new BaseAdapter({
    workspaceId: `test-ws-${Math.random().toString(36).slice(2)}`,
    channelName: 'general',
    token: 'tok',
    agentName: 'agent',
  });
  adapter.disabledModules = new Set();
  adapter.statuses = [];
  adapter.sendStatus = async (ch, text) => { adapter.statuses.push(text); };
  Object.assign(adapter, overrides);
  return adapter;
}

describe('BaseAdapter._fetchGlossary', () => {
  it('prefers the channel-specific glossary over the workspace one', async () => {
    const adapter = mkBase();
    adapter.client = {
      listKnowledge: async () => ({ entries: [
        { id: 'ws-g', title: WORKSPACE_GLOSSARY_TITLE },
        { id: 'ch-g', title: glossaryTitle('general') },
      ] }),
      getKnowledge: async (ws, tok, id) => ({ id, content: `content of ${id}` }),
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.entryId, 'ch-g');
    assert.equal(res.content, 'content of ch-g');
    assert.equal(res.scope, 'channel');
    assert.equal(adapter._glossaryEntryIds.general, 'ch-g');
  });

  it('falls back to the workspace glossary when the channel has none', async () => {
    const adapter = mkBase();
    adapter.client = {
      listKnowledge: async () => ({ entries: [
        { id: 'ws-g', title: WORKSPACE_GLOSSARY_TITLE },
      ] }),
      getKnowledge: async (ws, tok, id) => ({ id, content: '- shared terms' }),
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.entryId, 'ws-g');
    assert.equal(res.state, 'found');
    assert.equal(res.scope, 'workspace');
    // The fallback must NOT be cached under the channel key, or the cached-id
    // fast path would mask a channel glossary created later.
    assert.equal(adapter._glossaryEntryIds.general, undefined);
  });

  it('a channel glossary created after a fallback hit wins on the next fetch', async () => {
    const adapter = mkBase();
    const entries = [{ id: 'ws-g', title: WORKSPACE_GLOSSARY_TITLE }];
    adapter.client = {
      listKnowledge: async () => ({ entries }),
      getKnowledge: async (ws, tok, id) => ({ id, content: `content of ${id}` }),
    };
    const first = await adapter._fetchGlossary('general');
    assert.equal(first.entryId, 'ws-g');
    // Someone creates the channel-specific glossary afterwards…
    entries.push({ id: 'ch-g', title: glossaryTitle('general') });
    const second = await adapter._fetchGlossary('general');
    assert.equal(second.entryId, 'ch-g');
    assert.equal(second.scope, 'channel');
  });

  it('reports absent when neither glossary exists', async () => {
    const adapter = mkBase();
    adapter.client = { listKnowledge: async () => ({ entries: [] }) };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.state, 'absent');
    assert.equal(res.entryId, null);
  });

  it('a renamed cached entry is dropped in favor of the fallback or a replacement', async () => {
    const adapter = mkBase();
    // Steady state: the channel glossary 'ch-g' is cached.
    adapter._glossaryEntryIds.general = 'ch-g';
    const byId = {
      // …but it has since been renamed for archival.
      'ch-g': { id: 'ch-g', title: 'Glossary for channel general (archived)', content: '- stale' },
      'ws-g': { id: 'ws-g', title: WORKSPACE_GLOSSARY_TITLE, content: '- workspace terms' },
      'ch-g2': { id: 'ch-g2', title: glossaryTitle('general'), content: '- fresh terms' },
    };
    const listed = [byId['ws-g']];
    adapter.client = {
      getKnowledge: async (ws, tok, id) => byId[id],
      listKnowledge: async () => ({ entries: listed }),
    };
    // Rename → cache invalidated → the workspace fallback wins.
    const first = await adapter._fetchGlossary('general');
    assert.equal(first.entryId, 'ws-g');
    assert.equal(first.scope, 'workspace');
    assert.equal(adapter._glossaryEntryIds.general, undefined);
    // A replacement canonical entry appears → it wins over the fallback.
    listed.push(byId['ch-g2']);
    const second = await adapter._fetchGlossary('general');
    assert.equal(second.entryId, 'ch-g2');
    assert.equal(second.content, '- fresh terms');
    assert.equal(adapter._glossaryEntryIds.general, 'ch-g2');
  });

  it('a GET response without a title never invalidates the cache', async () => {
    // Older backends may omit title on GET-by-id; that must not be read as
    // a rename.
    const adapter = mkBase();
    adapter._glossaryEntryIds.general = 'g-1';
    adapter.client = {
      getKnowledge: async (ws, tok, id) => ({ id, content: '- terms' }),
    };
    const res = await adapter._fetchGlossary('general');
    assert.equal(res.entryId, 'g-1');
    assert.equal(adapter._glossaryEntryIds.general, 'g-1');
  });
});

describe('knowledge-disabled warning', () => {
  it('posts a status once per channel and logs once overall', async () => {
    const adapter = mkBase();
    adapter.disabledModules = new Set(['knowledge']);
    const logs = [];
    adapter._log = (m) => logs.push(m);
    const first = await adapter._fetchGlossary('general');
    await adapter._fetchGlossary('general');
    await adapter._fetchGlossary('other');
    assert.equal(first.available, false);
    assert.equal(logs.filter((l) => /pinning is INACTIVE/.test(l)).length, 1);
    const warned = adapter.statuses.filter((s) => /Glossary pinning inactive/.test(s));
    assert.equal(warned.length, 2); // once for 'general', once for 'other'
  });
});

describe('pinnedPromptOpts / _prefetchPinnedContext', () => {
  it('is empty until a prefetch ran, then reflects the fetched entries', async () => {
    const adapter = mkBase();
    adapter._usesPinnedContext = true;
    adapter._fetchGlossary = async () => ({ available: true, state: 'found', entryId: 'g-1', content: '- defined', error: false });

    assert.deepEqual(adapter.pinnedPromptOpts('general'), {});
    await adapter._prefetchPinnedContext('general');
    const opts = adapter.pinnedPromptOpts('general');
    assert.equal(opts.decisionLog, undefined);
    assert.deepEqual(opts.glossary, { enabled: true, entryId: 'g-1', content: '- defined', scope: 'channel' });
  });

  it('a transient failure keeps the last successful pin', async () => {
    const adapter = mkBase();
    adapter._usesPinnedContext = true;
    let fail = false;
    adapter._fetchGlossary = async () => fail
      ? { available: true, state: 'unknown', entryId: null, content: null, error: true }
      : { available: true, state: 'found', entryId: 'g-1', content: '- defined', error: false, scope: 'channel' };

    await adapter._prefetchPinnedContext('general');
    fail = true;
    await adapter._prefetchPinnedContext('general');
    const opts = adapter.pinnedPromptOpts('general');
    assert.equal(opts.glossary.content, '- defined');
  });

  it('does not prefetch unless the adapter opted in', async () => {
    const adapter = mkBase();
    let fetched = 0;
    adapter._fetchPinnedContext = async () => { fetched++; return {}; };
    await adapter._prefetchPinnedContext('general');
    assert.equal(fetched, 0);
    adapter._usesPinnedContext = true;
    await adapter._prefetchPinnedContext('general');
    assert.equal(fetched, 1);
  });

  it('omits the glossary when absent', async () => {
    const adapter = mkBase();
    adapter._usesPinnedContext = true;
    adapter._fetchGlossary = async () => ({ available: true, state: 'absent', entryId: null, content: null, error: false });
    await adapter._prefetchPinnedContext('general');
    const opts = adapter.pinnedPromptOpts('general');
    assert.deepEqual(opts, {});
  });
});

describe('pinnedFingerprint', () => {
  it('changes when any pinned part changes and is order-sensitive', () => {
    const a = pinnedFingerprint([{ entryId: 'd', content: 'x' }, { entryId: 'g', content: 'y' }]);
    const b = pinnedFingerprint([{ entryId: 'd', content: 'x' }, { entryId: 'g', content: 'CHANGED' }]);
    const c = pinnedFingerprint([{ entryId: 'g', content: 'y' }, { entryId: 'd', content: 'x' }]);
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.equal(a, pinnedFingerprint([{ entryId: 'd', content: 'x' }, { entryId: 'g', content: 'y' }]));
  });

  it('builds on the single-entry fingerprint (no-entry states hash stably)', () => {
    assert.equal(
      pinnedFingerprint([{ entryId: null, content: null }]),
      pinnedFingerprint([{ entryId: undefined, content: '' }])
    );
    assert.notEqual(decisionFingerprint('a', 'x'), decisionFingerprint('b', 'x'));
  });
});

describe('buildGlossaryPrompt', () => {
  it('fences the definitions as data and pins the update protocol to the entry id', () => {
    const out = buildGlossaryPrompt({ entryId: 'g-1', content: '- amount: minor units (cents)' });
    assert.ok(out.includes('## Shared glossary'));
    assert.ok(out.includes('BEGIN PINNED GLOSSARY (data)'));
    assert.ok(out.includes('- amount: minor units (cents)'));
    assert.ok(out.includes('`g-1`'));
    assert.ok(out.includes('workspace_read_knowledge'));
    assert.ok(out.includes('Never create a new glossary entry'));
  });

  it('uses curl phrasing in skills mode', () => {
    const out = buildGlossaryPrompt({ toolMode: 'skills', entryId: 'g-1', content: '- x' });
    assert.ok(out.includes('PUT /v1/knowledge/ENTRY_ID'));
    assert.ok(!out.includes('workspace_write_knowledge'));
  });

  it('drops the update protocol in plan mode and for read-only callers', () => {
    const plan = buildGlossaryPrompt({ entryId: 'g-1', content: '- x', mode: 'plan' });
    assert.ok(!plan.includes('write it back'));
    const readOnly = buildGlossaryPrompt({ entryId: 'g-1', content: '- x', writeAccess: false });
    assert.ok(!readOnly.includes('write it back'));
    assert.ok(readOnly.includes('BEGIN PINNED GLOSSARY (data)'));
  });

  it('the workspace-wide fallback is read-only for channel agents', () => {
    const out = buildGlossaryPrompt({ entryId: 'ws-g', content: '- x', scope: 'workspace' });
    assert.ok(out.includes('do NOT edit it yourself'));
    assert.ok(!out.includes('write it back'));
    assert.ok(out.includes('BEGIN PINNED GLOSSARY (data)'));
  });
});

describe('openclaw/opencode system prompts opt in to pinning', () => {
  const BASE = {
    agentName: 'qa', workspaceId: 'ws-1', channelName: 'general',
    endpoint: 'https://example.test', token: 'tok', disabledModules: new Set(),
  };
  const PINNED = {
    glossary: { enabled: true, entryId: 'g-1', content: '- amount: minor units' },
  };

  it('buildOpenclawSystemPrompt emits the glossary with skills phrasing', () => {
    const out = buildOpenclawSystemPrompt({ ...BASE, ...PINNED });
    assert.ok(out.includes('## Shared glossary'));
    assert.ok(out.includes('- amount: minor units'));
    assert.ok(out.includes('PUT /v1/knowledge/ENTRY_ID'));
    assert.ok(!out.includes('workspace_write_knowledge'));
  });

  it('buildOpenCodeSystemPrompt emits the glossary', () => {
    const out = buildOpenCodeSystemPrompt({ ...BASE, ...PINNED });
    assert.ok(out.includes('## Shared glossary'));
  });

  it('both stay unchanged when nothing is passed', () => {
    for (const build of [buildOpenclawSystemPrompt, buildOpenCodeSystemPrompt]) {
      const out = build({ ...BASE });
      assert.ok(!out.includes('## Shared glossary'));
    }
  });
});

describe('Claude MCP allowlist covers the knowledge tools', () => {
  const PFX = 'mcp__openagents-workspace__';

  function buildCmd(overrides = {}, mode = 'execute') {
    const adapter = new ClaudeAdapter({
      workspaceId: 'ws-1', channelName: 'general', token: 'tok', agentName: 'claude',
      toolMode: 'mcp',
      ...overrides,
    });
    adapter._mode = mode;
    const { cmd, mcpConfigFile } = adapter._buildMcpCmd(['claude'], 'general');
    if (mcpConfigFile) { try { fs.unlinkSync(mcpConfigFile); } catch {} }
    const i = cmd.indexOf('--allowedTools');
    return cmd.slice(i + 1);
  }

  it('allows list/read/write knowledge in execute mode', () => {
    const allowed = buildCmd();
    for (const t of ['workspace_list_knowledge', 'workspace_read_knowledge', 'workspace_write_knowledge']) {
      assert.ok(allowed.includes(`${PFX}${t}`), `missing ${t}`);
    }
  });

  it('plan mode allows reading but not writing knowledge', () => {
    const allowed = buildCmd({}, 'plan');
    assert.ok(allowed.includes(`${PFX}workspace_list_knowledge`));
    assert.ok(allowed.includes(`${PFX}workspace_read_knowledge`));
    assert.ok(!allowed.includes(`${PFX}workspace_write_knowledge`));
  });

  it('omits knowledge tools when the module is disabled', () => {
    const allowed = buildCmd({ disabledModules: new Set(['knowledge']) });
    assert.ok(!allowed.some((t) => t.includes('_knowledge')));
  });

  it('propagates the disable to the MCP server so the tools are not even registered', () => {
    // allowedTools omission is not a boundary under
    // --dangerously-skip-permissions; the server itself must drop the tools.
    const mk = (disabled) => new ClaudeAdapter({
      workspaceId: 'ws-1', channelName: 'general', token: 'tok', agentName: 'claude',
      toolMode: 'mcp', disabledModules: disabled,
    });
    const readArgs = (adapter) => {
      const { mcpConfigFile } = adapter._buildMcpCmd(['claude'], 'general');
      const config = JSON.parse(fs.readFileSync(mcpConfigFile, 'utf-8'));
      try { fs.unlinkSync(mcpConfigFile); } catch {}
      return config.mcpServers['openagents-workspace'].args;
    };
    assert.ok(readArgs(mk(new Set(['knowledge']))).includes('--disable-knowledge'));
    assert.ok(!readArgs(mk(new Set())).includes('--disable-knowledge'));
  });
});

describe('Goose pins read-only into its per-turn system prompt', () => {
  it('emits the glossary without any write protocol', () => {
    const GooseAdapter = require('../src/adapters/goose');
    const adapter = new GooseAdapter({
      workspaceId: `test-ws-${Math.random().toString(36).slice(2)}`,
      channelName: 'general', token: 'tok', agentName: 'goose',
    });
    assert.equal(adapter._usesPinnedContext, true);
    adapter._pinnedContext.general = {
      glossary: { available: true, state: 'found', entryId: 'g-1', content: '- amount: minor units', error: false, scope: 'channel' },
    };
    const prompt = adapter._buildSystemPrompt('general');
    assert.ok(!/decision log/i.test(prompt));
    assert.ok(prompt.includes('## Shared glossary'));
    assert.ok(prompt.includes('- amount: minor units'));
    assert.ok(!prompt.includes('Update protocol'));
    // Without a prefetch the prompt simply has no pinned sections.
    assert.ok(!adapter._buildSystemPrompt('other').includes('## Shared glossary'));
  });
});
