import { useCallback, useMemo, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceMessage } from '@/lib/types';

export interface QueuedMessage {
  queueId: string;
  content: string;
}

/** Messages an agent has queued and not yet processed, oldest first. The
 *  connector reports them as status messages carrying queue metadata. */
export function deriveQueuedMessages(messages: WorkspaceMessage[], cancelled: ReadonlySet<string> = new Set()): QueuedMessage[] {
  const processed = new Set<string>();
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
  return queued.reverse();
}

export function useQueuedMessages(channelName: string | null, messages: WorkspaceMessage[]) {
  const [cancelled, setCancelled] = useState<Set<string>>(new Set());
  const queued = useMemo(() => deriveQueuedMessages(messages, cancelled), [messages, cancelled]);
  const cancel = useCallback(async (queueId: string) => {
    if (!channelName) return;
    setCancelled((prev) => new Set(prev).add(queueId));
    try {
      await workspaceApi.cancelQueuedMessage(channelName, queueId);
    } catch {}
  }, [channelName]);
  return { queued, cancel };
}
