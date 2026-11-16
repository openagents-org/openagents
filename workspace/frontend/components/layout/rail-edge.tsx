'use client';
import * as React from 'react';
import { SidebarRail } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useLayout } from './layout-context';

const RAIL_KEYBOARD_SHORTCUT = 'b';

/**
 * The rail's trailing edge, as shadcn's SidebarRail: a thin strip that shows a
 * line on hover and toggles the rail on click. Cmd/Ctrl+B toggles it too.
 *
 * shadcn wires both to the provider's sidebar, which here is the list panel
 * (see Wrapper), so this one is pointed at the rail instead. The strip is
 * `fixed` because the sidebar shell clips its overflow, and it straddles the
 * inset card's leading border (one pixel past the rail), as tall as the card.
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
    <SidebarRail
      onClick={toggleRail}
      aria-label={label}
      aria-expanded={isRailExpanded}
      title={label}
      style={{
        left: 'calc(var(--sidebar-width-icon) + 1.5px)',
        top: 'calc(var(--oa-banner-h, 0px) + 0.5rem)',
        bottom: '0.5rem',
      }}
      className={cn(
        'fixed transition-[left] duration-200 ease-linear',
        // The line lands on the card's own border, so the shipped
        // sidebar-border hover colour would not show against it.
        'after:inset-y-4 hover:after:bg-ring',
        isRailExpanded ? 'cursor-w-resize' : 'cursor-e-resize',
      )}
    />
  );
}
