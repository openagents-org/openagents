import type { WorkspaceAgent, WorkspaceMessage } from './types';

const LEGACY_WELCOME_SUGGESTIONS = [
  'Give me a quick tour of this workspace',
  'What can agents do for me?',
  'How do I connect a coding agent?',
];

/** Recognize seeded welcomes, including existing threads, without changing stored messages. */
export function isYumiWelcome(message: Pick<WorkspaceMessage, 'senderName' | 'senderType' | 'messageType' | 'metadata'>, agent?: Pick<WorkspaceAgent, 'agentName' | 'builtin'>) {
  if (message.senderType !== 'agent' || message.senderName !== 'yumi' || message.messageType !== 'chat' || !agent?.builtin || agent.agentName !== 'yumi') return false;
  if (message.metadata?.onboarding === 'agent_location') return true;
  const suggestions = message.metadata?.suggestions;
  return Array.isArray(suggestions) && suggestions.length === LEGACY_WELCOME_SUGGESTIONS.length &&
    suggestions.every((value, index) => value === LEGACY_WELCOME_SUGGESTIONS[index]);
}
