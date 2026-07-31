'use strict';

/**
 * Decision-log helper tests: hashing, entry picking, bullet-aware pinning
 * truncation, head+tail recap sampling, and the prompt-builder integration
 * (including that adapters which reuse buildClaudeSystemPrompt without
 * opting in — e.g. Gemini — never see decision-log text).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  decisionLogTitle,
  hashDecisions,
  decisionFingerprint,
  pickDecisionEntry,
  renderPinnedDecisions,
  sampleRecap,
} = require('../src/adapters/decision-log');
const { buildClaudeSystemPrompt, buildDecisionLogPrompt, buildClaudeSkillMd } = require('../src/adapters/workspace-prompt');

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

describe('pickDecisionEntry', () => {
  it('matches on the exact title only', () => {
    const entries = [
      { id: '1', title: 'Decisions for channel general extra' },
      { id: '2', title: 'Decisions for channel general' },
      { id: '3', title: 'unrelated' },
    ];
    const { entry, duplicates } = pickDecisionEntry(entries, 'general');
    assert.equal(entry.id, '2');
    assert.equal(duplicates, 0);
  });

  it('picks the earliest created entry among duplicates and counts the rest', () => {
    const title = decisionLogTitle('general');
    const entries = [
      { id: 'late', title, created_at: '2026-07-30T10:00:00Z' },
      { id: 'early', title, created_at: '2026-07-29T09:00:00Z' },
      { id: 'undated', title },
    ];
    const { entry, duplicates } = pickDecisionEntry(entries, 'general');
    assert.equal(entry.id, 'early');
    assert.equal(duplicates, 2);
  });

  it('returns null when nothing matches', () => {
    assert.equal(pickDecisionEntry([], 'general').entry, null);
    assert.equal(pickDecisionEntry(null, 'general').entry, null);
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

describe('buildDecisionLogPrompt', () => {
  it('embeds the known entry id and forbids creating a new entry', () => {
    const text = buildDecisionLogPrompt({ toolMode: 'mcp', channelName: 'general', entryId: 'e-42', content: '- use snake_case' });
    assert.ok(text.includes('`e-42`'));
    assert.ok(text.includes('NEVER create a new entry'));
    assert.ok(text.includes('workspace_write_knowledge'));
    assert.ok(text.includes('Pinned decisions (authoritative)'));
    assert.ok(text.includes('- use snake_case'));
  });

  it('gives the full list-then-update protocol when no entry exists yet', () => {
    const text = buildDecisionLogPrompt({ toolMode: 'mcp', channelName: 'general', entryId: null, content: '' });
    assert.ok(text.includes('No decision log exists'));
    assert.ok(text.includes('workspace_list_knowledge'));
    assert.ok(text.includes('CREATES A NEW ENTRY'));
    assert.ok(!text.includes('Pinned decisions'));
  });

  it('points at curl commands instead of MCP tools in skills mode', () => {
    const text = buildDecisionLogPrompt({ toolMode: 'skills', channelName: 'general', entryId: 'e-1', content: '- x' });
    assert.ok(!text.includes('workspace_write_knowledge'));
    assert.ok(text.includes('PUT /v1/knowledge/ENTRY_ID'));
    // Reads go by ID (the prompt only hands out an id, never a slug), and the
    // skill must document that exact endpoint — see the skill-md test below.
    assert.ok(text.includes('GET /v1/knowledge/ENTRY_ID'));
  });

  it('unknown state demands list-first and never claims the log is missing', () => {
    const text = buildDecisionLogPrompt({ toolMode: 'mcp', channelName: 'general', entryId: null, content: '', state: 'unknown' });
    assert.ok(!text.includes('No decision log exists'));
    assert.ok(text.includes('UNKNOWN'));
    assert.ok(text.includes('workspace_list_knowledge'));
    assert.ok(text.includes('NEVER create the entry without listing first'));
    assert.ok(text.includes('Only if the listing confirms no such entry exists'));
  });

  it('plan mode suppresses the write protocol but keeps the pinned decisions', () => {
    const text = buildDecisionLogPrompt({ toolMode: 'mcp', channelName: 'general', entryId: 'e-1', content: '- pinned', mode: 'plan' });
    assert.ok(!text.includes('Update protocol'));
    assert.ok(text.includes('do NOT write to the decision log'));
    assert.ok(text.includes('Confirmed decisions'));
    assert.ok(text.includes('- pinned'));
  });
});

describe('workspace skill knowledge commands', () => {
  it('documents reading a knowledge entry by ID, which the decision protocol relies on', () => {
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

describe('buildClaudeSystemPrompt decision-log opt-in', () => {
  const BASE = { agentName: 'claude', workspaceId: 'ws-1', channelName: 'general' };

  it('includes the decision log only when enabled', () => {
    const withLog = buildClaudeSystemPrompt({
      ...BASE,
      decisionLog: { enabled: true, entryId: 'e-1', content: '- fields are snake_case' },
    });
    assert.ok(withLog.includes('Decision log'));
    assert.ok(withLog.includes('- fields are snake_case'));
  });

  it('omits it entirely by default, so Gemini-style callers are unaffected', () => {
    // gemini.js calls buildClaudeSystemPrompt without a decisionLog param.
    const geminiStyle = buildClaudeSystemPrompt({ ...BASE, mode: 'execute' });
    assert.ok(!geminiStyle.includes('Decision log'));
    assert.ok(!geminiStyle.includes('Pinned decisions'));
  });
});
