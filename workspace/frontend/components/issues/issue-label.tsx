'use client';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n';

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
  return <span title={label} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-4 ${LABEL_PALETTE[hash % LABEL_PALETTE.length]}`}>
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
    <span className="truncate">{label}</span>
    {onRemove && <button type="button" disabled={disabled} onClick={onRemove} aria-label={t('issues.removeLabel', { label })} className="-mr-1 rounded-full p-0.5 opacity-50 hover:bg-current/10 hover:opacity-100 focus-visible:opacity-100"><X className="size-3" /></button>}
  </span>;
}
