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
import { agentLabel, isRecentAgent } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { useLayout } from './layout-context';

/**
 * Agents rail: recent/online agents (kept visible on the icon rail as avatars)
 * plus the list of humans currently in the workspace.
 *
 * `onNavigate` fires after anything here changes what the detail area shows —
 * the mobile drawer uses it to close itself, since otherwise the sheet stays
 * parked over the very panel the tap just opened.
 */
export function NavAgents({ onNavigate }: { onNavigate?: () => void }) {
  const { setSelectedAgentName, openMobileDetail } = useLayout();
  const { agents, onlineUsers, currentUser, setCurrentSessionId } = useWorkspace();
  const t = useT();
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
              {t('nav.agentsWithCount', { online: onlineCount, total: recentAgents.length })}
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
                    tooltip={agentLabel(agent)}
                    onClick={() => {
                      // Same as the desktop rail: a person-click opens the DM
                      // (the profile is one more tap away via the overlay).
                      const pair = ['human:user', `openagents:${agent.agentName}`].sort();
                      setCurrentSessionId(`dm:${pair[0]},${pair[1]}`);
                      openMobileDetail();
                      setSelectedAgentName(agent.agentName);
                      onNavigate?.();
                    }}
                  >
                    <AgentAvatar
                      name={agent.agentName}
                      size={20}
                      status={agent.status}
                      showStatus
                      className="[&_svg]:size-full!"
                    />
                    <span className="min-w-0 truncate">{agentLabel(agent)}</span>
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
            {t('nav.onlineWithCount', { count: onlineUsers.length })}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.25">
              {onlineUsers.map((u) => (
                <SidebarMenuItem key={u.id}>
                  <div className="flex h-8 items-center gap-2 rounded-md px-2 text-sm">
                    <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate text-foreground">
                      {u.id === currentUser.id ? t('nav.you', { name: u.name }) : u.name}
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
