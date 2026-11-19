'use client';
import { useOnboardingSurface } from './onboarding-surface';

import { Sidebar, useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { EdgeToggle } from './edge-toggle';
import { useLayout } from './layout-context';
import { useListToggleLabel } from './list-collapse-button';
import { NavRail } from './nav-rail';
import { ListPanel } from './list-panel';

/**
 * The list panel's collapse handle. Sits on the seam between the sidebar and
 * the detail pane. Every list view gets one, threads included: with a preview
 * open, the list is what stands between the user and a wide working area.
 */
function SidebarRailToggle() {
  const { state, toggleSidebar } = useSidebar();
  const label = useListToggleLabel();
  return (
    <EdgeToggle
      label={label}
      expanded={state === 'expanded'}
      onClick={toggleSidebar}
      // The shell already shrinks to the rail when the list closes, so the
      // handle always rides its trailing edge. Positioned against the shell
      // (not the viewport) so it stays on that edge when a narrow window
      // scrolls the shell sideways.
      style={{ left: 'var(--sidebar-width)' }}
      className="absolute top-1/2"
    />
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
 */
export function AppSidebar() {
  const { hasListPanel, isSidebarOpen } = useLayout();
  const onboarding = useOnboardingSurface();

  return (
    <>
      <Sidebar
        collapsible="none"
        className={cn(
          // Fills the shell, which is already the viewport minus any banner.
          'h-full shrink-0 overflow-hidden',
        )}
      >
        {/* The list stays mounted while collapsed — the shell simply squeezes
            it to zero width — so its scroll position, filter and search survive
            a collapse/expand round trip. */}
        <div className="flex min-h-full w-full">
          <NavRail />
          <ListPanel />
        </div>
      </Sidebar>

      {/* Only while the list is open. Collapsed, this handle would land on the
          exact seam the rail's own toggle owns — and the app header already
          grows a "Show list" button for that case. */}
      {!onboarding && hasListPanel && isSidebarOpen && (
        <SidebarRailToggle />
      )}
    </>
  );
}
