import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** The solid red of every unread count; also used by hand-sized pills that can't be a Badge. */
export const UNREAD_COUNT_CLASS = 'bg-destructive text-destructive-foreground';

/**
 * An unread count: solid red with white digits, capped at "99+". One look for
 * every unread number in the app (nav, rail, thread and DM rows, issues), so
 * "something new" always reads the same.
 */
export function UnreadBadge({
  count,
  size = 'default',
  className,
  ...props
}: Omit<ComponentProps<typeof Badge>, 'variant' | 'children'> & {
  count: number;
  /** `corner` is the smaller badge pinned to an icon's corner. */
  size?: 'default' | 'corner';
}) {
  return (
    <Badge
      className={cn(
        'justify-center tabular-nums',
        size === 'corner' ? 'h-3.5 min-w-3.5 px-0.5 leading-none' : 'h-4 min-w-4 px-1',
        UNREAD_COUNT_CLASS,
        className,
      )}
      {...props}
    >
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
