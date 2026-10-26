'use client';

import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { WorkspaceIssue } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function IssueDueDate({ issue, busy, canEdit, update }: {
  issue: Pick<WorkspaceIssue, 'id' | 'due_date'>;
  busy: boolean;
  canEdit: boolean;
  update: (values: { due_date: string | null }) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const save = (value: string | null) => {
    if (busy || !canEdit) return;
    if (value !== (issue.due_date || null)) update({ due_date: value });
    setOpen(false);
  };
  // Keep this a calendar date throughout; UTC conversion can move a deadline
  // to the previous day for people west of Greenwich.
  const label = issue.due_date || t('issues.noDueDate');
  return <section className="space-y-2">
    <h3 id={`issue-due-date-heading-${issue.id}`} className="text-[11px] font-medium text-muted-foreground">{t('issues.dueDate')}</h3>
    {canEdit ? <Popover open={open} onOpenChange={value => { setOpen(value); if (value) setDraft(issue.due_date || ''); }}>
      <PopoverTrigger asChild>
        <button type="button" disabled={busy} aria-label={`${t('issues.dueDate')}: ${label}`} className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1.5 text-left text-xs transition-colors hover:border-border hover:bg-muted/40 disabled:opacity-50">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className={`flex-1 ${issue.due_date ? 'font-medium' : 'text-muted-foreground'}`}>{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground/60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (draft) save(draft); }}>
          <label htmlFor={`issue-due-date-${issue.id}`} className="text-xs font-medium">{t('issues.setDueDate')}</label>
          <Input id={`issue-due-date-${issue.id}`} type="date" min="0001-01-01" max="9999-12-31" required autoFocus disabled={busy} value={draft} onChange={event => setDraft(event.target.value)} className="h-9 text-sm" />
          <div className="flex items-center justify-end gap-2">
            {issue.due_date && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => save(null)} className="mr-auto text-xs">{t('issues.clearDueDate')}</Button>}
            <Button type="submit" size="sm" disabled={busy || !draft} className="text-xs">{t('common.save')}</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover> : <div aria-labelledby={`issue-due-date-heading-${issue.id}`} title={t('issues.dueDateOwnerOnly')} className="flex min-h-10 items-center gap-2.5 px-1.5 text-xs text-muted-foreground">
      <CalendarDays className="size-4 shrink-0" />{issue.due_date ? <time dateTime={issue.due_date}>{label}</time> : label}
    </div>}
  </section>;
}
