'use client';

import { useEffect, useState } from 'react';
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
import type { ChannelParticipants } from '@/lib/types';

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
  const buttonClass = 'inline-flex h-7 items-center gap-1 rounded-md px-1 text-xs font-normal tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <Popover open={openList === 'people'} onOpenChange={(open) => setOpenList(open ? 'people' : null)}>
        <PopoverTrigger asChild>
          <button type="button" className={buttonClass} title={t('header.viewPeople', { count: humans.length })} aria-label={t('header.viewPeople', { count: humans.length })}>
            <Users className="size-3.5" aria-hidden="true" />
            <span>{humans.length}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={t('header.threadPeople')}>
          <h4 className="px-1 text-sm font-medium">{t('header.threadPeople')}</h4>
          {humans.length ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {humans.map((person) => (
                <li key={person.email} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                  <HumanAvatar email={person.email} />
                  <div className="min-w-0">
                    <div className="truncate text-sm" title={person.display_name || displayNameFromEmail(person.email)}>{person.display_name || displayNameFromEmail(person.email)}</div>
                    <div className="truncate text-xs text-muted-foreground" title={person.email}>{person.email}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="px-1 text-sm text-muted-foreground">{t('header.noThreadPeople')}</p>}
          {roster.participants.can_add_people && <div className="border-t pt-2">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => { setOpenList(null); setAddKind('human'); }}>
              <UserPlus className="size-4" aria-hidden="true" />{t('threadAccess.addMember')}
            </Button>
          </div>}
        </PopoverContent>
      </Popover>
      <Popover open={openList === 'agents'} onOpenChange={(open) => setOpenList(open ? 'agents' : null)}>
        <PopoverTrigger asChild>
          <button type="button" className={buttonClass} title={t('header.viewAgents', { count: agents.length })} aria-label={t('header.viewAgents', { count: agents.length })}>
            <Bot className="size-3.5" aria-hidden="true" />
            <span>{agents.length}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" aria-label={t('header.threadAgents')}>
          <h4 className="px-1 text-sm font-medium">{t('header.threadAgents')}</h4>
          {agents.length ? (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {agents.map((agent) => (
                <li key={agent.agent_name} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                  <AgentAvatar name={agent.agent_name} size={28} />
                  <div className="min-w-0">
                    <div className="truncate text-sm" title={agent.display_name || agent.agent_name}>{agent.display_name || agent.agent_name}</div>
                    {agent.display_name && agent.display_name !== agent.agent_name && <div className="truncate text-xs text-muted-foreground" title={agent.agent_name}>{agent.agent_name}</div>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="px-1 text-sm text-muted-foreground">{t('header.noThreadAgents')}</p>}
          {roster.participants.can_add_agents && <div className="border-t pt-2">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => { setOpenList(null); setAddKind('agent'); }}>
              <Plus className="size-4" aria-hidden="true" />{t('threadAccess.addAgent')}
            </Button>
          </div>}
        </PopoverContent>
      </Popover>
      {addKind && <AddThreadParticipants key={`${key}:${addKind}`} channelName={channelName} kind={addKind} open hideTrigger onOpenChange={(open) => { if (!open) setAddKind(null); }} />}
    </span>
  );
}
