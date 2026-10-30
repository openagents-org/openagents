'use client';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n';

const colors = [
  'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
];

/** The same label keeps its color across the list, board, and issue details. */
export function IssueLabel({ label, onRemove, disabled }: {
  label: string; onRemove?: () => void; disabled?: boolean;
}) {
  const t = useT();
  const hash = Array.from(label.toLowerCase()).reduce((value, char) => (value * 31 + char.codePointAt(0)!) >>> 0, 0);
  return <span title={label} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${colors[hash % colors.length]}`}>
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
    <span className="truncate">{label}</span>
    {onRemove && <button type="button" disabled={disabled} onClick={onRemove} aria-label={t('issues.removeLabel', { label })} className="-mr-1 rounded-full p-0.5 opacity-50 hover:bg-black/5 hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/10"><X className="size-3" /></button>}
  </span>;
}
