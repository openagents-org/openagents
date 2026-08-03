/**
 * Channel recap: turning a window of channel messages into the text a fresh
 * CLI session is seeded with.
 *
 * One module for every adapter on purpose. Claude, Cursor and Cline each grew
 * their own near-copy of this loop, which is how they ended up formatting the
 * same message three slightly different ways — and why a fix to one silently
 * missed the others. Everything here is side-effect free and unit tested.
 *
 * Two selection strategies, because a projected channel and a shared one need
 * different things:
 *
 *   shared    — head + tail sampling. The opening turns usually carry the
 *               original requirement, the recent ones carry the live thread.
 *
 *   projected — relevance first. The window now contains one-line excerpts of
 *               turns addressed to other agents, and a busy thread produces a
 *               lot of them. Taking the last N mechanically lets dozens of
 *               excerpts push out the full-text turns the agent actually has a
 *               stake in — fewer tokens, but the same loss of role-local
 *               context the projection was built to fix. So full-text turns
 *               are kept first, and a few excerpts are spread across the gap
 *               as a time spine so the agent can still see that other work
 *               happened, and when.
 */

'use strict';

/** Max characters a single recap line may occupy before being cut. */
const RECAP_LINE_MAX_CHARS = 2000;

/** How many excerpts to keep as a time spine in a projected recap. */
const SPINE_KEEP = 4;

/**
 * A message qualifies for the recap when it is real chat a reader could act
 * on.
 *
 * Attachment-only messages count even with no text: a shared file is an
 * artifact another role is expected to pick up, and dropping the line loses
 * the only pointer to it.
 */
function isRecapEligible(msg, currentMessage) {
  if (!msg) return false;
  const mt = msg.messageType || 'chat';
  if (mt === 'status' || mt === 'thinking' || mt === 'loading' || mt === 'todos') return false;
  const text = (msg.content || '').trim();
  const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
  if (!text && !hasAttachments) return false;
  if (text && text === currentMessage && !hasAttachments) return false;
  return true;
}

/**
 * Render a message's attachments as a trailing marker.
 *
 * Accepts both `fileId` and `file_id`: the workspace client camel-cases what
 * it maps, but payloads reach here straight from the API in snake_case too,
 * and a marker reading `file_id: ?` is worse than useless — it tells the agent
 * a file exists and denies it the handle to read it.
 */
function formatAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return '';
  const parts = attachments.map((a) => {
    const name = (a && (a.filename || a.file_name)) || 'file';
    const id = (a && (a.fileId || a.file_id)) || null;
    return id ? `${name} (file_id: ${id})` : name;
  });
  return `\n  [Attached: ${parts.join(', ')}]`;
}

/**
 * One recap line: who spoke, what they said, and what they attached.
 *
 * An excerpt is labelled and carries its id. Both matter: unlabelled, the
 * model reads one clipped line as the whole turn and answers a question nobody
 * asked; without the id it has no way back to the real text even once it
 * notices it needs it.
 *
 * "excerpt", not "summary" — it is the first non-empty line, chosen by nothing
 * that read the text. The label is the model's cue for how far to trust the
 * line, so calling it a summary would overstate it.
 */
function formatRecapLine(msg, { maxChars = RECAP_LINE_MAX_CHARS } = {}) {
  const text = (msg.content || '').trim();
  const who = msg.senderType === 'human'
    ? (msg.senderName || 'user')
    : (msg.senderName || 'agent');
  const cut = text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
  const attached = formatAttachments(msg.attachments);

  if (msg.truncated) {
    const ref = msg.messageId ? ` id=${msg.messageId}` : '';
    return `[${who}] (excerpt${ref}) ${cut}${attached}`;
  }
  return `[${who}] ${cut}${attached}`;
}

/**
 * Pick up to `keep` items spread evenly across `items`, preserving order.
 *
 * Evenly spread rather than most-recent: these are the time spine of a
 * projected recap, and the point is to show that other work happened across
 * the gap. Four excerpts from the last five minutes would not do that.
 */
function spreadSample(items, keep) {
  if (keep <= 0 || items.length === 0) return [];
  if (items.length <= keep) return items.slice();
  const step = (items.length - 1) / (keep - 1 || 1);
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < keep; i++) {
    const idx = Math.round(i * step);
    if (!seen.has(idx)) { seen.add(idx); picked.push(items[idx]); }
  }
  return picked;
}

/**
 * Choose which of a channel's recent messages make it into the recap.
 *
 * `tailKeep` bounds full-text turns; excerpts are budgeted separately by
 * `spineKeep` so they can never crowd them out. Output stays in the window's
 * original order.
 */
function selectTail(tail, { tailKeep, spineKeep, projected }) {
  if (!projected) return tail.slice(-tailKeep);

  const order = new Map(tail.map((m, i) => [m, i]));
  const relevant = tail.filter((m) => !m.truncated).slice(-tailKeep);
  const kept = new Set(relevant);
  const spine = spreadSample(tail.filter((m) => m.truncated), spineKeep)
    .filter((m) => !kept.has(m));
  return [...relevant, ...spine].sort((a, b) => order.get(a) - order.get(b));
}

/**
 * Build recap lines from a channel's opening messages (fetched ascending) and
 * its most recent ones (fetched descending, already reversed to chronological).
 *
 * Adapters that fetch a single window pass `[]` as `headMsgs`. Overlap between
 * the two windows is removed by event id, and the omission marker is inserted
 * only when they do not overlap — i.e. when messages in between really were
 * dropped.
 */
function sampleRecap(headMsgs, tailMsgs, currentMessage, {
  headKeep = 5, tailKeep = 15, spineKeep = SPINE_KEEP, projected = false,
  maxChars = RECAP_LINE_MAX_CHARS,
} = {}) {
  const head = (headMsgs || [])
    .filter((m) => isRecapEligible(m, currentMessage))
    .slice(0, headKeep);
  const tailEligible = (tailMsgs || [])
    .filter((m) => isRecapEligible(m, currentMessage));

  const headIds = new Set(head.map((m) => m.messageId).filter(Boolean));
  const tailDeduped = tailEligible.filter((m) => !m.messageId || !headIds.has(m.messageId));
  const windowsOverlap = tailDeduped.length < tailEligible.length;

  const tail = selectTail(tailDeduped, { tailKeep, spineKeep, projected });

  const lines = head.map((m) => formatRecapLine(m, { maxChars }));
  if (head.length > 0 && tail.length > 0 && !windowsOverlap) {
    lines.push('[… earlier messages omitted …]');
  }
  lines.push(...tail.map((m) => formatRecapLine(m, { maxChars })));
  return lines;
}

/**
 * The note explaining excerpt lines, or '' when the recap has none.
 *
 * `howToExpand` differs per adapter (an MCP tool vs a curl command from the
 * workspace skill), and naming the wrong one sends the agent after something
 * that does not exist.
 */
function excerptNote(lines, howToExpand) {
  if (!lines.some((l) => /^\[[^\]]*\] \(excerpt/.test(l))) return '';
  return (
    'Lines marked `(excerpt id=…)` are the first line of a turn addressed to ' +
    'another agent — not a summary of it and not its full text. Do not answer ' +
    'them or assume you know what they said.' +
    (howToExpand ? ` If one bears on your task, ${howToExpand} before acting.` : '')
  );
}

module.exports = {
  RECAP_LINE_MAX_CHARS,
  SPINE_KEEP,
  isRecapEligible,
  formatAttachments,
  formatRecapLine,
  spreadSample,
  selectTail,
  sampleRecap,
  excerptNote,
};
