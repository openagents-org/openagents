'use client';
import { useEffect, useState } from 'react';
import { Check, ChevronDown, Plus, Search, Tag, UserRound } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { useMe } from '@/hooks/use-me';
import { useT } from '@/lib/i18n';
import type { IssueDetail, TeamMember } from '@/lib/types';
import { IssueLabel } from './issue-label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { AgentAvatar } from '@/components/agents/agent-avatar';

function AssigneeAvatar({ id }: { id: string }) {
  if (!id) return <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"><UserRound className="size-3.5" /></span>;
  return id.startsWith('openagents:') ? <AgentAvatar name={id.slice(11)} size={28} /> : <HumanAvatar email={id.slice(6)} />;
}

export function IssueProperties({ issue, busy, update }: {
  issue: IssueDetail; busy: boolean;
  update: (values: { assignee?: string | null; labels?: string[] }) => void;
}) {
  const { workspace, agents } = useWorkspace();
  const me = useMe(workspace?.workspaceId);
  const t = useT();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [label, setLabel] = useState('');
  const [addingLabel, setAddingLabel] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => { let active = true; void workspaceApi.getTeam().then(value => { if (active) setTeam(value); }).catch(() => {}); return () => { active = false; }; }, [workspace?.workspaceId]);
  const email = me?.email?.toLowerCase();
  const owned = agents.filter(agent => email && agent.ownerEmail?.toLowerCase() === email);
  const actor = email ? `human:${email}` : '';
  const canAssign = !!actor && (actor === issue.created_by || actor === issue.assignee || owned.some(agent => `openagents:${agent.agentName}` === issue.assignee));
  const choices = [...team.map(person => ({ id: `human:${person.email}`, name: person.displayName || person.email })), ...owned.map(agent => ({ id: `openagents:${agent.agentName}`, name: agent.displayName || agent.agentName }))];
  const selectedName = choices.find(choice => choice.id === issue.assignee)?.name || issue.assignee_name || issue.assignee || t('issues.unassigned');
  const filtered = choices.filter(choice => `${choice.name} ${choice.id}`.toLowerCase().includes(search.toLowerCase()));
  const labels = issue.labels || [];
  const validLabel = !!label.trim() && !labels.some(item => item.toLowerCase() === label.trim().toLowerCase());
  const assign = (id: string | null) => { update({ assignee: id }); setAssignOpen(false); };
  return <>
    <section className="space-y-2">
      <h3 id={`issue-assignee-${issue.id}`} className="text-[11px] font-medium text-muted-foreground">{t('issues.assignee')}</h3>
      <Popover open={assignOpen} onOpenChange={open => { setAssignOpen(open); setSearch(''); }}>
        <PopoverTrigger asChild>
          <button type="button" disabled={busy || !canAssign} aria-labelledby={`issue-assignee-${issue.id}`} className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1.5 text-left transition-colors enabled:hover:border-border enabled:hover:bg-muted/40 disabled:cursor-default">
            <AssigneeAvatar id={issue.assignee || ''} />
            <span className={`min-w-0 flex-1 truncate text-xs font-medium ${issue.assignee ? '' : 'text-muted-foreground'}`}>{selectedName}</span>
            {canAssign && <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 gap-1 p-1.5">
          <div className="relative mb-1 border-b pb-1.5">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
            <Input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder={t('issues.searchAssignees')} aria-label={t('issues.searchAssignees')} className="h-8 border-0 bg-transparent pl-7 text-xs shadow-none focus-visible:ring-0" />
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            <button type="button" disabled={busy} onClick={() => assign(null)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs hover:bg-accent"><AssigneeAvatar id="" /><span className="flex-1 text-muted-foreground">{t('issues.unassigned')}</span>{!issue.assignee && <Check className="size-3.5" />}</button>
            {filtered.map(choice => <button key={choice.id} type="button" disabled={busy} onClick={() => assign(choice.id)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs hover:bg-accent">
              <AssigneeAvatar id={choice.id} /><span className="min-w-0 flex-1 truncate">{choice.name}</span>
              {choice.id.startsWith('openagents:') && <span className="text-[10px] text-muted-foreground">{t('newThread.agent')}</span>}
              {issue.assignee === choice.id && <Check className="size-3.5 shrink-0" />}
            </button>)}
            {!filtered.length && search && <p className="px-2 py-3 text-xs text-muted-foreground">{t('issues.noAssignees')}</p>}
          </div>
        </PopoverContent>
      </Popover>
    </section>
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-muted-foreground">{t('issues.labels')}</h3>
        <button type="button" disabled={busy || labels.length >= 20} onClick={() => setAddingLabel(!addingLabel)} aria-label={t('issues.addLabel')} aria-expanded={addingLabel} className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus className="size-3.5" /></button>
      </div>
      {labels.length ? <div className="flex flex-wrap gap-1.5">{labels.map(value => <IssueLabel key={value} label={value} disabled={busy} onRemove={() => update({ labels: labels.filter(item => item !== value) })} />)}</div>
        : !addingLabel && <button type="button" disabled={busy} onClick={() => setAddingLabel(true)} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"><Tag className="size-3.5" />{t('issues.addLabel')}</button>}
      {addingLabel && <form className="relative" onSubmit={event => { event.preventDefault(); if (busy || !validLabel || labels.length >= 20) return; update({ labels: [...labels, label.trim()] }); setLabel(''); setAddingLabel(false); }}>
        <Input autoFocus id={`issue-label-${issue.id}`} aria-label={t('issues.addLabel')} className="h-9 min-w-0 pr-9 text-xs" maxLength={40} disabled={busy || labels.length >= 20} placeholder={t('issues.labelName')} value={label} onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setAddingLabel(false); setLabel(''); } }} />
        <button type="submit" aria-label={t('issues.addLabel')} disabled={busy || !validLabel || labels.length >= 20} className="absolute right-1 top-1 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"><Check className="size-4" /></button>
      </form>}
    </section>
  </>;
}
