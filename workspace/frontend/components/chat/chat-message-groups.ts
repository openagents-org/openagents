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
 * Skip empty status messages; when "show all steps" is off, only keep status
 * messages after the last chat message.
 */
export function filterThreadSteps(realMessages: WorkspaceMessage[], showAllSteps: boolean): WorkspaceMessage[] {
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

  const nonEmpty = deduped.filter((msg) => !isStep(msg) || msg.content.trim());
  if (showAllSteps) return nonEmpty;

  let lastChatIndex = -1;
  for (let i = nonEmpty.length - 1; i >= 0; i--) {
    if (!isStep(nonEmpty[i])) {
      lastChatIndex = i;
      break;
    }
  }

  // Check if the very last message is a step (agent still working)
  const lastIsStep = nonEmpty.length > 0 && isStep(nonEmpty[nonEmpty.length - 1]);

  // Keep: all non-step messages, all thinking messages (they persist),
  // and trailing status only if agent is still actively working
  const trailing = nonEmpty.filter((msg, index) => {
    if (!isStep(msg)) return true;
    // Always keep thinking and todos — they provide reasoning context
    if (msg.messageType === 'thinking' || msg.messageType === 'todos') return true;
    // Only keep trailing status if agent is still working
    // (last message is a step, meaning no chat response yet)
    return lastIsStep && index > lastChatIndex;
  });
  // Find the last status-only message and keep only that one
  let lastStatusIndex = -1;
  for (let i = trailing.length - 1; i >= 0; i--) {
    if (trailing[i].messageType === 'status') {
      lastStatusIndex = i;
      break;
    }
  }
  return trailing.filter((msg, index) => {
    if (msg.messageType !== 'status') return true;
    return index === lastStatusIndex;
  });
}
