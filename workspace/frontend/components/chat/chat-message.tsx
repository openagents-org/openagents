'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { WorkspaceMessage, WorkspaceAgent } from '@/lib/types';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { useWorkspace } from '@/lib/workspace-context';
import { useFormatters, useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { approvalFromMetadata } from '@/lib/approvals';
import { handoffFromMessage } from '@/lib/handoff'; // v1.1 M6
import { isYumiWelcome } from '@/lib/yumi-onboarding';
import { useHumanNames } from '@/hooks/use-team-roster';
import { attachmentsFromMetadata } from './message-attachments';
import { HumanMessageRow } from './human-message-row';
import { AgentMessageRow } from './agent-message-row';

interface ChatMessageProps {
  message: WorkspaceMessage;
  agents?: WorkspaceAgent[];
  /** True only for the trailing message — gates the suggestion chips. */
  isLast?: boolean;
  /** Send a suggested prompt as the user's message (tap-to-ask chips). */
  onSuggestion?: (text: string) => void;
  onMentionPerson?: (email: string) => void;
  onReply?: (message: WorkspaceMessage) => void;
  onRecall?: (message: WorkspaceMessage) => Promise<void>;
}

export const ChatMessage = memo(function ChatMessage({ message, agents = [], isLast = false, onSuggestion, onMentionPerson, onReply, onRecall }: ChatMessageProps) {
  const { currentUser } = useWorkspace();
  const t = useT();
  const { formatTime } = useFormatters();
  const isHuman = message.senderType === 'human' || message.senderType === 'user';
  const isSystem = message.messageType === 'status';
  // Requests from people or agents render as the same actionable approval card
  // (buttons and all) instead of prose. The plain-text content is what
  // history readers and bridges see; the card is built from the record.
  const approval = message.messageType === 'approval' ? approvalFromMetadata(message.metadata) : null;
  // v1.1 M6 — an agent handing work to another agent. The connector posts
  // "@to request…" as plain text and the same record in metadata.handoff;
  // the card renders the record so the sections stay readable.
  const handoff = !approval ? handoffFromMessage(message.metadata) : null;

  const agentNames = useMemo(() => agents.map((a) => a.agentName), [agents]);
  const agentLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const a of agents) {
      if (a.displayName) labels[a.agentName] = agentLabel(a);
    }
    return labels;
  }, [agents]);
  // People's @mentions (`@sam@demo.io`) render as "@Sam Okafor"; mentions of
  // the viewer get the stronger highlight.
  const humanNames = useHumanNames();
  const selfMention = currentUser.isAuthenticated && currentUser.id.includes('@') ? currentUser.id.toLowerCase() : undefined;
  const agent = agents.find((a) => a.agentName === message.senderName);
  const yumiWelcome = isYumiWelcome(message, agent);
  const displayContent = yumiWelcome ? t('yumiOnboarding.greeting') : message.content;
  const attachments = attachmentsFromMetadata(message.metadata);
  const timestamp = message.createdAt ? formatTime(message.createdAt) : null;

  // Status messages — subtle inline
  if (isSystem) {
    const isQueued = message.content.includes('queued');
    return (
      <Marker className="justify-center py-1">
        <MarkerContent className={cn('text-xs italic', isQueued && 'text-foreground/80')}>
          {agent ? agentLabel(agent) : message.senderName}: {message.content}
        </MarkerContent>
      </Marker>
    );
  }

  const shared = { message, agents, agentNames, agentLabels, humanNames, selfMention, timestamp, attachments, approval };

  if (isHuman) {
    return <HumanMessageRow {...shared} onMentionPerson={onMentionPerson} onReply={onReply} onRecall={onRecall} />;
  }

  return (
    <AgentMessageRow
      {...shared}
      agent={agent}
      handoff={handoff}
      displayContent={displayContent}
      yumiWelcome={yumiWelcome}
      isLast={isLast}
      onSuggestion={onSuggestion}
      onReply={onReply}
    />
  );
});
