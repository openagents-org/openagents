'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from './human-avatar';
import { Bot, Users, UserPlus, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { threadPrivacyApplies } from './thread-privacy-control';
import { loadChannelParticipants, useChannelParticipants } from '@/lib/channel-participants-store';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { displayNameFromEmail } from '@/lib/collab';
import { AddThreadParticipants } from './add-thread-participants';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { WithTooltip } from '@/components/ui/with-tooltip';

const TRIGGER = 'px-1.5 font-normal tabular-nums text-muted-foreground';

type RosterEntry = { key: string; media: ReactNode; title: string; description?: string };

function RosterList({ title, empty, items, add }: {
  title: string;
  empty: string;
  items: RosterEntry[];
  add: { label: string; icon: ReactNode; onClick: () => void } | null;
}) {
  return (
    <>
      <h4 className="px-1 text-sm font-medium">{title}</h4>
      {items.length ? (
        <ItemGroup className="no-scrollbar max-h-72 gap-0 overflow-y-auto">
          {items.map((item) => (
            <Item key={item.key} size="xs" className="px-1">
              <ItemMedia>{item.media}</ItemMedia>
              <ItemContent>
                <ItemTitle className="truncate" title={item.title}>{item.title}</ItemTitle>
                {item.description && <ItemDescription className="truncate" title={item.description}>{item.description}</ItemDescription>}
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      ) : <p className="px-1 text-sm text-muted-foreground">{empty}</p>}
      {add && <>
        <Separator />
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={add.onClick}>
          {add.icon}{add.label}
        </Button>
      </>}
    </>
  );
}

/** Count joined people and all thread agents, including offline agents. */
export function ThreadParticipantCount({ channelName }: { channelName: string }) {
  const { workspace, sessions } = useWorkspace();
  const t = useT();
  const session = sessions.find((s) => s.sessionId === channelName);
  const workspaceId = workspace?.workspaceId;
  const key = `${workspaceId}:${channelName}`;
  const agentNames = JSON.stringify(session?.participants ?? []);
  const applicable = !!workspaceId && !!session && threadPrivacyApplies(channelName);
  const participants = useChannelParticipants(channelName, applicable);
  const [openList, setOpenList] = useState<'people' | 'agents' | null>(null);

  const [addKind, setAddKind] = useState<'human' | 'agent' | null>(null);
  useEffect(() => { setOpenList(null); setAddKind(null); }, [key]);

  // The shared roster re-reads itself on mount and when the thread says its
  // participants changed; this keeps the counts current while it stays open
  // (others joining, agents added by discovery, visibility flipped).
  const changes = useRef('');
  useEffect(() => {
    if (!applicable) return;
    const signature = `${key}|${agentNames}|${session?.visibility ?? ''}`;
    if (changes.current && changes.current !== signature && changes.current.startsWith(`${key}|`)) {
      loadChannelParticipants(channelName, { force: true }).catch(() => {});
    }
    changes.current = signature;
    const refresh = () => { loadChannelParticipants(channelName, { force: true }).catch(() => {}); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [applicable, key, channelName, agentNames, session?.visibility]);

  if (!applicable || !participants) return null;
  const { humans, agents } = participants;
  const close = (kind: 'human' | 'agent') => { setOpenList(null); setAddKind(kind); };
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Popover open={openList === 'people'} onOpenChange={(open) => setOpenList(open ? 'people' : null)}>
        <WithTooltip label={t('header.viewPeople', { count: humans.length })}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={TRIGGER} aria-label={t('header.viewPeople', { count: humans.length })}>
              <Users aria-hidden="true" />
              <span>{humans.length}</span>
            </Button>
          </PopoverTrigger>
        </WithTooltip>
        <PopoverContent align="start" aria-label={t('header.threadPeople')}>
          <RosterList
            title={t('header.threadPeople')}
            empty={t('header.noThreadPeople')}
            items={humans.map((person) => {
              const name = person.display_name || displayNameFromEmail(person.email);
              return { key: person.email, media: <HumanAvatar email={person.email} />, title: name, description: person.email };
            })}
            add={participants.can_add_people ? { label: t('threadAccess.addMember'), icon: <UserPlus data-icon="inline-start" aria-hidden="true" />, onClick: () => close('human') } : null}
          />
        </PopoverContent>
      </Popover>
      <Popover open={openList === 'agents'} onOpenChange={(open) => setOpenList(open ? 'agents' : null)}>
        <WithTooltip label={t('header.viewAgents', { count: agents.length })}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={TRIGGER} aria-label={t('header.viewAgents', { count: agents.length })}>
              <Bot aria-hidden="true" />
              <span>{agents.length}</span>
            </Button>
          </PopoverTrigger>
        </WithTooltip>
        <PopoverContent align="start" aria-label={t('header.threadAgents')}>
          <RosterList
            title={t('header.threadAgents')}
            empty={t('header.noThreadAgents')}
            items={agents.map((agent) => ({
              key: agent.agent_name,
              media: <AgentAvatar name={agent.agent_name} size={28} />,
              title: agent.display_name || agent.agent_name,
              description: agent.display_name && agent.display_name !== agent.agent_name ? agent.agent_name : undefined,
            }))}
            add={participants.can_add_agents ? { label: t('threadAccess.addAgent'), icon: <Plus data-icon="inline-start" aria-hidden="true" />, onClick: () => close('agent') } : null}
          />
        </PopoverContent>
      </Popover>
      {addKind && <AddThreadParticipants key={`${key}:${addKind}`} channelName={channelName} kind={addKind} open hideTrigger onOpenChange={(open) => { if (!open) setAddKind(null); }} />}
    </span>
  );
}
