import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';

function knownModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  return model && !/^(auto(?:\s*\(.*\))?|default|unknown|agent default)$/i.test(model) ? model : null;
}

/** Prefer the response's model; use an explicit configuration on older agents. */
export function messageModel(message: Pick<WorkspaceMessage, 'metadata'>, agent?: Pick<WorkspaceAgent, 'model'>): string | null {
  return knownModel(message.metadata?.model) || knownModel(agent?.model);
}
