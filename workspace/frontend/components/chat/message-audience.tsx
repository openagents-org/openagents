'use client';

import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { ConversationBadge, RoutedAgentBadge, RoutingPendingBadge } from './routing-badge';
import { RoutingChoiceCard } from './routing-choice-card';

export function messageAudience(message: WorkspaceMessage): 'human' | 'agent' | 'pending' | 'routing' | null {
  if (message.sessionId.startsWith('dm:') || message.metadata.recalled
      || message.metadata.approval_id || message.metadata.approval || message.messageType !== 'chat') return null;
  if (message.messageId.startsWith('optimistic-')) return message.metadata._routingPending === true ? 'routing' : null;
  const choice = message.metadata.routing_choice as { status?: string } | undefined;
  if (choice?.status === 'assigned') return 'agent';
  if (choice?.status === 'pending') return 'pending';
  if (message.targetAgents?.some(name => name !== '__no_response__')) return 'agent';
  return message.targetAgents?.length === 1 && message.targetAgents[0] === '__no_response__' ? 'human' : null;
}

export function MessageAudience({ message, isSender, agents = [] }: { message: WorkspaceMessage; isSender: boolean; agents?: WorkspaceAgent[] }) {
  const audience = messageAudience(message);
  if (!audience) return null;
  if (audience === 'routing') return <div className="mt-2"><RoutingPendingBadge /></div>;
  if (audience === 'pending') return <RoutingChoiceCard message={message} agents={agents} />;
  if (audience === 'agent') {
    const choice = message.metadata.routing_choice as { agent?: string } | undefined;
    const names = message.targetAgents?.filter(name => !name.startsWith('__')) || [];
    if (!names.length && choice?.agent) names.push(choice.agent);
    return <div className="mt-2"><RoutedAgentBadge names={names} agents={agents} /></div>;
  }
  return isSender
    ? <RoutingChoiceCard message={message} agents={agents} conversation />
    : <div className="mt-2"><ConversationBadge /></div>;
}

/** Completion routing can pause for a person or finish without an agent handoff. */
export function CompletionAudience({ message, agents = [] }: { message: WorkspaceMessage; agents?: WorkspaceAgent[] }) {
  const continuation = message.metadata.orchestration as { action?: string; agent?: string; reason?: string } | undefined;
  const choice = message.metadata.routing_choice as { continuation?: boolean; task?: string; reason?: string } | undefined;
  // Older completion failures persisted an empty assignment prompt. They
  // describe no remaining work and must not invite an arbitrary handoff.
  const legacyUnavailable = choice?.continuation === true && !choice.task?.trim()
    && choice.reason === 'Could not confidently choose the next agent.';
  if (continuation?.action === 'wait' || continuation?.action === 'stop' || legacyUnavailable) {
    return <div className="mt-2" title={continuation?.reason || choice?.reason}><ConversationBadge /></div>;
  }
  if (continuation?.action === 'next' && typeof continuation.agent === 'string') {
    return <div className="mt-2"><RoutedAgentBadge names={[continuation.agent]} agents={agents} /></div>;
  }
  return <RoutingChoiceCard message={message} agents={agents} />;
}
