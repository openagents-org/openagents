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
