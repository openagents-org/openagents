'use client';

import type { WorkspaceAgent, WorkspaceMessage, ApprovalRequest } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageAvatar, MessageContent, MessageHeader } from '@/components/ui/message';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { isMyAddress, myAddress } from '@/lib/dm';
import { humanMessageContent } from '@/lib/message-content';
import { guestDisplayName, isGuestMessage } from '@/lib/guest-sender';
import { ApprovalCard } from './approval-card';
import { HumanAvatar } from './human-avatar';
import { MarkdownContent } from './markdown-content';
import { MessageAttachments, type MessageAttachment } from './message-attachments';
import { MessageAudience } from './message-audience';
import { MessageReactions } from './message-reactions';
import { ReplyCitation, type ReplyCitationData } from './reply-citation';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { ShareRequestStatusView } from '@/components/guest-thread/share-request-status';
import { shareRequestOf, type ShareRequestStatus } from '@/lib/share-requests';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface HumanMessageRowProps {
  message: WorkspaceMessage;
  agents: WorkspaceAgent[];
  agentNames: string[];
  agentLabels: Record<string, string>;
  humanNames: Record<string, string>;
  selfMention?: string;
  timestamp: string | null;
  attachments: MessageAttachment[];
  approval: ApprovalRequest | null;
  onMentionPerson?: (email: string) => void;
  onReply?: (message: WorkspaceMessage) => void;
  onRecall?: (message: WorkspaceMessage) => Promise<void>;
  /** OpenAgents Share: where this guest's held request stands. */
  shareRequestStatus?: ShareRequestStatus;
}

// Everyone reads the same way: avatar + name + time on the left, like the
// agent turns. A shared workspace has several people in it, so your own turns
// stay in the same column as theirs rather than becoming right-aligned
// bubbles — the thread reads as one transcript.
export function HumanMessageRow({ message, agents, agentNames, agentLabels, humanNames, selfMention, timestamp, attachments, approval, onMentionPerson, onReply, onRecall, shareRequestStatus }: HumanMessageRowProps) {
  const { currentUser } = useWorkspace();
  const t = useT();
  // In DMs the sender address identifies the viewer too — including legacy
  // conversations stored under the shared `human:user` address.
  const isCurrentUser = (!!message.senderId && message.senderId === currentUser.id)
    || (!!message.senderAddress && (message.sessionId || '').startsWith('dm:')
      && isMyAddress(message.senderAddress, myAddress(currentUser)));
  // A shared-thread guest has a name, not a mentionable address.
  const guest = isGuestMessage(message);
  const senderEmail = [message.senderAddress?.replace(/^human:/, ''), message.senderId, message.metadata?.sender_email]
    .find((value): value is string => typeof value === 'string' && EMAIL.test(value));
  const mentionEmail = guest ? undefined : senderEmail;
  const seed = message.senderId || message.senderName || 'human';
  const displayName = isCurrentUser
    ? 'You'
    : guest
      ? guestDisplayName(message, undefined, t('chat.guestBadge'))
      : ((mentionEmail && humanNames[mentionEmail.toLowerCase()]) || (message.senderName && message.senderName !== 'user' ? message.senderName : 'User'));
  const humanContent = humanMessageContent(message.content, attachments);
  const held = guest ? shareRequestOf(message) : null;
  const heldAgent = held ? agents.find((a) => message.content.includes(`@${a.agentName}`)) : undefined;
  const heldAgentLabel = heldAgent ? (heldAgent.displayName || heldAgent.agentName) : '';
  const recalled = !!message.metadata.recalled;
  const canRecall = isCurrentUser && onRecall && !message.messageId.startsWith('optimistic-')
    && message.targetAgents?.length === 1 && message.targetAgents[0] === '__no_response__'
    && !message.metadata.routing_assignment && !message.metadata.approval_id
    && (message.metadata.routing_choice as { status?: string } | undefined)?.status !== 'assigned';

  return (
    <Message className="gap-3 py-1.5">
      <MessageAvatar className="self-start">
        <HumanAvatar email={senderEmail || (isCurrentUser ? currentUser.id : seed)} className="size-8" />
      </MessageAvatar>
      <MessageContent className="gap-0.5">
        <MessageHeader className="flex-wrap items-baseline gap-x-2 gap-y-1">
          {onMentionPerson && mentionEmail ? (
            <WithTooltip label={t('peopleMessaging.mentionName', { name: displayName })}>
              <Button variant="link" onClick={() => onMentionPerson(mentionEmail.toLowerCase())}
                className="h-auto p-0 text-sm font-semibold text-foreground">
                {displayName}
              </Button>
            </WithTooltip>
          ) : <span className="text-sm font-semibold text-foreground">{displayName}</span>}
          {guest && <Badge variant="secondary" data-guest-badge="">{t('chat.guestBadge')}</Badge>}
          {timestamp && <span className="font-normal">{timestamp}</span>}
          {/* v1.1 M5 — information vs execution in directed threads */}
          {message.metadata?.informational === true && (
            <WithTooltip label={t('brief.infoTagHint')}><Badge variant="outline">{t('brief.infoTag')}</Badge></WithTooltip>
          )}
          {message.metadata?.from_non_director === true && (
            <WithTooltip label={t('brief.nonDirectorHint')}><Badge variant="secondary">{t('brief.nonDirectorTag')}</Badge></WithTooltip>
          )}
        </MessageHeader>
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className="w-full overflow-visible [&_.markdown-content>*:last-child]:mb-0">
            {recalled ? <p className="text-xs text-muted-foreground italic">{t('messageReply.recalled')}</p> : approval ? <ApprovalCard approval={approval} /> : <>
              <ReplyCitation citation={message.metadata.reply_to as ReplyCitationData | undefined} />
              {humanContent && <MarkdownContent content={humanContent} agentNames={agentNames} agentLabels={agentLabels} humanNames={humanNames} selfMention={selfMention} />}
              <MessageAttachments items={attachments} />
            </>}
          </BubbleContent>
        </Bubble>
        {/* A guest's request held for the owner: its status instead of the routing badge. */}
        {held && !recalled ? (
          <ShareRequestStatusView
            requestId={held.id}
            status={shareRequestStatus ?? held.status}
            guestName={displayName}
            agentName={heldAgentLabel}
            ownerName=""
            pendingLabel={t('share.requestWaiting')}
          />
        ) : !approval && !recalled && <MessageAudience message={message} isSender={isCurrentUser} agents={agents} />}
        {!approval && !recalled && <MessageReactions messageId={message.messageId}
          onReply={onReply ? () => onReply(message) : undefined}
          onRecall={canRecall ? () => onRecall(message) : undefined} />}
      </MessageContent>
    </Message>
  );
}
