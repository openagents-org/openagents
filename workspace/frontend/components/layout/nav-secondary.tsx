'use client';

import { PlusSquare } from 'lucide-react';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { isRecentAgent } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';

/**
 * Pinned footer nav. When the workspace has no agent yet this becomes the
 * primary call to action, mirroring the previous sidebar behaviour.
 */
export function NavSecondary({ onNavigate }: { onNavigate?: () => void }) {
  const { viewMode, openView } = useLayout();
  const { agents } = useWorkspace();
  const hasAgents = agents.filter(isRecentAgent).length > 0;
  const isActive = viewMode === 'connect';

  return (
    <SidebarGroup className="py-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Connect Agent"
            isActive={isActive}
            onClick={() => {
              openView('connect');
              onNavigate?.();
            }}
            className={cn(
              !hasAgents &&
                !isActive &&
                'bg-primary/10 text-primary font-medium hover:bg-primary/20 hover:text-primary',
              !hasAgents && isActive && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            )}
          >
            <PlusSquare />
            <span>{hasAgents ? 'Connect Agent' : 'Connect Your First Agent'}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
