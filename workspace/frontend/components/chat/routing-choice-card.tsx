'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { agentLabel } from '@/lib/helpers';
import { ConversationBadge, RoutedAgentBadge, routingBadgeClass } from './routing-badge';

interface RoutingChoice {
  status: string;
  requester_email: string;
  candidates: string[];
  continuation?: boolean;
  reason?: string;
  task?: string;
}
function choiceFrom(message: WorkspaceMessage): RoutingChoice | null {
  const value = message.metadata.routing_choice as Partial<RoutingChoice> | undefined;
  return value && typeof value.status === 'string' && typeof value.requester_email === 'string' && Array.isArray(value.candidates)
    ? value as RoutingChoice : null;
}
interface Option { name: string; label: string; online?: boolean }

export function RoutingChoiceCard({ message, agents, conversation = false }: { message: WorkspaceMessage; agents: WorkspaceAgent[]; conversation?: boolean }) {
  const { currentUser } = useWorkspace();
  const t = useT();
  const initial = choiceFrom(message);
  const [status, setStatus] = useState(initial?.status);
  const [assigned, setAssigned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [onlineOptions, setOnlineOptions] = useState<Option[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isConversation = conversation || status === 'dismissed';
  useEffect(() => { setOpen(false); setAssigned(null); setError(''); }, [message.messageId]);
  useEffect(() => { setStatus(initial?.status); }, [message.messageId, initial?.status]);
  useEffect(() => { if (!open) setSearch(''); }, [open]);
  useEffect(() => {
    if (!open || !isConversation) return;
    let active = true;
    setOnlineOptions(null); setError('');
    Promise.all([workspaceApi.getChannelParticipants(message.sessionId), workspaceApi.discover()])
      .then(([participants, discovery]) => {
        if (!active) return;
        const members = new Set(participants.agents.map(agent => agent.agent_name));
        setOnlineOptions(discovery.agents.filter(agent => !agent.builtin && agent.status === 'online')
          .map(agent => ({ name: agent.address.replace(/^openagents:/, ''), label: agent.display_name?.trim() || agent.address.replace(/^openagents:/, ''), online: true }))
          .filter(agent => members.has(agent.name)));
      }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [open, isConversation, message.sessionId]);
  if (!conversation && (!initial || initial.requester_email.toLowerCase() !== currentUser.id.toLowerCase())) return null;
  if (assigned) return <div className="mt-2"><RoutedAgentBadge names={[assigned]} agents={agents} /></div>;
  if (!conversation && status !== 'pending' && status !== 'dismissed') return null;
  const candidates: Option[] = (initial?.candidates || []).filter(name => typeof name === 'string').map(name => {
    const agent = agents.find(a => a.agentName === name);
    return { name, label: agent ? agentLabel(agent) : name, online: agent?.status === 'online' };
  });
  const options = isConversation ? onlineOptions : candidates;
  const filtered = options?.filter(agent => `${agent.label} ${agent.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const choose = async (agent: string | null) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = isConversation && agent
        ? await workspaceApi.resolveRoutingChoice(message.messageId, agent, true)
        : await workspaceApi.resolveRoutingChoice(message.messageId, agent);
      setStatus(result.status);
      if (result.status === 'assigned') setAssigned(result.agent || agent);
      setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <div className="mt-2">
    {message.metadata.router_unavailable === true && status === 'pending' && <p role="status" className="mb-1.5 text-[10px] text-muted-foreground">{t('routing.unavailable')}</p>}
    {initial?.continuation && status === 'pending' && <div className="mb-2 max-w-xl space-y-1 text-xs text-muted-foreground">
      {initial.reason && <p>{initial.reason}</p>}{initial.task && <p className="text-foreground">{initial.task}</p>}
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      {isConversation && <ConversationBadge />}
      <Popover open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
        <PopoverTrigger asChild>
          <button type="button" disabled={busy} className={isConversation
            ? 'rounded px-1 py-1 text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-ring'
            : `${routingBadgeClass} hover:bg-violet-100/60 focus-visible:outline focus-visible:outline-ring disabled:opacity-50`}>
            {isConversation ? t('routing.askAgent') : t('routing.chooseAgent')}
            {!isConversation && <ChevronDown aria-hidden="true" className="size-3 opacity-60" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0" aria-label={t('routing.chooseAgent')}>
          <div className="flex items-center gap-2 border-b px-3">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label={t('routing.searchAgents')}
              placeholder={t('routing.searchAgents')} className="h-10 min-w-0 flex-1 bg-transparent text-xs outline-none"
              onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); } }} />
          </div>
          <div ref={listRef} role="group" aria-label={t('routing.chooseAgent')} className="max-h-56 overflow-y-auto p-1"
            onKeyDown={e => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (index >= 0) { e.preventDefault(); buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
            }}>
            {!options && !error && <div role="status" className="flex items-center gap-2 px-3 py-5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t('common.loading')}</div>}
            {filtered?.map(agent => <button key={agent.name} type="button" disabled={busy} aria-label={agent.label}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50" onClick={() => void choose(agent.name)}>
              <AgentAvatar name={agent.name} size={24} /><span className="min-w-0 flex-1 truncate">{agent.label}</span>
              {agent.online && <span title={t('routing.onlineInThread')} className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />}
            </button>)}
            {filtered?.length === 0 && <p className="px-3 py-5 text-center text-xs text-muted-foreground">{options?.length ? t('routing.noMatches') : t('routing.noOnlineAgents')}</p>}
          </div>
          {error && <p role="alert" className="border-t px-3 py-2 text-xs text-destructive">{error}</p>}
        </PopoverContent>
      </Popover>
      {!isConversation && <button type="button" disabled={busy} onClick={() => void choose(null)} className="rounded px-1 py-1 text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-ring disabled:opacity-50">{t('routing.keepConversation')}</button>}
      {busy && <Loader2 aria-label={t('common.saving')} className="size-3 animate-spin text-muted-foreground" />}
    </div>
    {error && !open && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
  </div>;
}
