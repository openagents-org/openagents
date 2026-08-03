'use strict';

/**
 * The shared recap builder.
 *
 * Claude, Cursor and Cline all seed a fresh session through this module. The
 * behaviours worth pinning are the ones that used to differ between their
 * three hand-rolled copies, plus the selection rule that makes a projected
 * recap actually role-local rather than merely shorter.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  isRecapEligible,
  formatAttachments,
  formatRecapLine,
  spreadSample,
  sampleRecap,
  excerptNote,
} = require('../src/adapters/recap');

const msg = (over = {}) => ({
  messageId: `m${Math.random().toString(36).slice(2, 8)}`,
  senderType: 'agent',
  senderName: 'pm-agent',
  content: 'hello',
  ...over,
});

describe('isRecapEligible', () => {
  it('drops intermediate output', () => {
    for (const messageType of ['status', 'thinking', 'loading', 'todos']) {
      assert.equal(isRecapEligible(msg({ messageType }), 'now'), false, messageType);
    }
  });

  it('drops empty chat', () => {
    assert.equal(isRecapEligible(msg({ content: '   ' }), 'now'), false);
  });

  it('drops the message being answered right now', () => {
    assert.equal(isRecapEligible(msg({ content: 'now' }), 'now'), false);
  });

  it('keeps an attachment-only message that has no text', () => {
    // A shared file is an artifact another role is expected to pick up;
    // dropping the line loses the only pointer to it.
    const m = msg({ content: '', attachments: [{ filename: 'spec.md', fileId: 'f1' }] });
    assert.equal(isRecapEligible(m, 'now'), true);
  });

  it('keeps an attachment even when its text is the current message', () => {
    const m = msg({ content: 'now', attachments: [{ filename: 'spec.md', fileId: 'f1' }] });
    assert.equal(isRecapEligible(m, 'now'), true);
  });
});

describe('formatAttachments', () => {
  it('accepts camelCase fileId', () => {
    assert.equal(
      formatAttachments([{ filename: 'spec.md', fileId: 'f1' }]),
      '\n  [Attached: spec.md (file_id: f1)]',
    );
  });

  it('accepts snake_case file_id — payloads arrive both ways', () => {
    assert.equal(
      formatAttachments([{ filename: 'spec.md', file_id: 'f1' }]),
      '\n  [Attached: spec.md (file_id: f1)]',
    );
  });

  it('omits the handle rather than printing a useless one', () => {
    // "(file_id: ?)" tells the agent a file exists and denies it the handle.
    assert.equal(formatAttachments([{ filename: 'spec.md' }]), '\n  [Attached: spec.md]');
  });

  it('lists several', () => {
    const out = formatAttachments([
      { filename: 'a.md', fileId: '1' }, { file_name: 'b.png', file_id: '2' },
    ]);
    assert.equal(out, '\n  [Attached: a.md (file_id: 1), b.png (file_id: 2)]');
  });

  it('is empty for none', () => {
    assert.equal(formatAttachments([]), '');
    assert.equal(formatAttachments(undefined), '');
  });
});

describe('formatRecapLine', () => {
  it('renders a full message with its attachments', () => {
    const line = formatRecapLine(msg({
      senderType: 'human', senderName: 'alice', content: 'Here is the spec',
      attachments: [{ filename: 'spec.md', fileId: 'f1' }],
    }));
    assert.equal(line, '[alice] Here is the spec\n  [Attached: spec.md (file_id: f1)]');
  });

  it('keeps attachments on an excerpt — the artifact is not the conversation', () => {
    const line = formatRecapLine(msg({
      messageId: 'e2', content: 'Settled on CSV', truncated: true,
      attachments: [{ filename: 'spec.md', fileId: 'f1' }],
    }));
    assert.equal(
      line,
      '[pm-agent] (excerpt id=e2) Settled on CSV\n  [Attached: spec.md (file_id: f1)]',
    );
  });

  it('honours a per-adapter line budget', () => {
    const line = formatRecapLine(msg({ content: 'x'.repeat(2000) }), { maxChars: 800 });
    assert.equal(line.length, '[pm-agent] '.length + 801);
    assert.ok(line.endsWith('…'));
  });
});

describe('spreadSample', () => {
  it('returns everything when it already fits', () => {
    assert.deepEqual(spreadSample([1, 2], 4), [1, 2]);
  });

  it('spans the range rather than clustering at one end', () => {
    // These are a time spine: four items from the last minute would not show
    // that other work happened across the gap.
    const picked = spreadSample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4);
    assert.equal(picked[0], 0);
    assert.equal(picked[picked.length - 1], 9);
    assert.equal(picked.length, 4);
  });

  it('keeps original order and does not repeat', () => {
    const picked = spreadSample([1, 2, 3, 4, 5], 3);
    assert.deepEqual(picked, [...picked].sort((a, b) => a - b));
    assert.equal(new Set(picked).size, picked.length);
  });

  it('handles degenerate budgets', () => {
    assert.deepEqual(spreadSample([1, 2, 3], 0), []);
    assert.deepEqual(spreadSample([], 3), []);
    assert.deepEqual(spreadSample([1, 2, 3], 1), [1]);
  });
});

describe('sampleRecap — shared mode is unchanged', () => {
  it('keeps head then tail, with an omission marker between them', () => {
    const head = [msg({ messageId: 'h1', content: 'first' })];
    const tail = [msg({ messageId: 't1', content: 'latest' })];
    assert.deepEqual(sampleRecap(head, tail, 'now'), [
      '[pm-agent] first',
      '[… earlier messages omitted …]',
      '[pm-agent] latest',
    ]);
  });

  it('omits the marker when the windows overlap', () => {
    const shared = msg({ messageId: 'x', content: 'both' });
    const lines = sampleRecap([shared], [shared], 'now');
    assert.deepEqual(lines, ['[pm-agent] both']);
  });

  it('takes the last N mechanically, excerpts or not', () => {
    const tail = Array.from({ length: 30 }, (_, i) => msg({ content: `m${i}` }));
    const lines = sampleRecap([], tail, 'now');
    assert.equal(lines.length, 15);
    assert.equal(lines[0], '[pm-agent] m15');
  });
});

describe('sampleRecap — projected mode keeps what the agent has a stake in', () => {
  it('does not let a crowd of excerpts push out a relevant full-text turn', () => {
    // The regression this selection exists for: a busy thread produces far
    // more excerpts than relevant turns, and last-N would return nothing but
    // excerpts — fewer tokens, same loss of role-local context.
    const relevant = msg({ messageId: 'mine', senderName: 'rd-agent', content: 'MY TURN' });
    const noise = (i) => msg({ messageId: `n${i}`, content: `chatter ${i}`, truncated: true });
    const tail = [
      ...Array.from({ length: 20 }, (_, i) => noise(i)),
      relevant,
      ...Array.from({ length: 20 }, (_, i) => noise(100 + i)),
    ];

    const lines = sampleRecap([], tail, 'now', { projected: true });

    assert.ok(lines.some((l) => l.includes('MY TURN')), 'the relevant turn survived');
    const excerpts = lines.filter((l) => l.includes('(excerpt'));
    assert.ok(excerpts.length <= 4, `spine stayed small, got ${excerpts.length}`);
    assert.ok(lines.length < 15, 'and the recap got shorter, not just reordered');
  });

  it('keeps several relevant turns spread through heavy noise', () => {
    const tail = [];
    for (let i = 0; i < 10; i++) {
      tail.push(msg({ messageId: `n${i}`, content: `chatter ${i}`, truncated: true }));
      tail.push(msg({ messageId: `r${i}`, senderName: 'rd-agent', content: `REAL ${i}` }));
    }

    const lines = sampleRecap([], tail, 'now', { projected: true });

    for (let i = 0; i < 10; i++) {
      assert.ok(lines.some((l) => l.includes(`REAL ${i}`)), `REAL ${i} survived`);
    }
  });

  it('preserves chronological order after mixing spine back in', () => {
    const tail = [
      msg({ messageId: 'a', content: 'one', truncated: true }),
      msg({ messageId: 'b', senderName: 'rd-agent', content: 'two' }),
      msg({ messageId: 'c', content: 'three', truncated: true }),
      msg({ messageId: 'd', senderName: 'rd-agent', content: 'four' }),
    ];

    const lines = sampleRecap([], tail, 'now', { projected: true });

    const order = ['one', 'two', 'three', 'four'].map(
      (t) => lines.findIndex((l) => l.includes(t))
    );
    assert.deepEqual(order, [...order].sort((x, y) => x - y));
  });

  it('still bounds relevant turns by tailKeep', () => {
    const tail = Array.from({ length: 30 }, (_, i) =>
      msg({ senderName: 'rd-agent', content: `real ${i}` }));
    const lines = sampleRecap([], tail, 'now', { projected: true });
    assert.equal(lines.length, 15);
  });

  it('falls back to excerpts alone when nothing is relevant', () => {
    const tail = Array.from({ length: 10 }, (_, i) =>
      msg({ messageId: `n${i}`, content: `chatter ${i}`, truncated: true }));
    const lines = sampleRecap([], tail, 'now', { projected: true });
    assert.ok(lines.length > 0, 'a thread of pure excerpts still recaps something');
    assert.ok(lines.every((l) => l.includes('(excerpt')));
  });
});

describe('excerptNote', () => {
  it('is empty when nothing was excerpted', () => {
    assert.equal(excerptNote(['[alice] hi'], 'use the tool'), '');
  });

  it('explains the label and names the expansion route', () => {
    const note = excerptNote(['[pm-agent] (excerpt id=e2) hi'], 'call `workspace_expand_message`');
    assert.match(note, /not a summary of it/);
    assert.match(note, /call `workspace_expand_message`/);
  });

  it('omits the how-to when the adapter has no way to expand', () => {
    const note = excerptNote(['[pm-agent] (excerpt id=e2) hi'], null);
    assert.match(note, /not a summary of it/);
    assert.doesNotMatch(note, /bears on your task/);
  });

  it('is not fooled by a message that merely mentions the word', () => {
    assert.equal(excerptNote(['[alice] the excerpt looked wrong'], 'x'), '');
  });
});
