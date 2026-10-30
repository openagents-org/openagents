'use strict';

/**
 * Pinning helper tests: hashing, entry picking, bullet-aware pinning
 * truncation, head+tail recap sampling, and that no system prompt asks an
 * agent to keep a per-channel decision log any more.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  hashDecisions,
  decisionFingerprint,
  pickEntryByTitle,
  renderPinnedDecisions,
  sampleRecap,
} = require('../src/adapters/decision-log');
const {
  buildClaudeSystemPrompt,
  buildOpenclawSystemPrompt,
  buildOpenCodeSystemPrompt,
  buildClaudeSkillMd,
} = require('../src/adapters/workspace-prompt');

describe('hashDecisions', () => {
  it('is stable for equal content and ignores surrounding whitespace', () => {
    assert.equal(hashDecisions('- a\n- b'), hashDecisions('  - a\n- b \n'));
  });

  it('treats null, undefined and empty string as the same "no log" state', () => {
    assert.equal(hashDecisions(null), hashDecisions(''));
    assert.equal(hashDecisions(undefined), hashDecisions(''));
  });

  it('differs when content differs', () => {
    assert.notEqual(hashDecisions('- a'), hashDecisions('- b'));
  });
});

describe('decisionFingerprint', () => {
  it('changes when the entry id changes even with identical content', () => {
    assert.notEqual(
      decisionFingerprint('e-1', '- same'),
      decisionFingerprint('e-2', '- same')
    );
  });

  it('changes when content changes under the same id', () => {
    assert.notEqual(
      decisionFingerprint('e-1', '- a'),
      decisionFingerprint('e-1', '- b')
    );
  });

  it('is stable for the no-log state', () => {
    assert.equal(decisionFingerprint(null, null), decisionFingerprint(undefined, ''));
  });
});

describe('pickEntryByTitle', () => {
  it('matches on the exact title only', () => {
    const entries = [
      { id: '1', title: 'Glossary for channel general extra' },
      { id: '2', title: 'Glossary for channel general' },
      { id: '3', title: 'unrelated' },
    ];
    const { entry, duplicates } = pickEntryByTitle(entries, 'Glossary for channel general');
    assert.equal(entry.id, '2');
    assert.equal(duplicates, 0);
  });

  it('picks the earliest created entry among duplicates and counts the rest', () => {
    const title = 'Glossary for channel general';
    const entries = [
      { id: 'late', title, created_at: '2026-07-30T10:00:00Z' },
      { id: 'early', title, created_at: '2026-07-29T09:00:00Z' },
      { id: 'undated', title },
    ];
    const { entry, duplicates } = pickEntryByTitle(entries, title);
    assert.equal(entry.id, 'early');
    assert.equal(duplicates, 2);
  });

  it('returns null when nothing matches', () => {
    assert.equal(pickEntryByTitle([], 'x').entry, null);
    assert.equal(pickEntryByTitle(null, 'x').entry, null);
  });
});

describe('renderPinnedDecisions', () => {
  it('returns content unchanged when under the budget', () => {
    const res = renderPinnedDecisions('- keep me', { maxChars: 100 });
    assert.equal(res.text, '- keep me');
    assert.equal(res.truncated, false);
  });

  it('returns empty for a missing log', () => {
    assert.equal(renderPinnedDecisions(null).text, '');
    assert.equal(renderPinnedDecisions('   ').text, '');
  });

  it('keeps whole lines from both ends and marks the omitted middle', () => {
    const lines = [];
    for (let i = 0; i < 40; i++) lines.push(`- decision number ${i} ${'x'.repeat(40)}`);
    const content = lines.join('\n');
    const res = renderPinnedDecisions(content, { maxChars: 600 });

    assert.equal(res.truncated, true);
    assert.ok(res.omitted > 0);
    assert.ok(res.text.length <= 600);
    // Earliest and latest decisions both survive.
    assert.ok(res.text.includes('- decision number 0 '));
    assert.ok(res.text.includes('- decision number 39 '));
    assert.ok(res.text.includes(`${res.omitted} middle line(s) omitted`));
    // Never cuts a line in half: every content line is one of the originals.
    for (const line of res.text.split('\n')) {
      if (line.startsWith('[…')) continue;
      assert.ok(lines.includes(line), `line was cut: ${line}`);
    }
  });
});

describe('sampleRecap', () => {
  const mkMsg = (id, content, opts = {}) => ({
    messageId: id,
    content,
    senderType: opts.senderType || 'human',
    senderName: opts.senderName || 'user',
    messageType: opts.messageType || 'chat',
  });

  it('keeps the channel opening and the recent tail with a gap marker', () => {
    const head = [1, 2, 3, 4, 5, 6, 7].map((i) => mkMsg(`h${i}`, `open ${i}`));
    const tail = [1, 2, 3].map((i) => mkMsg(`t${i}`, `recent ${i}`));
    const lines = sampleRecap(head, tail, 'current');

    assert.equal(lines[0], '[user] open 1');
    assert.equal(lines[4], '[user] open 5'); // headKeep=5 cuts opening 6/7
    assert.equal(lines[5], '[… earlier messages omitted …]');
    assert.equal(lines[6], '[user] recent 1');
    assert.equal(lines.at(-1), '[user] recent 3');
  });

  it('dedups overlapping windows by id and drops the gap marker', () => {
    const m1 = mkMsg('a', 'first');
    const m2 = mkMsg('b', 'second');
    const m3 = mkMsg('c', 'third');
    const lines = sampleRecap([m1, m2, m3], [m2, m3], 'current');
    assert.deepEqual(lines, ['[user] first', '[user] second', '[user] third']);
  });

  it('filters noise, empties, and the current message', () => {
    const msgs = [
      mkMsg('1', 'keep'),
      mkMsg('2', 'noise', { messageType: 'thinking' }),
      mkMsg('3', 'noise', { messageType: 'status' }),
      mkMsg('4', ''),
      mkMsg('5', 'current'),
    ];
    const lines = sampleRecap(msgs, [], 'current');
    assert.deepEqual(lines, ['[user] keep']);
  });

  it('cuts an overlong line at 2000 chars', () => {
    const long = 'y'.repeat(3000);
    const lines = sampleRecap([mkMsg('1', long)], [], 'current');
    assert.equal(lines[0].length, '[user] '.length + 2000 + 1);
    assert.ok(lines[0].endsWith('…'));
  });
});

describe('workspace skill knowledge commands', () => {
  it('documents reading a knowledge entry by ID, which the glossary protocol relies on', () => {
    const md = buildClaudeSkillMd({
      endpoint: 'https://example.test',
      workspaceId: 'ws-1',
      token: 'tok',
      agentName: 'claude',
      channelName: 'general',
      disabledModules: new Set(),
    });
    assert.ok(md.includes('Read a knowledge entry by ID'));
    assert.ok(md.includes('/v1/knowledge/ENTRY_ID?network=ws-1'));
  });
});

describe('no decision log in any system prompt', () => {
  const BASE = { agentName: 'claude', workspaceId: 'ws-1', channelName: 'general' };
  const SKILLS = { ...BASE, endpoint: 'https://example.test', token: 'tok', disabledModules: new Set() };
  // A caller still passing the old option must not bring the protocol back.
  const legacy = { decisionLog: { enabled: true, state: 'absent', entryId: null, content: '- old' } };

  for (const [name, build, opts] of [
    ['buildClaudeSystemPrompt (mcp)', buildClaudeSystemPrompt, { ...BASE, toolMode: 'mcp' }],
    ['buildClaudeSystemPrompt (skills)', buildClaudeSystemPrompt, { ...BASE, toolMode: 'skills' }],
    ['buildOpenclawSystemPrompt', buildOpenclawSystemPrompt, SKILLS],
    ['buildOpenCodeSystemPrompt', buildOpenCodeSystemPrompt, SKILLS],
  ]) {
    it(`${name} never asks the agent to create or update a decision log`, () => {
      for (const mode of ['execute', 'plan']) {
        const out = build({ ...opts, ...legacy, mode });
        assert.ok(!/decision log/i.test(out), `${name} ${mode} mentions a decision log`);
        assert.ok(!out.includes('Decisions for channel'));
        assert.ok(!out.includes('Pinned decisions'));
      }
    });
  }
});
