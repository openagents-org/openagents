'use client';

import { useId, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Inline suggestions keep keyboard focus inside the assignment dialog. */
export function IssueContextPicker({ value, onChange, disabled }: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { knowledge = [] } = useWorkspace();
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = knowledge.filter(entry => !value.includes(entry.id) &&
    [entry.title, entry.description, entry.slug].some(text => text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).slice(0, 8);
  const expanded = open && !disabled && value.length < 100;
  const add = (entryId: string) => {
    if (disabled || value.includes(entryId) || value.length >= 100) return;
    onChange([...value, entryId]);
    setQuery('');
    setActive(0);
  };
  return <div className="space-y-2" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium"><BookOpen className="size-3.5" />{t('issueWork.context')}</label>
    {value.length > 0 && <div className="flex flex-wrap gap-1.5">{value.map(entryId => <span key={entryId} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
      <span className="truncate">{knowledge.find(entry => entry.id === entryId)?.title || t('issueWork.contextUnavailable')}</span>
      <button type="button" disabled={disabled} aria-label={t('issueWork.removeContext', { name: knowledge.find(entry => entry.id === entryId)?.title || t('issueWork.contextUnavailable') })} onClick={() => onChange(value.filter(id => id !== entryId))} className="shrink-0 rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3" /></button>
    </span>)}</div>}
    <Input id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`} aria-activedescendant={expanded && matches[active] ? `${id}-option-${active}` : undefined}
      value={query} disabled={disabled || value.length >= 100} placeholder={t('issueWork.contextPlaceholder')}
      onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive(index => matches.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (expanded && matches[active]) add(matches[active].id);
        } else if (event.key === 'Escape' && open) {
          event.preventDefault(); event.stopPropagation(); setOpen(false);
        }
      }} />
    {expanded && <div className="max-h-40 overflow-y-auto rounded-lg border bg-background">
      <div id={`${id}-options`} role="listbox" aria-label={t('issueWork.context')}>
        {matches.map((entry, index) => <button key={entry.id} id={`${id}-option-${index}`} type="button" role="option" aria-selected={index === active} tabIndex={-1}
          onMouseDown={event => event.preventDefault()} onClick={() => add(entry.id)} onMouseMove={() => setActive(index)}
          className={cn('block w-full px-3 py-2 text-left text-xs', index === active && 'bg-muted')}>
          <span className="block truncate font-medium">{entry.title}</span>
          {entry.description && <span className="block truncate text-muted-foreground">{entry.description}</span>}
        </button>)}
      </div>
      {!matches.length && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{t('issueWork.contextEmpty')}</p>}
    </div>}
  </div>;
}
