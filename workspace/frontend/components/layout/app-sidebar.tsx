'use client';

import { Plus } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useLayout } from './layout-context';
import { Brand } from './brand';
import { NavMain } from './nav-main';
import { NavAgents } from './nav-agents';
import { NavSecondary } from './nav-secondary';

export function NewThreadButton() {
  const { openNewThread } = useLayout();

  return (
    <SidebarMenu className="px-1 pb-1">
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="New Thread"
          onClick={openNewThread}
          className="h-9 justify-center gap-2 bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground group-data-[collapsible=icon]:size-9!"
        >
          <Plus />
          <span className="group-data-[collapsible=icon]:hidden">New Thread</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * The floating rail handle from the app-shell-12 block: two small bars that
 * splay apart on hover, with a label that fades in.
 */
function SidebarRailToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isExpanded = state === 'expanded';

  return (
    <button
      type="button"
      aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
      onClick={toggleSidebar}
      style={{ left: isExpanded ? 'var(--sidebar-width)' : 'var(--sidebar-width-icon)' }}
      className="group/rail fixed top-1/2 z-30 hidden h-12 w-7 -translate-y-1/2 cursor-pointer items-center pl-2 outline-none transition-[left] duration-200 ease-linear lg:flex"
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

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pb-0">
        <Brand />
        <NewThreadButton />
      </SidebarHeader>

      <SidebarContent>
        <NavMain />
        <NavAgents />
      </SidebarContent>

      <SidebarFooter className="px-1! in-data-[state=collapsed]:px-1!">
        <div className="px-2">
          <Separator />
        </div>
        <NavSecondary />
      </SidebarFooter>

      <SidebarRailToggle />
    </Sidebar>
  );
}
