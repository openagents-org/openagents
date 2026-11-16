'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, UserRound } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { agentLabel } from '@/lib/helpers';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { AssigneeChoice } from './issue-assignee-picker';

/** '' = anyone; 'none' = unassigned; else an assignee id ("human:<email>" / "openagents:<agent>"). */
export type AssigneeFilterValue = string;

/**
 * Filter the issue list by who it is assigned to: a person on the team, an
 * agent in the workspace, or nobody.
 */
export function IssueAssigneeFilter({ value, onChange }: { value: AssigneeFilterValue; onChange: (value: AssigneeFilterValue) => void }) {
  const t = useT();
  const { agents = [], workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<AssigneeChoice[]>([]);
  useEffect(() => {
    let active = true;
    void workspaceApi.getTeam()
      .then((team) => { if (active) setPeople(team.map((p) => ({ id: `human:${p.email.toLowerCase()}`, name: p.displayName || p.email }))); })
      .catch(() => {});
    return () => { active = false; };
  }, [workspace?.workspaceId]);
  const agentChoices: AssigneeChoice[] = agents
    .filter((a) => !a.builtin)
    .map((a) => ({ id: `openagents:${a.agentName}`, name: agentLabel(a) }));

  const label = value === '' ? t('issues.anyAssignee')
    : value === 'none' ? t('issues.unassigned')
    : [...people, ...agentChoices].find((c) => c.id === value)?.name || value.replace(/^(human:|openagents:)/, '');
  const choose = (next: AssigneeFilterValue) => { onChange(next); setOpen(false); };
  const item = (id: AssigneeFilterValue, name: string, avatar: React.ReactNode, keywords: string[] = []) => (
    <CommandItem key={id || 'any'} value={id || 'any'} keywords={[name, ...keywords]} onSelect={() => choose(id)} className="gap-2 rounded-md px-2 py-1.5 text-xs">
      {avatar}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {value === id && <Check className="size-3.5 shrink-0" />}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={value ? 'secondary' : 'ghost'}
          size="sm"
          aria-label={t('issues.filterByAssignee')}
          className={cn('max-w-44 shrink-0 text-xs', !value && 'text-muted-foreground')}
        >
          <UserRound data-icon="inline-start" />
          <span className="truncate">{value ? label : t('issues.assignee')}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 gap-0 overflow-hidden p-0">
        <Command loop>
          <CommandInput placeholder={t('issues.searchAssignees')} aria-label={t('issues.searchAssignees')} className="text-xs" />
          <CommandList className="max-h-72 p-1.5">
            <CommandEmpty className="px-3 py-6 text-xs">{t('issues.noAssignees')}</CommandEmpty>
            <CommandGroup>
              {item('', t('issues.anyAssignee'), <span className="size-5 shrink-0" />)}
              {item('none', t('issues.unassigned'), <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"><UserRound className="size-3" /></span>)}
            </CommandGroup>
            {people.length > 0 && (
              <CommandGroup heading={t('issues.people')}>
                {people.map((p) => item(p.id, p.name, <HumanAvatar email={p.id.slice(6)} />, [p.id.slice(6)]))}
              </CommandGroup>
            )}
            {agentChoices.length > 0 && (
              <CommandGroup heading={t('issues.agents')}>
                {agentChoices.map((a) => item(a.id, a.name, <AgentAvatar name={a.id.slice(11)} size={20} />))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
