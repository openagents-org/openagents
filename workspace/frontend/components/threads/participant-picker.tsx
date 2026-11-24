'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Item } from '@/components/ui/item';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { HumanAvatar } from '@/components/chat/human-avatar';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { granteeKey } from '@/lib/access-ui';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Grantee } from '@/lib/types';

export interface ParticipantOption extends Grantee {
  kind: 'human' | 'agent';
  detail?: string;
}

/** Shared, bounded roster for creating a thread and adding participants later. */
export function ParticipantPicker({ options, value, onChange, disabled, onToggleAllAgents, allAgentsSelected }: {
  options: ParticipantOption[];
  value: Grantee[];
  onChange: (value: Grantee[]) => void;
  disabled?: boolean;
  onToggleAllAgents?: () => void;
  allAgentsSelected?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'human' | 'agent' | 'selected'>('all');
  const selected = new Set(value.map(granteeKey));
  const peopleCount = value.filter((p) => p.kind === 'human').length;
  const agentsCount = value.filter((p) => p.kind === 'agent').length;
  const search = query.trim().toLowerCase();
  const results = options.filter((option) =>
    (filter === 'all' || (filter === 'selected' ? selected.has(granteeKey(option)) : option.kind === filter))
    && `${option.label} ${option.id} ${option.detail || ''}`.toLowerCase().includes(search),
  );
  const counts = { all: options.length, human: options.filter((p) => p.kind === 'human').length, agent: options.filter((p) => p.kind === 'agent').length, selected: value.length };
  const labels = { all: t('newThread.all'), human: t('newThread.teammates'), agent: t('newThread.agents'), selected: t('newThread.selected') };

  return <div className="flex flex-col gap-3">
    <InputGroup>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled}
        aria-label={t('newThread.search')} placeholder={t('newThread.search')} />
    </InputGroup>
    <ToggleGroup type="single" size="sm" spacing={1} className="flex-wrap" value={filter} disabled={disabled}
      // Pressing the active filter again would clear it; "all" already means that.
      onValueChange={(next) => { if (next) setFilter(next as typeof filter); }}
      aria-label={t('newThread.filterParticipants')}>
      {(['all', 'human', 'agent', 'selected'] as const).map((tab) => (
        <ToggleGroupItem key={tab} value={tab} className="text-xs">
          {labels[tab]} <span className="tabular-nums text-muted-foreground">{counts[tab]}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    <div key={`${filter}:${query}`} className="h-60 overflow-y-auto overscroll-contain rounded-lg border p-1" role="group" aria-label={t('newThread.participants')}>
      {results.map((option) => {
        const key = granteeKey(option);
        const checked = selected.has(key);
        const toggle = () => onChange(checked ? value.filter((p) => granteeKey(p) !== key) : [...value, { kind: option.kind, id: option.id, label: option.label }]);
        return <Item key={key} asChild size="xs" className={cn('cursor-pointer flex-nowrap gap-3 px-3 hover:bg-muted/60 has-disabled:cursor-default has-disabled:opacity-50', checked && 'bg-muted/40')}>
          <label>
            {option.kind === 'human' ? <HumanAvatar email={option.id} /> : <AgentAvatar name={option.id} size={28} />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{option.label}</span>
              {option.detail && <span className="block truncate text-xs text-muted-foreground">{option.detail}</span>}
            </span>
            <Checkbox checked={checked} disabled={disabled} onCheckedChange={toggle} />
          </label>
        </Item>;
      })}
      {!results.length && <p className="px-3 py-12 text-center text-sm text-muted-foreground">
        {filter === 'selected' && !value.length ? t('newThread.noneSelected') : t('newThread.noResults')}
      </p>}
    </div>
    <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-muted-foreground">
      <span aria-live="polite">{t('newThread.selectionSummary', { people: peopleCount, agents: agentsCount })}</span>
      {filter === 'agent' && !search && onToggleAllAgents && <Button variant="ghost" size="xs" disabled={disabled} className="shrink-0 text-muted-foreground" onClick={onToggleAllAgents}>
        {allAgentsSelected ? t('newThread.deselectAgents') : t('newThread.selectAll')}
      </Button>}
    </div>
  </div>;
}
