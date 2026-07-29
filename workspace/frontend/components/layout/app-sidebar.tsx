'use client';

import { Sidebar, useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useLayout } from './layout-context';
import { NavRail } from './nav-rail';
import { ListPanel } from './list-panel';

/**
 * The floating list handle: two small bars that splay apart on hover, with a
 * label that fades in. Sits on the seam between the sidebar and the detail
 * pane and collapses the list panel.
 *
 * Threads doesn't get one — the message list is always wanted there — so this
 * only renders for the other list views (files, browser, routines, knowledge).
 */
function SidebarRailToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isExpanded = state === 'expanded';

  return (
    <button
      type="button"
      aria-label={isExpanded ? 'Collapse list' : 'Expand list'}
      onClick={toggleSidebar}
      // The shell already shrinks to the rail when the list closes, so the
      // handle always rides its trailing edge.
      style={{ left: 'var(--sidebar-width)' }}
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
 * App shell sidebar, built on the app-shell-4 pattern: one shell holding two
 * inner sidebars side by side — the icon rail and a wide list panel that drops
 * away on views that have no list.
 *
 * It is deliberately *not* `collapsible="icon"`: that mode stamps
 * `data-collapsible="icon"` on an ancestor group, and shadcn's own rules then
 * squeeze every menu button to a 32px square — which would hide the rail's
 * labels on exactly the views that drop the list. Instead the shell owns its
 * width (see {@link Wrapper}): closing the list shrinks it to the rail, and the
 * list — still mounted — is squeezed to zero width behind `overflow-hidden`.
 *
 * Threads is the one view whose list has no collapse handle — the message list
 * is always wanted there, and the rail's own toggle covers that case.
 */
export function AppSidebar() {
  const { hasListPanel, viewMode, isMobile } = useLayout();

  return (
    <>
      <Sidebar
        collapsible="none"
        className="h-svh shrink-0 overflow-hidden border-e transition-[width] duration-200 ease-linear"
      >
        {/* The list stays mounted while collapsed — the shell simply squeezes
            it to zero width — so its scroll position, filter and search survive
            a collapse/expand round trip. */}
        <div className="flex min-h-full w-full">
          <NavRail />
          {hasListPanel && <ListPanel />}
        </div>
      </Sidebar>

      {!isMobile && hasListPanel && viewMode !== 'threads' && <SidebarRailToggle />}
    </>
  );
}
