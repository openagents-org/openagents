import { eventToMessage, type ONMEvent, type WorkspaceMessage } from './types';

/** Keep the canonical send response visible until polling catches up. */
export function acknowledgeMessage(pending: WorkspaceMessage[], userId: string, loadingId: string, event: ONMEvent): WorkspaceMessage[] {
  return pending.flatMap(message => {
    if (message.messageId === userId) return [{ ...eventToMessage(event), sessionId: message.sessionId }];
    if (message.messageId !== loadingId) return [message];
    if (Array.isArray(event.metadata?.target_agents) && event.metadata.target_agents.includes('__no_response__')) return [];
    return [{ ...message, metadata: { ...message.metadata, _requestId: event.id } }];
  });
}

export function pendingMessagesForDisplay(real: WorkspaceMessage[], pending: WorkspaceMessage[]): WorkspaceMessage[] {
  const ids = new Set(real.map(m => m.messageId));
  return pending.filter(message => {
    if (ids.has(message.messageId)) return false;
    if (message.messageType !== 'loading') return true;
    const requestIndex = real.findIndex(m => m.messageId === message.metadata?._requestId);
    return requestIndex < 0 || !real.slice(requestIndex + 1).some(m => m.senderType === 'agent');
  });
}
