'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** A shelf row: one line of tiles that scrolls (and drags) sideways. */
export const RESOURCE_ROW = 'no-scrollbar flex cursor-grab select-none flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-proximity data-[dragging=true]:cursor-grabbing data-[dragging=true]:[&_*]:cursor-grabbing';

export interface ResourceShelfTab {
  value: string;
  label: string;
  icon: ReactNode;
  count: number;
}

/**
 * The thread's resource shelf under the header: tabs with counts, scroll
 * arrows, and a collapse toggle. The rows themselves come in as
 * `<TabsContent>` children. Presentational: the workspace thread and the
 * shared-thread pages each feed it their own data.
 */
export function ResourceShelf({ tabs, active, onActiveChange, collapsed, onCollapsedChange, showArrows, onScroll, children }: {
  tabs: ResourceShelfTab[];
  active: string;
  onActiveChange: (value: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  showArrows: boolean;
  onScroll: (direction: number) => void;
  children: ReactNode;
}) {
  const t = useT();
  return <section className="min-w-0 shrink-0 border-b bg-muted/15 px-3 py-2" aria-label={t('threadResources.title')}>
    <Tabs value={active} onValueChange={value => { onActiveChange(value); onCollapsedChange(false); }} className="min-w-0 gap-1.5">
      <div className="flex items-center gap-2">
        <TabsList className="h-7" aria-label={t('threadResources.title')}>
          {tabs.map(tab => <TabsTrigger key={tab.value} value={tab.value} className="px-2 text-xs">{tab.icon}{tab.label}<span className="tabular-nums text-muted-foreground">{tab.count}</span></TabsTrigger>)}
        </TabsList>
        {showArrows && <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon-xs" aria-label={t('threadResources.scrollLeft')} onClick={() => onScroll(-1)}><ChevronLeft /></Button>
          <Button variant="outline" size="icon-xs" aria-label={t('threadResources.scrollRight')} onClick={() => onScroll(1)}><ChevronRight /></Button>
        </div>}
        <Button variant="ghost" size="icon-xs" onClick={() => onCollapsedChange(!collapsed)} aria-expanded={!collapsed} aria-label={t(collapsed ? 'threadResources.expand' : 'threadResources.collapse')} className={cn('text-muted-foreground', !showArrows && 'ml-auto')}>{collapsed ? <ChevronDown /> : <ChevronUp />}</Button>
      </div>
      {!collapsed && children}
    </Tabs>
  </section>;
}
