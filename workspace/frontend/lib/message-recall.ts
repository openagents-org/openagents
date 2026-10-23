import type { WorkspaceMessage } from './types';

/** Apply fresh recall events to history already loaded by incremental polling. */
export function applyMessageRecalls(messages: WorkspaceMessage[], local: ReadonlySet<string> = new Set()): WorkspaceMessage[] {
  const recalled = new Set([...local, ...messages.filter(m => m.metadata?.recalled).map(m => m.messageId),
    ...messages.map(m => m.metadata?.recalled_message_id).filter((id): id is string => typeof id === 'string')]);
  const assigned = new Set(messages.map(m => (m.metadata?.routing_assignment as { message_id?: string } | undefined)?.message_id).filter(Boolean));
  return messages.filter(m => !m.metadata?.recalled_message_id).map(original => {
    let m = original;
    if (recalled.has(m.messageId)) return { ...m, content: '', metadata: { ...m.metadata, recalled: true, attachments: [], reply_to: undefined } };
    if (assigned.has(m.messageId)) m = { ...m, metadata: { ...m.metadata, routing_choice: { ...(m.metadata?.routing_choice as object || {}), status: 'assigned' } } };
    const quote = m.metadata?.reply_to as { message_id?: string } | undefined;
    return quote?.message_id && recalled.has(quote.message_id)
      ? { ...m, metadata: { ...m.metadata, reply_to: { ...quote, content: '', recalled: true } } } : m;
  });
}
