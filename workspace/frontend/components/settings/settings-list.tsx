'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { ItemGroup, ItemSeparator } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Rows inside a settings card, split by separators alone: the group gap (set
 * by has-[size] variants, which a plain gap-0 would not beat) and the rows'
 * side padding are dropped so they line up with the card header.
 */
export function SettingsList({ children, className }: { children: React.ReactNode; className?: string }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <ItemGroup
      className={cn(
        'gap-0 has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0 *:data-[slot=item]:px-0',
        className,
      )}
    >
      {rows.map((row, index) => (
        <React.Fragment key={React.isValidElement(row) && row.key != null ? row.key : index}>
          {index > 0 && <ItemSeparator className="my-0" />}
          {row}
        </React.Fragment>
      ))}
    </ItemGroup>
  );
}

/** A list that is still loading. */
export function ListLoading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

/** A list with nothing in it (or that failed to load), with an optional icon and action. */
export function ListEmpty({
  icon,
  children,
  action,
  destructive = false,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <Empty className="p-4">
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyDescription className={destructive ? 'text-destructive' : undefined}>{children}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** A list that failed to load, with a retry when the caller can reload it. */
export function ListError({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  const t = useT();
  return (
    <ListEmpty
      destructive
      action={onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>{t('common.retry')}</Button>
      )}
    >
      {children}
    </ListEmpty>
  );
}
