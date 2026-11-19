'use client';

import { useId, useState } from 'react';
import { BookOpen, Plus, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Field, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const MAX_CONTEXT = 100;

/**
 * Knowledge entries sent along with an agent request. The list stays open
 * after each pick so several entries can be added in a row; the popover is
 * modal so the assignment dialog behind it keeps its scroll lock.
 */
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
  const full = value.length >= MAX_CONTEXT;
  const matches = knowledge.filter(entry => !value.includes(entry.id) &&
    [entry.title, entry.description, entry.slug].some(text => text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).slice(0, 8);
  const titleOf = (entryId: string) => knowledge.find(entry => entry.id === entryId)?.title || t('issueWork.contextUnavailable');
  const add = (entryId: string) => {
    if (disabled || value.includes(entryId) || full) return;
    onChange([...value, entryId]);
    setQuery('');
  };
  return <Field>
    <FieldLabel htmlFor={id}><BookOpen className="size-3.5" />{t('issueWork.context')}</FieldLabel>
    {value.length > 0 && <div className="flex flex-wrap gap-1.5">{value.map(entryId => <Badge key={entryId} variant="outline" className="max-w-full pr-0.5">
      <span className="truncate">{titleOf(entryId)}</span>
      <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={t('issueWork.removeContext', { name: titleOf(entryId) })} onClick={() => onChange(value.filter(item => item !== entryId))} className="size-4 rounded-full">
        <X />
      </Button>
    </Badge>)}</div>}
    <Popover modal open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" size="sm" disabled={disabled || full} className="w-fit">
          <Plus data-icon="inline-start" />{t('issueWork.addContext')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-(--radix-popover-trigger-width) min-w-72 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } }}>
        <Command shouldFilter={false} loop label={t('issueWork.context')} className="rounded-lg! [&_[data-slot=command-input-wrapper]]:h-11 [&_[data-slot=command-input-wrapper]]:px-3">
          <CommandInput autoFocus aria-label={t('issueWork.contextPlaceholder')} placeholder={t('issueWork.contextPlaceholder')} value={query} onValueChange={setQuery} className="text-xs" />
          <CommandList className="max-h-60 overscroll-contain p-1.5">
            <CommandEmpty className="px-3 py-6 text-xs">{t('issueWork.contextEmpty')}</CommandEmpty>
            <CommandGroup>
              {matches.map(entry => <CommandItem key={entry.id} value={entry.id} disabled={disabled || full} onSelect={() => add(entry.id)} className="rounded-md px-2 py-2 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{entry.title}</span>
                  {entry.description && <span className="block truncate text-muted-foreground">{entry.description}</span>}
                </span>
              </CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </Field>;
}
