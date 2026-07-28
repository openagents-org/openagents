'use client';

import { Sidebar, useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useLayout } from './layout-context';
import { NavRail } from './nav-rail';
import { ListPanel } from './list-panel';

/**
 * The floating rail handle: two small bars that splay apart on hover, with a
 * label that fades in. Sits on the seam between the sidebar and the detail
 * pane and collapses the list panel.
 */
function SidebarRailToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isExpanded = state === 'expanded';

  return (
    <button
      type="button"
      aria-label={isExpanded ? 'Collapse list' : 'Expand list'}
      onClick={toggleSidebar}
      style={{ left: isExpanded ? 'var(--sidebar-width)' : 'var(--sidebar-width-icon)' }}
      className="group/rail fixed top-1/2 z-30 hidden h-12 w-7 -translate-y-1/2 cursor-pointer items-center pl-2 outline-none transition-[left] duration-200 ease-linear focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring lg:flex"
    >
      <span className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'block h-2 w-0.5 origin-bottom rounded-t-full bg-foreground/40 transition-all duration-100 ease-linear group-hover/rail:bg-foreground/60',
            isExpanded ? 'group-hover/rail:rotate-40' : 'group-hover/rail:-rotate-40',
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            'block h-2 w-0.5 origin-top rounded-b-full bg-foreground/40 transition-all duration-100 ease-linear group-hover/rail:bg-foreground/60',
            isExpanded ? 'group-hover/rail:-rotate-40' : 'group-hover/rail:rotate-40',
          )}
        />
      </span>

      <span className="pointer-events-none absolute left-full -ml-2 -translate-x-0.5 rounded-md border border-border bg-foreground px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-background opacity-0 shadow-xs shadow-black/5 transition-all duration-200 ease-out group-hover/rail:translate-x-0 group-hover/rail:opacity-100">
        {isExpanded ? 'Collapse' : 'Expand'}
      </span>
    </button>
  );
}

/**
 * App shell sidebar, built on the app-shell-4 pattern: one `collapsible="icon"`
 * shell holding two inner sidebars side by side — a permanent icon rail and a
 * wide list panel that collapses away with the shell.
 */
export function AppSidebar() {
  const { isMobile } = useSidebar();
  const { hasListPanel } = useLayout();

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
    >
      <div className="flex min-h-full w-full">
        <NavRail />
        {hasListPanel && <ListPanel />}
      </div>

      {!isMobile && hasListPanel && <SidebarRailToggle />}
    </Sidebar>
  );
}
