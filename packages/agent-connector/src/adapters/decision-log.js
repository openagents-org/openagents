/**
 * Pure helpers for the Claude adapter's decision log ("constraint pinning").
 *
 * The decision log is a per-channel knowledge entry that records every
 * decision the user has confirmed. The adapter re-reads it on every message
 * and injects it into the CLI system prompt — the only position that survives
 * both the CLI's auto-compaction and a session reset. Everything here is
 * side-effect free so it can be unit tested without an adapter instance.
 */

'use strict';

const crypto = require('crypto');

/** Max characters a single recap line may occupy before being cut. */
const RECAP_LINE_MAX_CHARS = 2000;

/** Default budget for the pinned-decisions block inside the system prompt. */
const PINNED_DECISIONS_MAX_CHARS = 4000;

/**
 * Canonical knowledge-entry title for a channel's decision log. The slug the
 * backend derives from it is NOT stable (collisions get a numeric suffix), so
 * lookups must match on this exact title, never on the slug.
 */
function decisionLogTitle(channelName) {
  return `Decisions for channel ${channelName}`;
}

/**
 * Stable hash of the decision log content. null/undefined and '' hash
 * identically so "no entry yet" never reads as a change.
 */
function hashDecisions(content) {
  return crypto.createHash('sha256').update(String(content || '').trim(), 'utf-8').digest('hex');
}

/**
 * Fingerprint of everything the system prompt pins from the decision log —
 * the entry id AND the content — used to detect that a persistent CLI
 * process was spawned with an outdated prompt. Content alone is not enough:
 * a deleted-and-recreated log can carry identical content under a new id,
 * and a prompt still holding the old id would send updates to a dead entry.
 */
function decisionFingerprint(entryId, content) {
  return crypto.createHash('sha256')
    .update(`${entryId || ''}\u0000${String(content || '').trim()}`, 'utf-8')
    .digest('hex');
}

/**
 * Pick the channel's decision entry from a knowledge listing: exact-title
 * matches only, earliest created_at wins (concurrent creates produce
 * duplicates — the earliest is the one other turns have been updating).
 * Returns { entry, duplicates } where duplicates counts the extra matches.
 */
function pickDecisionEntry(entries, channelName) {
  const title = decisionLogTitle(channelName);
  const matches = (entries || []).filter((e) => e && e.title === title);
  if (matches.length === 0) return { entry: null, duplicates: 0 };
  const sorted = matches.slice().sort((a, b) => {
    // ISO-8601 strings compare chronologically as strings; entries without a
    // timestamp are anomalous and sort last so a dated original wins.
    const ka = a.created_at || '\uffff';
    const kb = b.created_at || '\uffff';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { entry: sorted[0], duplicates: matches.length - 1 };
}

/**
 * Fit the decision log into a character budget without ever cutting a line
 * in half. Over budget, whole lines are kept from the head (earliest
 * decisions) and the tail (latest decisions) with the middle dropped, so
 * neither end of the log silently disappears.
 * Returns { text, truncated, omitted }.
 */
function renderPinnedDecisions(content, { maxChars = PINNED_DECISIONS_MAX_CHARS } = {}) {
  const text = String(content || '').trim();
  if (!text) return { text: '', truncated: false, omitted: 0 };
  if (text.length <= maxChars) return { text, truncated: false, omitted: 0 };

  const lines = text.split('\n');
  // Reserve room for the omission marker inserted between head and tail.
  const budget = Math.max(maxChars - 80, 0);
  const headBudget = Math.floor(budget / 2);

  const head = [];
  let used = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    const cost = lines[i].length + 1;
    if (used + cost > headBudget) break;
    head.push(lines[i]);
    used += cost;
  }

  const tail = [];
  let j = lines.length - 1;
  for (; j >= i; j--) {
    const cost = lines[j].length + 1;
    if (used + cost > budget) break;
    tail.unshift(lines[j]);
    used += cost;
  }

  const omitted = lines.length - head.length - tail.length;
  if (omitted <= 0) {
    // Everything fit after all (short middle) — no marker needed.
    return { text: [...head, ...tail].join('\n'), truncated: false, omitted: 0 };
  }
  const marker = `[… ${omitted} middle line(s) omitted — read the decision log entry for the full list …]`;
  return {
    text: [...head, marker, ...tail].join('\n'),
    truncated: true,
    omitted,
  };
}

/** A message qualifies for the recap when it is real chat with content. */
function isRecapEligible(msg, currentMessage) {
  if (!msg) return false;
  const mt = msg.messageType || 'chat';
  if (mt === 'status' || mt === 'thinking' || mt === 'loading') return false;
  const text = (msg.content || '').trim();
  if (!text) return false;
  if (text === currentMessage) return false;
  return true;
}

function formatRecapLine(msg) {
  const text = (msg.content || '').trim();
  const who = msg.senderType === 'human'
    ? (msg.senderName || 'user')
    : (msg.senderName || 'agent');
  const cut = text.length > RECAP_LINE_MAX_CHARS
    ? text.slice(0, RECAP_LINE_MAX_CHARS) + '…'
    : text;
  // An excerpt from a projected context view is labelled and carries its id.
  // Both matter: unlabelled, the model reads one clipped line as the whole
  // turn and answers a question nobody asked; without the id it has no way
  // back to the real text even when it notices it needs it.
  //
  // "excerpt", not "summary": it is the first non-empty line, chosen by
  // nothing that read the text. The label is the model's cue for how far to
  // trust the line, so calling it a summary would overstate it.
  if (msg.truncated) {
    const ref = msg.messageId ? ` id=${msg.messageId}` : '';
    return `[${who}] (excerpt${ref}) ${cut}`;
  }
  return `[${who}] ${cut}`;
}

/**
 * Build recap lines from the channel's opening messages (fetched ascending)
 * and its most recent ones (fetched descending, already reversed to
 * chronological). Head keeps the original requirement, tail keeps the live
 * discussion; overlap is removed by event ID. An omission marker is inserted
 * only when the two windows do not overlap, i.e. messages in between were
 * actually dropped.
 */
function sampleRecap(headMsgs, tailMsgs, currentMessage, { headKeep = 5, tailKeep = 15 } = {}) {
  const head = (headMsgs || [])
    .filter((m) => isRecapEligible(m, currentMessage))
    .slice(0, headKeep);
  const tail = (tailMsgs || [])
    .filter((m) => isRecapEligible(m, currentMessage))
    .slice(-tailKeep);

  const headIds = new Set(head.map((m) => m.messageId).filter(Boolean));
  const tailDeduped = tail.filter((m) => !m.messageId || !headIds.has(m.messageId));
  const windowsOverlap = tailDeduped.length < tail.length;

  const lines = head.map(formatRecapLine);
  if (head.length > 0 && tailDeduped.length > 0 && !windowsOverlap) {
    lines.push('[… earlier messages omitted …]');
  }
  lines.push(...tailDeduped.map(formatRecapLine));
  return lines;
}

module.exports = {
  PINNED_DECISIONS_MAX_CHARS,
  RECAP_LINE_MAX_CHARS,
  decisionLogTitle,
  hashDecisions,
  decisionFingerprint,
  pickDecisionEntry,
  renderPinnedDecisions,
  isRecapEligible,
  formatRecapLine,
  sampleRecap,
};
