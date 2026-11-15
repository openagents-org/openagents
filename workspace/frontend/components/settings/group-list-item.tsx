'use client';

import { Pencil, Trash2, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import type { SecurityGroup } from '@/lib/types';
import { cn } from '@/lib/utils';

/** One security group in the list: select it, or rename/delete a custom one. */
export function GroupListItem({
  group: g,
  name,
  active,
  editable,
  busy,
  onSelect,
  onRename,
  onRemove,
}: {
  group: SecurityGroup;
  name: string;
  active: boolean;
  editable: boolean;
  busy: boolean;
  onSelect: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const builtin = g.builtin || g.kind !== 'custom';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      className={cn(
        'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors',
        active ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <UsersRound className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{name}</span>
          {builtin && <Badge variant="outline" className="shrink-0">{t('groups.builtin')}</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t('groups.memberCount', { count: g.member_count })}
          {g.kind === 'everyone' && ` · ${t('groups.everyoneHint')}`}
          {g.kind === 'guest' && ` · ${t('groups.guestHint')}`}
        </p>
      </div>
      {editable && !builtin && (
        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          {busy ? (
            <Spinner />
          ) : (
            <>
              <Button variant="ghost" size="icon-sm" onClick={onRename} title={t('groups.rename')} aria-label={t('groups.rename')}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={onRemove} title={t('groups.delete')} aria-label={t('groups.delete')}>
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
