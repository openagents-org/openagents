'use client';

import { memo } from 'react';
import { AlertCircle } from 'lucide-react';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { CopyMessageButton } from '@/components/chat/copy-message-button';
import { HumanAvatarFace } from '@/components/chat/human-avatar-face';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { MessageAttachments, attachmentsFromMetadata, type AttachmentSource } from '@/components/chat/message-attachments';
import { ConversationBadge, RoutedAgentBadge } from '@/components/chat/routing-badge';
import { Badge } from '@/components/ui/badge';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Message, MessageAvatar, MessageContent, MessageHeader } from '@/components/ui/message';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isOptimistic, mentionsAgent, senderIdentity, type ThreadViewer } from '@/lib/guest-thread';
import { shareRequestOf, type ShareRequestStatus } from '@/lib/share-requests';
import { ShareRequestStatusView, type DecideRequest } from './share-request-status';

/** The workspace's person avatar (same seed → same colour), without the team
 * roster lookup a guest can't make. */
export function PersonAvatar({ seed, className }: { seed: string; className?: string }) {
  return <HumanAvatarFace seed={seed} className={className} />;
}

interface GuestMessageRowProps {
  message: WorkspaceMessage;
  agents: WorkspaceAgent[];
  agentNames: string[];
  agentLabels: Record<string, string>;
  currentGuestId: string | null;
  /** Who is looking; overrides `currentGuestId` (the owner page passes this). */
  viewer?: ThreadViewer;
  showTime?: boolean;
  /** Show who a person's message went to ("→ Claude Code" / "→ Conversation"). */
  showAudience?: boolean;
  onRetry?: (localId: string) => void;
  /** A held request's status as decided so far (overrides the message's own snapshot). */
  requestStatus?: ShareRequestStatus;
  /** Owner page: approve or decline a held request. */
  onDecide?: DecideRequest;
  /** Who approves requests ("Waiting for Raphael's approval"). */
  ownerName?: string;
  /** Link-scoped bytes for the message's attachments; without it attachments aren't shown. */
  attachmentSource?: AttachmentSource;
}

/**
 * One message, rendered with the same building blocks and classes as the
 * workspace's HumanMessageRow / AgentMessageRow (which need the workspace
 * context, reactions and roster a guest doesn't have).
 */
export const GuestMessageRow = memo(function GuestMessageRow({ message, agents, agentNames, agentLabels, currentGuestId, viewer, showTime = true, showAudience = false, onRetry, requestStatus, onDecide, ownerName = '', attachmentSource }: GuestMessageRowProps) {
  const t = useT();
  const { formatTime } = useFormatters();
  const who = senderIdentity(message, agents, viewer ?? currentGuestId);
  const isAgent = who.kind === 'agent';
  const timestamp = showTime && message.createdAt ? formatTime(message.createdAt) : null;
  const sendStatus = message.metadata?.send_status as 'sending' | 'failed' | undefined;
  const sendError = message.metadata?.send_error as string | undefined;
  const pending = isOptimistic(message);
  const attachments = attachmentsFromMetadata(message.metadata);
  const askedAgent = !isAgent ? agents.find((a) => mentionsAgent(message.content, a.agentName)) : undefined;
  const held = !isAgent ? shareRequestOf(message) : null;
  const heldAgent = held ? (askedAgent ?? agents[0]) : undefined;

  return (
    <Message className={cn('gap-3', isAgent ? 'py-2' : 'py-1.5', sendStatus === 'sending' && 'opacity-70')} data-guest-message={message.messageId}>
      <MessageAvatar className="self-start">
        {isAgent
          ? <AgentAvatar name={message.senderName} size={32} />
          : <PersonAvatar seed={who.avatarSeed} className="size-8" />}
      </MessageAvatar>
      <MessageContent className="gap-0.5">
        <MessageHeader className="flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-foreground">{who.isSelf ? t('guestThread.you') : who.name}</span>
          {isAgent && <Badge variant="secondary">{viewer?.isOwner ? t('messageAgentAccess.yours') : t('guestThread.agentBadge')}</Badge>}
          {who.kind === 'guest' && <Badge variant="secondary" data-guest-badge="">{t('guestThread.guestBadge')}</Badge>}
          {timestamp && <span className="font-normal">{timestamp}</span>}
        </MessageHeader>
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className="w-full overflow-visible [&_.markdown-content>*:last-child]:mb-0">
            {/* textOnlyImages: inline workspace-file images would need the
                owner's workspace credentials; a guest gets the alt text. */}
            <MarkdownContent content={message.content} agentNames={agentNames} agentLabels={agentLabels} textOnlyImages />
            {attachmentSource && attachments.length > 0 && <MessageAttachments items={attachments} senderAgentName={isAgent ? message.senderName : null} source={attachmentSource} />}
            {/* Action bar — revealed on hover, as on the workspace's agent turns. */}
            {isAgent && !pending && message.content.trim() && (
              <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <CopyMessageButton text={message.content} />
              </div>
            )}
          </BubbleContent>
        </Bubble>
        {held && (
          <ShareRequestStatusView
            requestId={held.id}
            status={requestStatus ?? held.status}
            guestName={who.name}
            agentName={heldAgent ? (heldAgent.displayName?.trim() || heldAgent.agentName) : ''}
            ownerName={ownerName}
            onDecide={onDecide}
          />
        )}
        {showAudience && !isAgent && !pending && !held && (
          <div className="mt-2" data-message-audience={askedAgent ? 'agent' : 'human'}>
            {askedAgent ? <RoutedAgentBadge names={[askedAgent.agentName]} agents={agents} /> : <ConversationBadge />}
          </div>
        )}
        {sendStatus === 'sending' && <span className="text-xs text-muted-foreground" role="status">{t('guestThread.sending')}</span>}
        {sendStatus === 'failed' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" />
            <span>
              {sendError === 'removed' ? t('guestThread.removedNotice')
                : sendError === 'rate_limited' ? t('guestThread.rateLimited')
                : sendError === 'session' ? t('guestThread.sessionExpired')
                : sendError === 'forbidden' ? t('guestThread.forbidden')
                : t('guestThread.sendFailed')}
            </span>
            {onRetry && sendError !== 'removed' && (
              <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={() => onRetry(message.messageId)}>
                {t('guestThread.retry')}
              </Button>
            )}
          </div>
        )}
      </MessageContent>
    </Message>
  );
});
