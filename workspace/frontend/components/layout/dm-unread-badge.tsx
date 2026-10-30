'use client';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function DmUnreadBadge({ count = 0, compact = false }: { count?: number; compact?: boolean }) {
  const t = useT();
  if (count <= 0) return null;
  return <span aria-label={t('nav.unreadMessages', { count })} title={t('nav.unreadMessages', { count })} className={cn('pointer-events-none flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-semibold tabular-nums text-white', compact ? 'absolute right-0 top-0' : 'ml-auto')}>
    {count > 99 ? '99+' : count}
  </span>;
}
