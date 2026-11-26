import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';

/** The thread header's people/agent counter buttons. */
export const ROSTER_TRIGGER = 'px-1.5 font-normal tabular-nums text-muted-foreground';

export type RosterEntry = { key: string; media: ReactNode; title: string; description?: string };

/** The list inside a thread header's people/agents popover. */
export function RosterList({ title, empty, items, add }: {
  title: string;
  empty: string;
  items: RosterEntry[];
  add: { label: string; icon: ReactNode; onClick: () => void } | null;
}) {
  return (
    <>
      <h4 className="px-1 text-sm font-medium">{title}</h4>
      {items.length ? (
        <ItemGroup className="no-scrollbar max-h-72 gap-0 overflow-y-auto">
          {items.map((item) => (
            <Item key={item.key} size="xs" className="px-1">
              <ItemMedia>{item.media}</ItemMedia>
              <ItemContent>
                <ItemTitle className="truncate" title={item.title}>{item.title}</ItemTitle>
                {item.description && <ItemDescription className="truncate" title={item.description}>{item.description}</ItemDescription>}
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      ) : <p className="px-1 text-sm text-muted-foreground">{empty}</p>}
      {add && <>
        <Separator />
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={add.onClick}>
          {add.icon}{add.label}
        </Button>
      </>}
    </>
  );
}
