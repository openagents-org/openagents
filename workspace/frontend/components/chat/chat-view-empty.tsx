'use client';

import { CalendarClock, MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';
import { EmptyConversation } from './empty-state';
import { YumiDmIntro } from './yumi-dm-intro';

/** Nothing is open yet: a routines hint, or the prompt to start a thread. */
export function NoThreadSelected({ routines, canStart, onNewThread }: { routines: boolean; canStart: boolean; onNewThread: () => void }) {
  const t = useT();
  if (routines) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
          <EmptyTitle>{t('chat.noRoutinesTitle')}</EmptyTitle>
          <EmptyDescription>{t('chat.noRoutinesBody')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
        <EmptyTitle>{t('chat.newSessionTitle')}</EmptyTitle>
        <EmptyDescription>{t('chat.newSessionBody')}</EmptyDescription>
      </EmptyHeader>
      {canStart && (
        <EmptyContent>
          <Button onClick={onNewThread}>
            <Plus data-icon="inline-start" />
            {t('chat.newThread')}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * A thread with no messages yet. A fresh DM with the built-in assistant opens
 * on her intro (what she can do + the connect steps) instead of a blank thread.
 */
export function ThreadEmpty({ dm, agents, hasConnectedAgent, onQuick }: {
  dm: { isDM: boolean; counterpart: string | null; title: string | null; withPerson: boolean; self: boolean };
  agents: WorkspaceAgent[];
  hasConnectedAgent: boolean;
  onQuick: (text: string) => void;
}) {
  const dmBuiltin = dm.isDM ? agents.find((a) => a.builtin && `openagents:${a.agentName}` === dm.counterpart) : undefined;
  if (dmBuiltin) return <YumiDmIntro agentLabel={agentLabel(dmBuiltin)} onQuick={onQuick} />;
  if (dm.isDM) return <EmptyConversation name={dm.title || undefined} human={dm.withPerson} self={dm.self} />;
  return <EmptyConversation human={!hasConnectedAgent} />;
}
