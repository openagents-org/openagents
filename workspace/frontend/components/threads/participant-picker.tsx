'use client';

import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
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

  return <div className="space-y-3">
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled}
        className="ps-9" aria-label={t('newThread.search')} placeholder={t('newThread.search')} />
    </div>
    <div className="flex flex-wrap gap-1" role="group" aria-label={t('newThread.filterParticipants')}>
      {(['all', 'human', 'agent', 'selected'] as const).map((tab) => (
        <button key={tab} type="button" disabled={disabled} aria-pressed={filter === tab} onClick={() => setFilter(tab)}
          className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50', filter === tab ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')}>
          {labels[tab]} <span className="ms-1 tabular-nums opacity-60">{counts[tab]}</span>
        </button>
      ))}
    </div>
    <div key={`${filter}:${query}`} className="h-60 overflow-y-auto overscroll-contain rounded-lg border p-1" role="group" aria-label={t('newThread.participants')}>
      {results.map((option) => {
        const key = granteeKey(option);
        const checked = selected.has(key);
        return <button key={key} type="button" disabled={disabled} role="checkbox" aria-checked={checked}
          className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-50', checked && 'bg-muted/40')}
          onClick={() => onChange(checked ? value.filter((p) => granteeKey(p) !== key) : [...value, { kind: option.kind, id: option.id, label: option.label }])}>
          {option.kind === 'human' ? <HumanAvatar email={option.id} /> : <AgentAvatar name={option.id} size={28} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{option.label}</span>
            {option.detail && <span className="block truncate text-xs text-muted-foreground">{option.detail}</span>}
          </span>
          <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-sm border', checked ? 'bg-primary border-primary text-primary-foreground' : 'border-input')}>
            {checked && <Check className="size-3" strokeWidth={3} />}
          </span>
        </button>;
      })}
      {!results.length && <p className="px-3 py-12 text-center text-sm text-muted-foreground">
        {filter === 'selected' && !value.length ? t('newThread.noneSelected') : t('newThread.noResults')}
      </p>}
    </div>
    <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-muted-foreground">
      <span aria-live="polite">{t('newThread.selectionSummary', { people: peopleCount, agents: agentsCount })}</span>
      {filter === 'agent' && !search && onToggleAllAgents && <button type="button" disabled={disabled} className="shrink-0 hover:text-foreground" onClick={onToggleAllAgents}>
        {allAgentsSelected ? t('newThread.deselectAgents') : t('newThread.selectAll')}
      </button>}
    </div>
  </div>;
}
