'use client';

import { ApprovalCard } from '@/components/chat/approval-card';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n';
import { inboxActionKind } from '@/lib/inbox';
import type { ApprovalRequest, NotificationItem } from '@/lib/types';
import { NotificationCard } from './notification-card';

/** Per-id cache of the live approval records behind actionable rows. */
export interface ActionState {
  cards: Record<string, ApprovalRequest>;
  loading: Record<string, boolean>;
  failed: Record<string, boolean>;
}

/** The approval behind an opened row, indented under the row's text column. */
function ExpandedCard({
  notification,
  state,
  onResolved,
}: {
  notification: NotificationItem;
  state: ActionState;
  onResolved: (notification: NotificationItem, approval: ApprovalRequest) => void;
}) {
  const t = useT();
  const ref = notification.actionRef!;
  const card = state.cards[ref];
  if (card) {
    return (
      <div className="px-3 pb-3 pl-13" onClick={(e) => e.stopPropagation()}>
        <ApprovalCard approval={card} onResolved={(a) => onResolved(notification, a)} />
      </div>
    );
  }
  if (state.failed[ref]) {
    return <p className="px-3 pb-3 pl-13 text-xs text-muted-foreground">{t('inbox.loadFailed')}</p>;
  }
  return (
    <div className="flex flex-col gap-2 px-3 pb-3 pl-13" data-testid="inbox-card-skeleton">
      <Skeleton className="h-7 w-full max-w-xl rounded-md" />
      <Skeleton className="h-14 w-full max-w-xl rounded-md" />
    </div>
  );
}

export function NotificationSection({
  title,
  items,
  onRead,
  onDismiss,
  onNavigate,
  expandedIds,
  onToggle,
  actionState,
  resolvedRefs,
  onResolved,
}: {
  title: string;
  items: NotificationItem[];
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (notification: NotificationItem) => void;
  expandedIds: Record<string, boolean>;
  onToggle: (notification: NotificationItem) => void;
  actionState: ActionState;
  resolvedRefs: ReadonlySet<string>;
  onResolved: (notification: NotificationItem, approval: ApprovalRequest) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {title} ({items.length})
      </h3>
      <Card className="gap-0 divide-y py-0">
        {items.map((n) => {
          const actionable = inboxActionKind(n) !== null;
          const expanded = actionable && Boolean(expandedIds[n.id]);
          return (
            <div key={n.id} className="group">
              <NotificationCard
                notification={n}
                onRead={onRead}
                onDismiss={onDismiss}
                onNavigate={onNavigate}
                expanded={expanded}
                onToggle={actionable ? onToggle : undefined}
                resolved={Boolean(n.actionRef && resolvedRefs.has(n.actionRef))}
              />
              {expanded && <ExpandedCard notification={n} state={actionState} onResolved={onResolved} />}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
