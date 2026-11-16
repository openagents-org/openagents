'use client';

import * as React from 'react';
import type { WorkspaceAgent, KnowledgeEntry } from '@/lib/types';
import { isRecentAgent } from '@/lib/helpers';
import { agentAvailability, type AgentAvailability } from '@/lib/collab'; // v1.1 M3
import { useWorkspace } from '@/lib/workspace-context';
import { knowledgeTitle } from '@/lib/knowledge-title';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useThreadMentionParticipants } from '@/hooks/use-thread-mention-emails';
import { filterMentionPeople, type MentionPerson } from '@/lib/people-mentions';

export type MentionItem =
  | { type: 'all' }
  | { type: 'agent'; agent: WorkspaceAgent }
  | { type: 'person'; person: MentionPerson }
  | { type: 'knowledge'; entry: KnowledgeEntry };

const AVAILABILITY_RANK: Record<AgentAvailability, number> = { online: 0, busy: 1, waiting: 2, device_offline: 3, offline: 4 };

/** Who and what the composer's @ picker can offer for the current filter. */
export function useComposerMentions({ conversationId, agents, knowledge, mentionFilter, showMentions }: {
  conversationId: string | null;
  agents: WorkspaceAgent[];
  knowledge: KnowledgeEntry[];
  mentionFilter: string;
  showMentions: boolean;
}) {
  const team = useTeamRoster();
  const participants = useThreadMentionParticipants(conversationId, showMentions);
  const participantEmails = participants.emails;
  const threadPeople = team.filter(person => participantEmails.includes(person.email.toLowerCase()));
  const mentionPeople = React.useMemo(() => team.map((m) => ({
    email: m.email,
    name: (m.displayName || '').trim() || m.email,
  })), [team]);

  // v1.1 M3: a pending approval makes an agent "waiting" in the picker too.
  const { pendingApprovalsByAgent, currentUser, sessions } = useWorkspace();
  // Only joined people are selectable; keep the full roster for rendering saved drafts.
  const selfEmail = currentUser.id.includes('@') ? currentUser.id : null;
  const availabilityOf = (a: WorkspaceAgent): AgentAvailability =>
    agentAvailability(a, pendingApprovalsByAgent[a.agentName] ?? 0);

  const filter = mentionFilter.toLowerCase();

  // Suggest online agents plus recently-seen / device-offline ones — the
  // request queues for those (v1.1 M3), so they stay pickable with a muted
  // hint; long-gone agents would only clutter the picker. Available first.
  // Filter matches either the ASCII agent name or the user-set display name
  // (e.g. typing "小" finds the agent labeled "小明"); the inserted mention is
  // always the agent name.
  const filteredAgents = agents
    .filter(a => participants.agents.includes(a.agentName))
    .filter(
      (a) => (a.status === 'online' || isRecentAgent(a)) && (
        a.agentName.toLowerCase().includes(filter) ||
        (a.displayName || '').toLowerCase().includes(filter)
      )
    )
    .sort((a, b) => AVAILABILITY_RANK[availabilityOf(a)] - AVAILABILITY_RANK[availabilityOf(b)]);

  const filteredKnowledge = knowledge.filter(
    (k) => knowledgeTitle(k.title, sessions).toLowerCase().includes(filter) ||
           k.slug.toLowerCase().includes(filter) ||
           `knowledge:${k.slug}`.toLowerCase().startsWith(filter)
  );

  const filteredPeople = filterMentionPeople(threadPeople, mentionFilter, selfEmail);

  const offerAll = !!conversationId && !conversationId.startsWith('dm:') && 'all'.startsWith(filter);

  const mentionItems: MentionItem[] = [
    ...(offerAll ? [{ type: 'all' as const }] : []),
    ...filteredPeople.map((person): MentionItem => ({ type: 'person', person })),
    ...filteredAgents.map((agent): MentionItem => ({ type: 'agent', agent })),
    ...filteredKnowledge.map((entry): MentionItem => ({ type: 'knowledge', entry })),
  ];

  return {
    team,
    mentionPeople,
    participantEmails,
    selfEmail,
    sessions,
    availabilityOf,
    offerAll,
    filteredPeople,
    filteredAgents,
    filteredKnowledge,
    mentionItems,
  };
}
