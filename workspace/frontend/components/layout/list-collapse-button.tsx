'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useT, type MessageKey } from '@/lib/i18n';
import { useLayout, type ViewMode } from './layout-context';

const LIST_NAME_KEYS: Partial<Record<ViewMode, MessageKey>> = {
  threads: 'nav.listThreads',
  files: 'nav.listFiles',
  routines: 'nav.listRoutines',
  knowledge: 'nav.listKnowledge',
};

/** "Collapse thread list" / "Expand thread list" for the current view. */
export function useListToggleLabel() {
  const { viewMode, isSidebarOpen } = useLayout();
  const t = useT();
  const key = LIST_NAME_KEYS[viewMode];
  if (!key) return t(isSidebarOpen ? 'nav.hideList' : 'nav.showList');
  return t(isSidebarOpen ? 'nav.collapseList' : 'nav.expandList', { name: t(key) });
}

/**
 * Collapses or expands the whole middle list column. Rendered before the list
 * title while open, and before the detail title once collapsed, so the way
 * back is where the way out was. Mobile shows one pane at a time instead.
 */
export function ListToggleButton({ className }: { className?: string }) {
  const { isMobile, isSidebarOpen, setSidebarOpen, hasListPanel } = useLayout();
  const label = useListToggleLabel();
  if (isMobile || !hasListPanel) return null;
  const Icon = isSidebarOpen ? PanelLeftClose : PanelLeftOpen;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          aria-label={label}
          aria-expanded={isSidebarOpen}
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          className={className ?? 'shrink-0 text-muted-foreground'}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
