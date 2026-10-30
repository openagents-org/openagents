'use client';

import { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useI18n, useT } from '@/lib/i18n';
import { format, parseISO } from 'date-fns';
import { enUS, zhCN } from 'react-day-picker/locale';
import type { WorkspaceIssue } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function IssueDueDate({ issue, busy, canEdit, update }: {
  issue: Pick<WorkspaceIssue, 'id' | 'due_date'>;
  busy: boolean;
  canEdit: boolean;
  update: (values: { due_date: string | null }) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
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
    {canEdit ? <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={busy} aria-label={`${t('issues.dueDate')}: ${label}`} className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-transparent px-1.5 py-1.5 text-left text-xs transition-colors hover:border-border hover:bg-muted/40 disabled:opacity-50">
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
          <span className={`flex-1 ${issue.due_date ? 'font-medium' : 'text-muted-foreground'}`}>{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground/60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="single"
          required
          autoFocus
          locale={locale === 'zh-CN' ? zhCN : enUS}
          selected={issue.due_date ? parseISO(issue.due_date) : undefined}
          defaultMonth={issue.due_date ? parseISO(issue.due_date) : undefined}
          disabled={busy}
          onSelect={date => { if (date) save(format(date, 'yyyy-MM-dd')); }}
        />
        {issue.due_date && <div className="border-t p-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => save(null)} className="w-full text-xs">{t('issues.clearDueDate')}</Button>
        </div>}
      </PopoverContent>
    </Popover> : <div aria-labelledby={`issue-due-date-heading-${issue.id}`} title={t('issues.dueDateOwnerOnly')} className="flex min-h-10 items-center gap-2.5 px-1.5 text-xs text-muted-foreground">
      <CalendarDays className="size-4 shrink-0" />{issue.due_date ? <time dateTime={issue.due_date}>{label}</time> : label}
    </div>}
  </section>;
}
