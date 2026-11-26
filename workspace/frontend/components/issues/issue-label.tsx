'use client';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Labels are free text, so each one is hashed onto this fixed palette. Three
 * entries are the theme's status tokens; violet and rose have no token and
 * stay as palette colours, defined once here.
 */
const LABEL_PALETTE = [
  'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'border-info/20 bg-info/10 text-info',
  'border-success/20 bg-success/10 text-success',
  'border-warning/20 bg-warning/10 text-warning',
  'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
];

/** The same label keeps its color across the list, board, and issue details. */
export function IssueLabel({ label, onRemove, disabled }: {
  label: string; onRemove?: () => void; disabled?: boolean;
}) {
  const t = useT();
  const hash = Array.from(label.toLowerCase()).reduce((value, char) => (value * 31 + char.codePointAt(0)!) >>> 0, 0);
  return <Badge variant="outline" title={label} className={cn('max-w-full gap-1.5', onRemove && 'overflow-visible pr-1', LABEL_PALETTE[hash % LABEL_PALETTE.length])}>
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
    <span className="truncate">{label}</span>
    {onRemove && <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} onClick={onRemove} aria-label={t('issues.removeLabel', { label })}
      className="size-4 rounded-full text-current opacity-50 hover:bg-current/10 hover:text-current hover:opacity-100 focus-visible:opacity-100"><X /></Button>}
  </Badge>;
}
