'use client';

import { useEffect, useState } from 'react';
import { Plus, Tag } from 'lucide-react';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { IssueLabel } from './issue-label';

const MAX_LABELS = 20;
const CREATE = 'create:';

/**
 * Adds a label to an issue: an existing workspace label, or a new one typed
 * in. The typed label is the first option, so Enter adds what was typed and
 * the arrow keys move to the suggestions below it.
 */
export function IssueLabelPicker({ labels, busy, onAdd, workspaceId }: {
  labels: string[];
  busy: boolean;
  onAdd: (label: string) => void;
  workspaceId?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [knownLabels, setKnownLabels] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setKnownLabels([]);
    void workspaceApi.listIssueLabels().then(values => { if (active) setKnownLabels(values); }).catch(() => {});
    return () => { active = false; };
  }, [open, workspaceId]);
  const typed = label.trim();
  const full = labels.length >= MAX_LABELS;
  const onIssue = (value: string) => labels.some(item => item.toLowerCase() === value.toLowerCase());
  const known = knownLabels.find(item => item.toLowerCase() === typed.toLowerCase());
  const canCreate = !!typed && !known && !onIssue(typed);
  const suggestions = knownLabels.filter(value => !onIssue(value) && value.toLowerCase().includes(typed.toLowerCase())).slice(0, 10);
  const change = (next: boolean) => { setOpen(next); if (!next) setLabel(''); };
  const add = (value: string) => {
    const normalized = knownLabels.find(item => item.toLowerCase() === value.trim().toLowerCase()) || value.trim();
    if (busy || !normalized || full || onIssue(normalized)) return;
    onAdd(normalized);
    change(false);
  };

  return <Popover open={open} onOpenChange={change}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon-xs" disabled={busy || full} aria-label={t('issues.addLabel')} className="text-muted-foreground"><Plus /></Button>
    </PopoverTrigger>
    {!labels.length && !open && <Button variant="ghost" size="xs" disabled={busy} onClick={() => setOpen(true)} className="text-muted-foreground"><Tag data-icon="inline-start" />{t('issues.addLabel')}</Button>}
    <PopoverContent align="start" sideOffset={6} className="w-64 gap-0 overflow-hidden p-0">
      <Command shouldFilter={false} loop label={t('issues.addLabel')} className="[&_[data-slot=command-input-wrapper]]:h-11 [&_[data-slot=command-input-wrapper]]:px-3">
        <CommandInput autoFocus aria-label={t('issues.addLabel')} placeholder={t('issues.labelName')} maxLength={40} value={label} onValueChange={setLabel} className="text-xs" />
        {(canCreate || suggestions.length > 0) && <CommandList className="max-h-60 p-1.5">
          <CommandGroup>
            {canCreate && <CommandItem value={`${CREATE}${typed}`} disabled={busy} onSelect={() => add(typed)} className="gap-2 rounded-md px-2 py-1.5 text-xs">
              <Plus />{t('issues.createLabel', { label: typed })}
            </CommandItem>}
            {suggestions.map(value => <CommandItem key={value} value={value} disabled={busy} onSelect={() => add(value)} className="rounded-md px-2 py-1.5 text-xs">
              <IssueLabel label={value} />
            </CommandItem>)}
          </CommandGroup>
        </CommandList>}
      </Command>
    </PopoverContent>
  </Popover>;
}
