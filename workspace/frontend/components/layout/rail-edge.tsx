'use client';
import * as React from 'react';
import { useT } from '@/lib/i18n';
import { EdgeToggle } from './edge-toggle';
import { useLayout } from './layout-context';

const RAIL_KEYBOARD_SHORTCUT = 'b';

/**
 * The rail's collapse handle, on its trailing edge. It matches the list
 * panel's handle (bars that turn into a chevron, a dark label, a pointer
 * cursor): the old full-height strip with a resize cursor read as something
 * to drag. Cmd/Ctrl+B toggles the rail too.
 *
 * `fixed` because the sidebar shell clips its overflow; it sits one pixel
 * past the rail, on the inset card's leading border.
 */
export function RailEdge() {
  const { isRailExpanded, toggleRail } = useLayout();
  const t = useT();
  const label = isRailExpanded ? t('nav.collapseSidebar') : t('nav.expandSidebar');

  const toggleRef = React.useRef(toggleRail);
  toggleRef.current = toggleRail;

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== RAIL_KEYBOARD_SHORTCUT || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      // Capture phase on window runs before SidebarProvider's own listener, so
      // stopping here keeps the shortcut from also toggling the list panel.
      event.stopPropagation();
      toggleRef.current();
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  return (
    <EdgeToggle
      label={label}
      expanded={isRailExpanded}
      onClick={toggleRail}
      style={{ left: 'calc(var(--sidebar-width-icon) + 1px)' }}
      className="fixed top-1/2"
    />
  );
}
