'use client';

import { MessageCircle, MoreVertical, Pin, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { agentLabel } from '@/lib/helpers';
import { useFormatters, useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';
import { addressName, dmCounterpart, dmSessionId, isMyAddress, myAddress } from '@/lib/dm';
import { displayHumanMentions } from '@/lib/people-mentions';
import { useHumanNames } from '@/hooks/use-team-roster';
import type { DMConversation } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DmUnreadMarker, UnreadDot, rowTimeClass } from './thread-row';
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, dmDisplayTitle, dmRowId } from './thread-list-utils';

interface DmRowProps {
  convo: DMConversation;
  shortcutKey: number | null;
  onlinePeople: ReadonlyMap<string, string>;
  /** Id of the DM whose pin/star change is in flight (one at a time). */
  pendingDm: string | null;
  onSelect: (dmId: string) => void;
  onPreference: (dmId: string, update: { pinned?: boolean; starred?: boolean }) => void;
}

export function DmRow({ convo, shortcutKey, onlinePeople, pendingDm, onSelect, onPreference }: DmRowProps) {
  const { agents, currentSessionId, unreadDmSessionIds, unreadDmCounts, unreadSignals, currentUser } = useWorkspace();
  const me = myAddress(currentUser);
  const humanNames = useHumanNames();
  const { timeAgo } = useFormatters();
  const t = useT();

  const dmId = dmRowId(convo.agents);
  const isUnread = unreadDmSessionIds.has(dmId);
  const counterpart = dmCounterpart(convo.agents, me);
  const countId = counterpart ? dmSessionId(me, counterpart) : dmId;
  const signalCount = currentSessionId === dmId ? 0 : unreadDmCounts[countId] || unreadSignals[dmId]?.dms || 0;
  // rawTitle stays address-derived (stable avatar seed and dedup); the
  // rendered title maps each agent name to its display label.
  const rawTitle = dmDisplayTitle(convo.agents, me);
  const nameLabel = (n: string) => {
    const a = agents.find((x) => x.agentName === n);
    return a ? agentLabel(a) : (humanNames[n.toLowerCase()] ?? n);
  };
  const title = counterpart === me ? t('threads.you') : rawTitle.split(' ↔ ').map(nameLabel).join(' ↔ ');
  const isAgentPair = !convo.agents.some((a) => a.startsWith('human:'));
  // Person↔person DM: titled by the other person's roster name.
  const counterpartIsPerson = !!counterpart?.startsWith('human:');
  const senderAddr = convo.lastMessage.sender;
  const sender = isMyAddress(senderAddr, me) ? t('threads.you') : nameLabel(addressName(senderAddr));
  const online = !!counterpart && (counterpart === me || onlinePeople.has(addressName(counterpart).toLowerCase()));

  return (
    <div
      role="listitem"
      tabIndex={0}
      onClick={() => onSelect(dmId)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(dmId);
        }
      }}
      className={cn(ROW_BASE, currentSessionId === dmId ? ROW_SELECTED : ROW_IDLE)}
    >
      <UnreadDot show={isUnread && signalCount === 0} />
      {isAgentPair ? (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background">
          <MessageCircle className="size-3.5 text-muted-foreground" />
        </div>
      ) : counterpartIsPerson ? (
        <div className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
          <HumanAvatar email={counterpart ? addressName(counterpart) : rawTitle} />
          {online && <span className="absolute right-0 bottom-0 size-2 rounded-full bg-success ring-2 ring-background" aria-label={t('agents.online')} title={t('agents.online')} />}
        </div>
      ) : (
        <div className="mt-0.5 shrink-0">
          <AgentAvatar name={rawTitle} size={28} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-0.5 flex items-center justify-between gap-1">
          <span className={cn('truncate text-sm leading-tight text-foreground', isUnread ? 'font-semibold' : 'font-medium')}>
            {convo.pinned && <Pin className="mr-1 inline size-3 text-muted-foreground" aria-label={t('threads.pin')} />}
            {convo.starred && <Star className="mr-1 inline size-3 fill-warning text-warning" aria-label={t('threads.star')} />}
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <span className={rowTimeClass(isUnread)}>
              {convo.lastMessage.timestamp ? timeAgo(new Date(convo.lastMessage.timestamp).toISOString()) : ''}
            </span>
            {signalCount > 0 && <DmUnreadMarker count={signalCount} />}
            {shortcutKey && <Kbd>{shortcutKey}</Kbd>}
          </div>
        </div>
        <p className={cn('truncate text-xs leading-snug', isUnread ? 'text-foreground/80' : 'text-muted-foreground')}>
          {sender}: {displayHumanMentions(convo.lastMessage.content, humanNames)}
        </p>
      </div>
      {/* Same slot and button as the thread rows' menu. */}
      <div className="shrink-0 self-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon-sm"
              aria-label={t('threads.dmActions')}
              disabled={pendingDm === dmId}
              className="text-muted-foreground"
              onClick={e => e.stopPropagation()}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={!!pendingDm} onSelect={() => onPreference(dmId, { pinned: !convo.pinned })}>
                <Pin />{t(convo.pinned ? 'threads.unpin' : 'threads.pin')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!!pendingDm} onSelect={() => onPreference(dmId, { starred: !convo.starred })}>
                <Star />{t(convo.starred ? 'threads.unstar' : 'threads.star')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
