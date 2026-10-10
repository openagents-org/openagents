import type { WorkspaceMessage } from './types';

/**
 * The optimistic messages of one thread that the server has not confirmed
 * yet, given the real messages loaded for that thread:
 * - the optimistic user message stays until the real user message arrives;
 * - the "…" waiting bubble stays until a real agent message arrives after
 *   that user message.
 *
 * Derived from the thread's real messages on every render rather than
 * cleared by hand, so it holds across a thread switch: coming back to a
 * thread the agent has not acknowledged yet still shows the bubble, and
 * coming back to one it answered in the meantime never shows a stale one.
 */
export function pendingOptimisticMessages(
  optimistic: WorkspaceMessage[],
  sessionMessages: WorkspaceMessage[],
): WorkspaceMessage[] {
  return optimistic.filter((m) => {
    if (m.messageId.startsWith('optimistic-user-')) {
      return !sessionMessages.some((real) => real.senderType !== 'agent' && real.content === m.content);
    }
    if (m.messageId.startsWith('optimistic-loading-')) {
      const userMsgIdx = sessionMessages.findIndex(
        (real) => real.senderType !== 'agent' && real.content === m.metadata?._userContent
      );
      const hasAgentAfterUser = userMsgIdx >= 0 && sessionMessages.slice(userMsgIdx + 1).some(
        (real) => real.senderType === 'agent'
      );
      return !hasAgentAfterUser;
    }
    return true;
  });
}
