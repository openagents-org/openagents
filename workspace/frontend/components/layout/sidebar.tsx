'use client';

import { SidebarContent } from './sidebar-content';
import { SidebarHeader } from './sidebar-header';
import { useLayout } from './layout-context';

export function Sidebar() {
  const { isSidebarOpen } = useLayout();

  return (
    <aside className="fixed overflow-hidden bg-muted top-0 bottom-0 start-0 z-20 transition-all duration-300 flex items-stretch shrink-0 w-(--sidebar-width) in-data-[sidebar-open=false]:w-(--sidebar-width-collapsed)">
      <div
        className="grow shrink-0 transition-all duration-300 flex flex-col"
        style={{ width: isSidebarOpen ? 'var(--sidebar-width)' : 'var(--sidebar-width-collapsed)' }}
      >
        <SidebarHeader />
        <SidebarContent />
      </div>
    </aside>
  );
}
