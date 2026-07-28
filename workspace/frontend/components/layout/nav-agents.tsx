'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { cn } from '@/lib/utils';
import { isRecentAgent } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';

/**
 * Agents rail: recent/online agents (kept visible on the icon rail as avatars)
 * plus the list of humans currently in the workspace.
 */
export function NavAgents() {
  const { setSelectedAgentName } = useLayout();
  const { agents, onlineUsers, currentUser } = useWorkspace();
  const [open, setOpen] = useState(true);

  const recentAgents = useMemo(() => agents.filter(isRecentAgent), [agents]);
  const onlineCount = agents.filter((a) => a.status === 'online').length;

  if (recentAgents.length === 0 && onlineUsers.length === 0) return null;

  return (
    <>
      {recentAgents.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel
            asChild
            className="w-full cursor-pointer focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
              aria-controls="sidebar-agent-list"
            >
              Agents ({onlineCount}/{recentAgents.length})
              <ChevronDown
                className={cn(
                  'ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200',
                  !open && '-rotate-90',
                )}
              />
            </button>
          </SidebarGroupLabel>

          {/* The rail keeps avatars visible even when the group is collapsed on desktop */}
          <SidebarGroupContent
            id="sidebar-agent-list"
            className={cn(!open && 'hidden group-data-[collapsible=icon]:block')}
          >
            <SidebarMenu className="gap-0.25">
              {recentAgents.map((agent) => (
                <SidebarMenuItem key={agent.agentName}>
                  <SidebarMenuButton
                    tooltip={agent.agentName}
                    onClick={() => setSelectedAgentName(agent.agentName)}
                  >
                    <AgentAvatar
                      name={agent.agentName}
                      size={20}
                      status={agent.status}
                      showStatus
                      className="[&_svg]:size-full!"
                    />
                    <span className="min-w-0 truncate">{agent.agentName}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {onlineUsers.length > 0 && (
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>
            <Users className="mr-1 size-3" />
            Online ({onlineUsers.length})
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.25">
              {onlineUsers.map((u) => (
                <SidebarMenuItem key={u.id}>
                  <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sm">
                    <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate text-foreground">
                      {u.id === currentUser.id ? `${u.name} (you)` : u.name}
                    </span>
                  </div>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}
