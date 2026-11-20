'use client';

import { Pencil, Trash2, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { IconAction } from '@/components/settings/icon-action';
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
    <Item
      size="sm"
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={cn('cursor-pointer', active ? 'bg-muted' : 'hover:bg-muted/50')}
    >
      <ItemMedia variant="icon">
        <UsersRound className="text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          <span className="truncate">{name}</span>
          {builtin && <Badge variant="outline">{t('groups.builtin')}</Badge>}
        </ItemTitle>
        <ItemDescription className="line-clamp-1 text-xs">
          {t('groups.memberCount', { count: g.member_count })}
          {g.kind === 'everyone' && ` · ${t('groups.everyoneHint')}`}
          {g.kind === 'guest' && ` · ${t('groups.guestHint')}`}
        </ItemDescription>
      </ItemContent>
      {editable && !builtin && (
        // The row itself selects the group; its actions must not — neither
        // their clicks nor their keys (Enter on delete would select the row).
        <ItemActions className="gap-0.5 text-muted-foreground" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {busy ? (
            <Spinner />
          ) : (
            <>
              <IconAction label={t('groups.rename')} onClick={onRename}>
                <Pencil />
              </IconAction>
              <IconAction label={t('groups.delete')} destructive onClick={onRemove}>
                <Trash2 />
              </IconAction>
            </>
          )}
        </ItemActions>
      )}
    </Item>
  );
}
