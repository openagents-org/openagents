import { useCallback, useMemo, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';

export interface QueuedMessage {
  queueId: string;
  content: string;
  /** Sent to a busy agent, which has not confirmed queueing it yet. */
  pending?: boolean;
}

/** A message sent while an agent in the thread was busy: treated as queued
 *  until the agent's own queue report replaces it (or it times out). */
export interface PendingQueueEntry {
  id: string;
  content: string;
  sentAt: number;
}

/** How long a pending entry waits for the agent's queue report. */
export const PENDING_QUEUE_MS = 8000;

/** Messages an agent has queued and not yet processed, oldest first. The
 *  connector reports them as status messages carrying queue metadata. */
export function deriveQueuedMessages(messages: WorkspaceMessage[], cancelled: ReadonlySet<string> = new Set(), pending: PendingQueueEntry[] = []): QueuedMessage[] {
  const processed = new Set<string>(cancelledQueueIds(messages));
  for (const msg of messages) {
    if (msg.messageType !== 'status') continue;
    const meta = msg.metadata as Record<string, unknown> | undefined;
    if (meta?.queue_id && meta?.queue_status === 'processed') processed.add(meta.queue_id as string);
  }
  const queued: QueuedMessage[] = [];
  const seen = new Set<string>();
  // Walk newest first so each queue id keeps its latest state.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.messageType !== 'status') continue;
    const meta = msg.metadata as Record<string, unknown> | undefined;
    if (!meta?.queue_id || !meta?.queued_message) continue;
    const qid = meta.queue_id as string;
    if (seen.has(qid) || cancelled.has(qid) || processed.has(qid)) continue;
    seen.add(qid);
    queued.push({ queueId: qid, content: meta.queued_message as string });
  }
  return [
    ...queued.reverse(),
    ...unresolvedPending(messages, pending).map((p) => ({ queueId: p.id, content: p.content, pending: true })),
  ];
}

const QUEUE_CANCEL_PREFIX = '__queue_cancel:';

function queueMeta(msg: WorkspaceMessage): { id: string; text?: string; processed: boolean } | null {
  if (msg.messageType !== 'status') return null;
  const meta = msg.metadata as Record<string, unknown> | undefined;
  if (typeof meta?.queue_id !== 'string') return null;
  return {
    id: meta.queue_id,
    text: typeof meta.queued_message === 'string' ? meta.queued_message : undefined,
    processed: meta.queue_status === 'processed',
  };
}

const STEP_TYPES = new Set(['status', 'thinking', 'todos']);
/** How recent a working step must be to count as "busy" without presence. */
const RECENT_STEP_MS = 120_000;

/**
 * Whether an agent is mid-task in this thread, so a new message would be
 * queued. Presence (busy_channels) can lag by a discovery poll, so the
 * thread itself has the last word: a finished reply means it is done, and a
 * fresh working step means it is still going.
 */
export function agentBusyInThread(agent: Pick<WorkspaceAgent, 'agentName' | 'busyChannels'>, channel: string, messages: WorkspaceMessage[], now = Date.now()): boolean {
  let last: WorkspaceMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.senderType === 'agent' && msg.senderName === agent.agentName && msg.messageType !== 'loading') { last = msg; break; }
  }
  if ((agent.busyChannels ?? []).includes(channel)) return !last || last.messageType !== 'chat';
  if (!last || !STEP_TYPES.has(last.messageType)) return false;
  const at = last.createdAt ? Date.parse(last.createdAt) : NaN;
  return Number.isFinite(at) && now - at < RECENT_STEP_MS;
}

/** Pending entries the agent has not reported on yet. Its queue report
 *  carries the first 200 characters, so that prefix resolves an entry. */
export function unresolvedPending(messages: WorkspaceMessage[], pending: PendingQueueEntry[]): PendingQueueEntry[] {
  if (!pending.length) return pending;
  const reported = messages.map((m) => queueMeta(m)?.text?.trim()).filter((text): text is string => !!text);
  return pending.filter((p) => !reported.some((text) => p.content.trim().startsWith(text)));
}

/** Queue ids the user cancelled, from the queue_cancel events they posted. */
function cancelledQueueIds(messages: WorkspaceMessage[]): string[] {
  return messages
    .filter((m) => m.messageType === 'queue_cancel' && m.content.startsWith(QUEUE_CANCEL_PREFIX))
    .map((m) => m.content.slice(QUEUE_CANCEL_PREFIX.length));
}

/**
 * The chat log without the queue bookkeeping. A message an agent queued is
 * left out while it waits (the Queue tab shows it) and reappears where the
 * agent starts processing it; a cancelled one never appears. The queue status
 * lines and cancel signals themselves are dropped.
 *
 * The connector reports the first 200 characters of the queued message, so
 * the sender's message is matched on that: the latest earlier message from a
 * person whose text starts the same way.
 */
export function arrangeQueuedMessages(messages: WorkspaceMessage[], pending: PendingQueueEntry[] = []): WorkspaceMessage[] {
  const hidden = new Set<string>();
  const releaseAt = new Map<string, WorkspaceMessage>();  // processed status id → the queued message
  const queuedBy = new Map<string, WorkspaceMessage>();     // queue id → the queued message
  messages.forEach((msg, index) => {
    const queue = queueMeta(msg);
    if (!queue) return;
    if (queue.processed) {
      const original = queuedBy.get(queue.id);
      if (original) releaseAt.set(msg.messageId, original);
      return;
    }
    if (!queue.text || queuedBy.has(queue.id)) return;
    const snippet = queue.text.trim();
    for (let i = index - 1; i >= 0; i--) {
      const candidate = messages[i];
      if (candidate.senderType !== 'human' && candidate.senderType !== 'user') continue;
      if (candidate.messageType !== 'chat' || hidden.has(candidate.messageId)) continue;
      if (!snippet || !candidate.content.trim().startsWith(snippet)) continue;
      hidden.add(candidate.messageId);
      queuedBy.set(queue.id, candidate);
      break;
    }
  });
  // Messages sent to a busy agent stay hidden while its queue report is on the way.
  for (const entry of unresolvedPending(messages, pending)) {
    const text = entry.content.trim();
    for (let i = messages.length - 1; i >= 0; i--) {
      const candidate = messages[i];
      if (candidate.senderType !== 'human' && candidate.senderType !== 'user') continue;
      if (candidate.messageType !== 'chat' || hidden.has(candidate.messageId)) continue;
      if (candidate.content.trim() !== text) continue;
      hidden.add(candidate.messageId);
      break;
    }
  }
  if (!hidden.size && !messages.some((m) => queueMeta(m) || m.messageType === 'queue_cancel')) return messages;

  const arranged: WorkspaceMessage[] = [];
  for (const msg of messages) {
    const released = releaseAt.get(msg.messageId);
    if (released) arranged.push(released);
    if (hidden.has(msg.messageId) || queueMeta(msg) || msg.messageType === 'queue_cancel') continue;
    arranged.push(msg);
  }
  return arranged;
}

export function useQueuedMessages(channelName: string | null, messages: WorkspaceMessage[], pending: PendingQueueEntry[] = []) {
  const [cancelled, setCancelled] = useState<Set<string>>(new Set());
  const queued = useMemo(() => deriveQueuedMessages(messages, cancelled, pending), [messages, cancelled, pending]);
  const cancel = useCallback(async (queueId: string) => {
    if (!channelName) return;
    setCancelled((prev) => new Set(prev).add(queueId));
    try {
      await workspaceApi.cancelQueuedMessage(channelName, queueId);
    } catch {}
  }, [channelName]);
  return { queued, cancel };
}
