'use client';
import { DmUnreadBadge } from './dm-unread-badge';

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
import { AgentRosterHints } from '@/components/agents/agent-roster-hints'; // v1.1 M1
import { cn } from '@/lib/utils';
import { agentLabel } from '@/lib/helpers';
import { sidebarAgents } from '@/lib/sidebar-agents';
import { agentAvailability, availabilityDotClass, availabilityLabel } from '@/lib/collab'; // v1.1 M3
import { useWorkspace } from '@/lib/workspace-context';
import { dmSessionId, myAddress } from '@/lib/dm';
import { useT } from '@/lib/i18n';
import { SidebarMembers } from './sidebar-members';
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
  const { setSelectedAgentName, openMobileDetail, openView, setThreadFilter } = useLayout();
  const { agents, onlineUsers, currentUser, setCurrentSessionId, unreadDmCounts, pendingApprovalsByAgent } = useWorkspace();
  const t = useT();
  const [open, setOpen] = useState(true);

  const recentAgents = useMemo(() => sidebarAgents(agents, currentUser.id), [agents, currentUser.id]);
  const onlineAgents = recentAgents.filter((a) => a.status === 'online');

  if (onlineAgents.length === 0 && onlineUsers.length === 0) return null;

  return (
    <>
      {onlineAgents.length > 0 && (
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
              {t('nav.agentsWithCount', { online: onlineAgents.length, total: recentAgents.length })}
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
              {onlineAgents.map((agent) => {
                // v1.1 M3: one dot vocabulary everywhere — busy (blue), waiting
                // for a person (amber), device down (grey with a red ring).
                const availability = agentAvailability(agent, pendingApprovalsByAgent[agent.agentName] ?? 0);
                const label = availabilityLabel(t, availability, agent.queueDepth ?? 0);
                return (
                  <SidebarMenuItem key={agent.agentName}>
                    <SidebarMenuButton
                      tooltip={`${agentLabel(agent)} · ${label}`}
                      onClick={() => {
                        // Same as the desktop rail: a person-click opens the DM
                        // (the profile is one more tap away via the overlay).
                        setCurrentSessionId(dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`));
                        openMobileDetail();
                        setSelectedAgentName(null);
                        openView('threads');
                        setThreadFilter('dms');
                        openMobileDetail();
                        onNavigate?.();
                      }}
                    >
                      <span className="relative shrink-0" title={label} aria-label={label}>
                        <AgentAvatar
                          name={agent.agentName}
                          size={20}
                          className="[&_svg]:size-full!"
                        />
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-[1.5px] border-background',
                            availabilityDotClass(availability),
                          )}
                        />
                      </span>
                      <span className="min-w-0 truncate">{agentLabel(agent)}</span>
                      {/* v1.1 M1: Personal badge + "device offline" marker */}
                      <AgentRosterHints agent={agent} className="ml-auto" />
                      <DmUnreadBadge count={unreadDmCounts[dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`)]} />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <SidebarMembers showLabels onNavigate={onNavigate} />
    </>
  );
}
