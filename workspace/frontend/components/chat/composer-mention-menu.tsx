'use client';

import * as React from 'react';
import { BookOpen, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Separator } from '@/components/ui/separator';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { availabilityDotClass, availabilityLabel, type AgentAvailability } from '@/lib/collab';
import { knowledgeTitle } from '@/lib/knowledge-title';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { KnowledgeEntry, WorkspaceAgent, WorkspaceSession } from '@/lib/types';
import type { MentionPerson } from '@/lib/people-mentions';
import { HumanAvatar } from './human-avatar';
import type { MentionItem } from './use-composer-mentions';

interface ComposerMentionMenuProps {
  offerAll: boolean;
  people: MentionPerson[];
  agents: WorkspaceAgent[];
  knowledge: KnowledgeEntry[];
  sessions: WorkspaceSession[];
  /** Index into the flat [all, ...people, ...agents, ...knowledge] list. */
  activeIndex: number;
  availabilityOf: (agent: WorkspaceAgent) => AgentAvailability;
  onPick: (item: MentionItem) => void;
}

function MentionRow({ active, title, onPick, className, children }: {
  active: boolean;
  title?: string;
  onPick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Item asChild size="xs" data-active={active} className={cn('cursor-pointer text-left hover:bg-muted data-[active=true]:bg-muted', className)}>
      {/* mousedown (not click) so the textarea keeps focus and the caret. */}
      <button type="button" title={title} onMouseDown={(e) => { e.preventDefault(); onPick(); }}>
        {children}
      </button>
    </Item>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-1 text-xs font-medium text-muted-foreground">{children}</div>;
}

/** The @ autocomplete above the composer; keyboard navigation stays in the textarea. */
export function ComposerMentionMenu({ offerAll, people, agents, knowledge, sessions, activeIndex, availabilityOf, onPick }: ComposerMentionMenuProps) {
  const t = useT();
  const peopleStart = offerAll ? 1 : 0;
  const agentsStart = peopleStart + people.length;
  const knowledgeStart = agentsStart + agents.length;

  return (
    <div className="absolute inset-x-0 bottom-full z-50 mb-2 flex max-h-70 flex-col gap-0.5 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
      {offerAll && (
        <MentionRow active={activeIndex === 0} onPick={() => onPick({ type: 'all' })}>
          <ItemMedia><Users className="size-6" /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>@all</ItemTitle>
            <ItemDescription className="line-clamp-1">{t('peopleMessaging.mentionAllHint')}</ItemDescription>
          </ItemContent>
        </MentionRow>
      )}
      {people.length > 0 && (agents.length > 0 || knowledge.length > 0) && (
        <SectionLabel>{t('peopleMessaging.mentionPeople')}</SectionLabel>
      )}
      {people.map((person, i) => (
        <MentionRow key={person.email} active={activeIndex === peopleStart + i} onPick={() => onPick({ type: 'person', person })}>
          <ItemMedia><HumanAvatar email={person.email} className="size-6" /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="max-w-full"><span className="min-w-0 truncate">{person.name}</span></ItemTitle>
            {person.name !== person.email && <ItemDescription className="truncate">{person.email}</ItemDescription>}
          </ItemContent>
          <ItemActions><Badge variant="secondary">{t('peopleMessaging.personTag')}</Badge></ItemActions>
        </MentionRow>
      ))}
      {agents.length > 0 && (knowledge.length > 0 || people.length > 0) && (
        <>
          <Separator className="my-1" />
          <SectionLabel>{t('chatInput.mentionAgents')}</SectionLabel>
        </>
      )}
      {agents.map((agent, i) => {
        // v1.1 M3: availability dot + short label; unreachable agents stay
        // selectable but read muted, with the "request waits" hint.
        const availability = availabilityOf(agent);
        const unreachable = availability === 'offline' || availability === 'device_offline';
        const hint = availability === 'device_offline'
          ? t('collab.presence.deviceOfflineHint')
          : availability === 'offline' ? t('collab.presence.offlineHint') : undefined;
        const label = agentLabel(agent);
        return (
          <MentionRow key={agent.agentName} title={hint} active={activeIndex === agentsStart + i} onPick={() => onPick({ type: 'agent', agent })} className={cn(unreachable && 'opacity-70')}>
            <ItemMedia><AgentAvatar name={agent.agentName} size={24} /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="max-w-full"><span className="min-w-0 truncate">{label}</span></ItemTitle>
              {label !== agent.agentName && <ItemDescription className="truncate">@{agent.agentName}</ItemDescription>}
            </ItemContent>
            <ItemActions>
              <Badge variant={agent.role === 'master' ? 'warning' : 'secondary'}>{agent.role}</Badge>
              {availability !== 'waiting' && (
                <span className={cn('inline-flex items-center gap-1.5 text-xs lowercase', unreachable ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
                  <span className={cn('size-2 rounded-full', availabilityDotClass(availability))} />
                  {availabilityLabel(t, availability, agent.queueDepth ?? 0)}
                </span>
              )}
            </ItemActions>
          </MentionRow>
        );
      })}
      {knowledge.length > 0 && (agents.length > 0 || people.length > 0) && (
        <>
          <Separator className="my-1" />
          <SectionLabel>{t('chatInput.mentionKnowledge')}</SectionLabel>
        </>
      )}
      {knowledge.map((entry, i) => (
        <MentionRow key={entry.id} active={activeIndex === knowledgeStart + i} onPick={() => onPick({ type: 'knowledge', entry })}>
          <ItemMedia className="size-6 rounded-md bg-warning/10 text-warning"><BookOpen className="size-3.5" /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="max-w-full"><span className="min-w-0 truncate">{knowledgeTitle(entry.title, sessions)}</span></ItemTitle>
            <ItemDescription className="truncate font-mono">@knowledge:{entry.slug}</ItemDescription>
          </ItemContent>
        </MentionRow>
      ))}
    </div>
  );
}
