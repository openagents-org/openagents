'use client';
import { UnreadBadge } from '@/components/ui/unread-badge';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function DmUnreadBadge({ count = 0, compact = false }: { count?: number; compact?: boolean }) {
  const t = useT();
  if (count <= 0) return null;
  return (
    <UnreadBadge
      count={count}
      size={compact ? 'corner' : 'default'}
      aria-label={t('nav.unreadMessages', { count })}
      className={cn('pointer-events-none', compact ? 'absolute right-0 top-0' : 'ml-auto')}
    />
  );
}
