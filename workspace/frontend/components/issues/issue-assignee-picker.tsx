'use client';

import { useState } from 'react';
import { ChevronDown, UserRound } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export interface AssigneeChoice {
  id: string;
  name: string;
}

function Avatar({ id }: { id: string }) {
  if (!id) return <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground"><UserRound className="size-3.5" /></span>;
  return id.startsWith('openagents:')
    ? <AgentAvatar name={id.slice(11)} size={28} className="[&_svg]:size-7!" />
    : <HumanAvatar email={id.slice(6)} />;
}

export function IssueAssigneePicker({ value, onChange, choices, disabled, agentsOnly = false }: {
  value: string;
  onChange: (value: string) => void;
  choices: AssigneeChoice[];
  disabled?: boolean;
  agentsOnly?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const available = agentsOnly ? choices.filter(choice => choice.id.startsWith('openagents:')) : choices;
  const selected = available.find(choice => choice.id === value);
  const choose = (id: string) => { onChange(id); setOpen(false); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} aria-label={t('issues.assignee')} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <Avatar id={value} />
        <span className={`min-w-0 flex-1 truncate ${value ? 'font-medium' : 'text-muted-foreground'}`}>{selected?.name || value || t(agentsOnly ? 'issues.chooseAgent' : 'issues.unassigned')}</span>
        {value.startsWith('openagents:') && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t('newThread.agent')}</span>}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 shadow-xl" onEscapeKeyDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }}>
      <Command loop className="rounded-lg! [&_[data-slot=command-input-wrapper]]:h-11 [&_[data-slot=command-input-wrapper]]:px-3">
        <CommandInput autoFocus aria-label={t('issues.searchAssignees')} placeholder={t(agentsOnly ? 'issues.searchAgents' : 'issues.searchAssignees')} className="text-xs" />
        <CommandList className="max-h-64 p-1.5">
          <CommandEmpty className="px-3 py-6 text-xs">{t('issues.noAssignees')}</CommandEmpty>
          {!agentsOnly && <CommandItem value="unassigned" keywords={[t('issues.unassigned')]} data-checked={!value} onSelect={() => choose('')} className="gap-2.5 rounded-md px-2 py-2 text-xs"><Avatar id="" /><span className="text-muted-foreground">{t('issues.unassigned')}</span></CommandItem>}
          {(['human', 'openagents'] as const).filter(kind => available.some(choice => choice.id.startsWith(`${kind}:`))).map(kind => <CommandGroup key={kind} heading={t(kind === 'human' ? 'issues.people' : 'issues.yourAgents')}>
            {available.filter(choice => choice.id.startsWith(`${kind}:`)).map(choice => <CommandItem key={choice.id} value={choice.id} keywords={[choice.name]} data-checked={value === choice.id} onSelect={() => choose(choice.id)} className="gap-2.5 rounded-md px-2 py-2 text-xs">
              <Avatar id={choice.id} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{choice.name}</span>
                {kind === 'human' && choice.name !== choice.id.slice(6) && <span className="block truncate text-[11px] text-muted-foreground">{choice.id.slice(6)}</span>}
              </span>
            </CommandItem>)}
          </CommandGroup>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
