'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, UserRound } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { useMe } from '@/hooks/use-me';
import { useT } from '@/lib/i18n';
import type { IssueDetail, TeamMember } from '@/lib/types';
import { IssueLabel } from './issue-label';
import { IssueLabelPicker } from './issue-label-picker';
import { IssueDueDate } from './issue-due-date';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { AgentAvatar } from '@/components/agents/agent-avatar';

function AssigneeAvatar({ id }: { id: string }) {
  if (!id) return <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"><UserRound className="size-3.5" /></span>;
  return id.startsWith('openagents:') ? <AgentAvatar name={id.slice(11)} size={20} /> : <HumanAvatar email={id.slice(6)} className="size-5" />;
}

export function IssueProperties({ issue, busy, update }: {
  issue: IssueDetail; busy: boolean;
  update: (values: { due_date?: string | null; assignee?: string | null; labels?: string[] }) => void;
}) {
  const { workspace, agents } = useWorkspace();
  const me = useMe(workspace?.workspaceId);
  const t = useT();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  useEffect(() => { let active = true; void workspaceApi.getTeam().then(value => { if (active) setTeam(value); }).catch(() => {}); return () => { active = false; }; }, [workspace?.workspaceId]);
  const email = me?.email?.toLowerCase();
  const owned = agents.filter(agent => email && agent.ownerEmail?.toLowerCase() === email);
  const actor = email ? `human:${email}` : '';
  const canAssign = !!actor && (actor === issue.created_by || actor === issue.assignee || owned.some(agent => `openagents:${agent.agentName}` === issue.assignee));
  const choices = team.map(person => ({ id: `human:${person.email.toLowerCase()}`, name: person.displayName || person.email }));
  const selectedName = choices.find(choice => choice.id === issue.assignee?.toLowerCase())?.name
    || agents.find(agent => `openagents:${agent.agentName}` === issue.assignee)?.displayName
    || issue.assignee_name || issue.participants.find(person => person.source === issue.assignee)?.name
    || issue.assignee?.replace(/^(human:|openagents:)/, '') || t('issues.unassigned');
  const labels = issue.labels || [];
  const assign = (id: string | null) => { update({ assignee: id }); setAssignOpen(false); };
  const current = <>
    <AssigneeAvatar id={issue.assignee || ''} />
    <span className={cn('min-w-0 flex-1 truncate text-left text-xs font-medium', !issue.assignee && 'text-muted-foreground')}>{selectedName}</span>
  </>;
  return <>
    <section className="flex min-w-0 items-center gap-2">
      <h3 id={`issue-assignee-${issue.id}`} className="shrink-0 text-xs font-medium text-muted-foreground">{t('issues.assignee')}</h3>
      {canAssign ? <Popover open={assignOpen} onOpenChange={setAssignOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" disabled={busy} aria-labelledby={`issue-assignee-${issue.id}`} className="min-w-0 flex-1 justify-start gap-2 px-1.5">
            {current}
            <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-64 gap-0 overflow-hidden p-0">
          <Command loop className="[&_[data-slot=command-input-wrapper]]:h-11 [&_[data-slot=command-input-wrapper]]:px-3">
            <CommandInput autoFocus placeholder={t('issues.searchAssignees')} aria-label={t('issues.searchAssignees')} className="text-xs" />
            <CommandList className="max-h-64 p-1.5">
              <CommandEmpty className="px-3 py-6 text-xs">{t('issues.noAssignees')}</CommandEmpty>
              <CommandGroup>
                <CommandItem value="unassigned" keywords={[t('issues.unassigned')]} disabled={busy} data-checked={!issue.assignee} onSelect={() => assign(null)} className="gap-2.5 rounded-md px-2 py-2 text-xs">
                  <AssigneeAvatar id="" /><span className="flex-1 text-muted-foreground">{t('issues.unassigned')}</span>
                </CommandItem>
                {choices.map(choice => <CommandItem key={choice.id} value={choice.id} keywords={[choice.name]} disabled={busy} data-checked={issue.assignee === choice.id} onSelect={() => assign(choice.id)} className="gap-2.5 rounded-md px-2 py-2 text-xs">
                  <AssigneeAvatar id={choice.id} /><span className="min-w-0 flex-1 truncate">{choice.name}</span>
                </CommandItem>)}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
        : <div role="group" aria-labelledby={`issue-assignee-${issue.id}`} className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-1.5">{current}</div>}
    </section>
    <IssueDueDate issue={issue} busy={busy} canEdit={!!actor && actor === issue.created_by.toLowerCase()} update={update} />
    <section className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="flex shrink-0 items-center gap-1">
        <h3 className="shrink-0 text-xs font-medium text-muted-foreground">{t('issues.labels')}</h3>
        <IssueLabelPicker labels={labels} busy={busy} workspaceId={workspace?.workspaceId} onAdd={value => update({ labels: [...labels, value] })} />
      </div>
      {labels.length > 0 && <div className="flex min-w-0 flex-wrap gap-1.5">{labels.map(value => <IssueLabel key={value} label={value} disabled={busy} onRemove={() => update({ labels: labels.filter(item => item !== value) })} />)}</div>}
    </section>
  </>;
}
