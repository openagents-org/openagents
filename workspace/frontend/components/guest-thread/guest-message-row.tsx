'use client';

import { memo } from 'react';
import { AlertCircle, User } from 'lucide-react';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Badge } from '@/components/ui/badge';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Message, MessageAvatar, MessageContent, MessageHeader } from '@/components/ui/message';
import { humanColor } from '@/lib/human-color';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { senderIdentity, type ThreadViewer } from '@/lib/guest-thread';

/** Same markup as the workspace HumanAvatar, without the team roster lookup
 * (a guest can't read the workspace roster). */
export function PersonAvatar({ seed, className }: { seed: string; className?: string }) {
  return (
    <span className={cn('flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full', className)} style={{ backgroundColor: humanColor(seed) }} aria-hidden="true">
      <User className="size-3.5 text-foreground" />
    </span>
  );
}

interface GuestMessageRowProps {
  message: WorkspaceMessage;
  agents: WorkspaceAgent[];
  agentNames: string[];
  agentLabels: Record<string, string>;
  currentGuestId: string | null;
  /** Who is looking; overrides `currentGuestId` (the owner room passes this). */
  viewer?: ThreadViewer;
  showTime?: boolean;
  onRetry?: (localId: string) => void;
}

/**
 * One message, rendered with the same building blocks and classes as the
 * workspace's HumanMessageRow / AgentMessageRow (which need the workspace
 * context, reactions and roster a guest doesn't have).
 */
export const GuestMessageRow = memo(function GuestMessageRow({ message, agents, agentNames, agentLabels, currentGuestId, viewer, showTime = true, onRetry }: GuestMessageRowProps) {
  const t = useT();
  const { formatTime } = useFormatters();
  const who = senderIdentity(message, agents, viewer ?? currentGuestId);
  const isAgent = who.kind === 'agent';
  const timestamp = showTime && message.createdAt ? formatTime(message.createdAt) : null;
  const sendStatus = message.metadata?.send_status as 'sending' | 'failed' | undefined;
  const sendError = message.metadata?.send_error as string | undefined;

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
          {isAgent && <Badge variant="secondary">{t('guestThread.agentBadge')}</Badge>}
          {who.kind === 'guest' && <Badge variant="outline">{t('guestThread.guestBadge')}</Badge>}
          {timestamp && <span className="font-normal">{timestamp}</span>}
        </MessageHeader>
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className="w-full overflow-visible [&_.markdown-content>*:last-child]:mb-0">
            {/* textOnlyImages: inline workspace-file images would need the
                owner's workspace credentials; a guest gets the alt text. */}
            <MarkdownContent content={message.content} agentNames={agentNames} agentLabels={agentLabels} textOnlyImages />
          </BubbleContent>
        </Bubble>
        {sendStatus === 'sending' && <span className="text-xs text-muted-foreground" role="status">{t('guestThread.sending')}</span>}
        {sendStatus === 'failed' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
            <AlertCircle className="size-3.5" />
            <span>
              {sendError === 'rate_limited' ? t('guestThread.rateLimited')
                : sendError === 'session' ? t('guestThread.sessionExpired')
                : sendError === 'forbidden' ? t('guestThread.forbidden')
                : t('guestThread.sendFailed')}
            </span>
            {onRetry && (
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
