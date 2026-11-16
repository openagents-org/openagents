import type { WorkspaceMessage } from '@/lib/types';

// ── Message Grouping ──

export type MessageGroup =
  | { type: 'chat'; message: WorkspaceMessage }
  | { type: 'thinking'; sender: string; messages: WorkspaceMessage[] }
  | { type: 'steps'; messages: WorkspaceMessage[] };

export function groupMessages(messages: WorkspaceMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentSteps: WorkspaceMessage[] = [];

  const flushSteps = () => {
    if (currentSteps.length > 0) {
      groups.push({ type: 'steps', messages: [...currentSteps] });
      currentSteps = [];
    }
  };

  messages.forEach((msg) => {
    if (msg.messageType === 'thinking') {
      // Thinking is a first-level block (shown with its author), so flush any
      // pending sub-level steps first to keep ordering. Consecutive thinking
      // chunks from the same sender collapse into one block.
      flushSteps();
      const last = groups[groups.length - 1];
      if (last && last.type === 'thinking' && last.sender === msg.senderName) {
        last.messages.push(msg);
      } else {
        groups.push({ type: 'thinking', sender: msg.senderName, messages: [msg] });
      }
    } else if (msg.messageType === 'status' || msg.messageType === 'todos') {
      // Tool calls / status / todos stay clustered at the sub level.
      currentSteps.push(msg);
    } else {
      flushSteps();
      groups.push({ type: 'chat', message: msg });
    }
  });

  flushSteps();
  return groups;
}

// Stable key for a group
export function groupKey(group: MessageGroup): string {
  if (group.type === 'chat') return group.message.messageId;
  if (group.type === 'thinking') return `thinking-${group.messages[0].messageId}`;
  return `steps-${group.messages[0].messageId}`;
}

/** Status text that ends an agent's turn ("Stopped", "Stopping failed"). */
export const TERMINAL_STATUS_RE = /stopped|stopping failed/i;

export function isTerminalStatus(msg: WorkspaceMessage) {
  return msg.messageType === 'status' && TERMINAL_STATUS_RE.test(msg.content);
}

/**
 * Drop empty steps and thinking that merely previewed the agent's reply. Every
 * other step stays: finished runs fold into a "Took N steps" summary line
 * (see IntermediateSteps) instead of being filtered out.
 */
export function filterThreadSteps(realMessages: WorkspaceMessage[]): WorkspaceMessage[] {
  const isStep = (msg: WorkspaceMessage) => msg.messageType === 'status' || msg.messageType === 'thinking' || msg.messageType === 'todos';

  // Deduplicate: if a chat message follows thinking from the same agent
  // with matching content, hide the thinking (it was the final answer
  // streamed early as "thinking" before being posted as "chat").
  const deduped = realMessages.filter((msg, i) => {
    if (msg.messageType !== 'thinking') return true;
    // Look ahead for a chat message from the same agent
    for (let j = i + 1; j < realMessages.length; j++) {
      const next = realMessages[j];
      if (next.senderName !== msg.senderName) continue;
      if (next.messageType === 'status' || next.messageType === 'thinking') continue;
      // Found a chat message from the same agent — check content overlap.
      // Thinking is truncated to 500 chars + "...", so check if chat
      // starts with the thinking text (minus trailing "...").
      const thinkText = msg.content.replace(/\.\.\.$/,'').trim();
      if (thinkText && next.content.startsWith(thinkText)) return false;
      break;
    }
    return true;
  });

  return deduped.filter((msg) => !isStep(msg) || msg.content.trim());
}
