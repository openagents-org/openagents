'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from './human-avatar';
import { Bot, Users, UserPlus, Plus } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { threadPrivacyApplies } from './thread-privacy-control';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { displayNameFromEmail } from '@/lib/collab';
import { AddThreadParticipants } from './add-thread-participants';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import type { ChannelParticipants } from '@/lib/types';

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
        <ItemGroup className="max-h-72 gap-0 overflow-y-auto">
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
  const [roster, setRoster] = useState<{ key: string; participants: ChannelParticipants } | null>(null);
  const [openList, setOpenList] = useState<'people' | 'agents' | null>(null);

  const [addKind, setAddKind] = useState<'human' | 'agent' | null>(null);
  useEffect(() => { setOpenList(null); setAddKind(null); }, [key]);

  useEffect(() => {
    if (!applicable) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const participants = await workspaceApi.getChannelParticipants(channelName);
        if (active) setRoster({ key, participants });
      } catch {
        if (active) setRoster(null);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    const onParticipantsChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === channelName) void refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener(THREAD_PARTICIPANTS_CHANGED, onParticipantsChanged);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(THREAD_PARTICIPANTS_CHANGED, onParticipantsChanged);
    };
  }, [applicable, key, channelName, agentNames, session?.visibility]);

  if (!applicable || !roster || roster.key !== key) return null;
  const { humans, agents } = roster.participants;
  const close = (kind: 'human' | 'agent') => { setOpenList(null); setAddKind(kind); };
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Popover open={openList === 'people'} onOpenChange={(open) => setOpenList(open ? 'people' : null)}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={TRIGGER} title={t('header.viewPeople', { count: humans.length })} aria-label={t('header.viewPeople', { count: humans.length })}>
            <Users aria-hidden="true" />
            <span>{humans.length}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={t('header.threadPeople')}>
          <RosterList
            title={t('header.threadPeople')}
            empty={t('header.noThreadPeople')}
            items={humans.map((person) => {
              const name = person.display_name || displayNameFromEmail(person.email);
              return { key: person.email, media: <HumanAvatar email={person.email} />, title: name, description: person.email };
            })}
            add={roster.participants.can_add_people ? { label: t('threadAccess.addMember'), icon: <UserPlus data-icon="inline-start" aria-hidden="true" />, onClick: () => close('human') } : null}
          />
        </PopoverContent>
      </Popover>
      <Popover open={openList === 'agents'} onOpenChange={(open) => setOpenList(open ? 'agents' : null)}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className={TRIGGER} title={t('header.viewAgents', { count: agents.length })} aria-label={t('header.viewAgents', { count: agents.length })}>
            <Bot aria-hidden="true" />
            <span>{agents.length}</span>
          </Button>
        </PopoverTrigger>
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
            add={roster.participants.can_add_agents ? { label: t('threadAccess.addAgent'), icon: <Plus data-icon="inline-start" aria-hidden="true" />, onClick: () => close('agent') } : null}
          />
        </PopoverContent>
      </Popover>
      {addKind && <AddThreadParticipants key={`${key}:${addKind}`} channelName={channelName} kind={addKind} open hideTrigger onOpenChange={(open) => { if (!open) setAddKind(null); }} />}
    </span>
  );
}
