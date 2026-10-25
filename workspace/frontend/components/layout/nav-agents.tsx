'use client';
import { MoreAgents } from './more-agents';
import { DmUnreadBadge } from './dm-unread-badge';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, Plus, Users } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentRosterHints } from '@/components/agents/agent-roster-hints'; // v1.1 M1
import { cn, hasTruncatedLabel } from '@/lib/utils';
import { agentLabel } from '@/lib/helpers';
import { sidebarAgents, isOwnedAgent, isMySidebarAgent, sidebarAgentGroups } from '@/lib/sidebar-agents';
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
  const { setSelectedAgentName, openMobileDetail, openView, openAddAgent, setThreadFilter } = useLayout();
  const { agents, onlineUsers, currentUser, setCurrentSessionId, unreadDmCounts, dmConversations, pendingApprovalsByAgent } = useWorkspace();
  const t = useT();
  const [open, setOpen] = useState(true);
  // Expanded, a row repeats its name in a tooltip only when the name is cut off.
  const { state: sidebarState } = useSidebar();
  const [truncatedAgent, setTruncatedAgent] = useState<string | null>(null);

  const recentAgents = useMemo(() => sidebarAgents(agents, currentUser.id), [agents, currentUser.id]);
  const onlineAgents = recentAgents.filter((a) => a.status === 'online');
  const groups = sidebarAgentGroups(agents, currentUser.id, dmConversations);
  const visibleAgents = groups.flatMap(group => group.shown);
  const firstSharedIndex = visibleAgents.findIndex(agent => !isMySidebarAgent(agent, currentUser.id));

  if (recentAgents.length === 0 && onlineUsers.length === 0) return null;

  return (
    <>
      {recentAgents.length > 0 && (
        <SidebarGroup>
          <div className="flex items-center">
          <SidebarGroupLabel
            asChild
            className="min-w-0 flex-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
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
          {/* Same "+" as the Members header: straight to the add-agent gallery. */}
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground group-data-[collapsible=icon]:hidden"
            aria-label={t('nav.addAgent')}
            title={t('nav.addAgent')}
            onClick={() => { openAddAgent(); onNavigate?.(); }}
          >
            <Plus className="size-3.5" />
          </button>
          </div>

          {/* The rail keeps avatars visible even when the group is collapsed on desktop */}
          <SidebarGroupContent
            id="sidebar-agent-list"
            className={cn(!open && 'hidden group-data-[collapsible=icon]:block')}
          >
            <SidebarMenu className="gap-0.25">
              {visibleAgents.map((agent, index) => {
                // v1.1 M3: one dot vocabulary everywhere — busy (blue), waiting
                // for a person (amber), device down (grey with a red ring).
                const availability = agentAvailability(agent, pendingApprovalsByAgent[agent.agentName] ?? 0);
                const label = availabilityLabel(t, availability, agent.queueDepth ?? 0);
                return (
                  <Fragment key={agent.agentName}>
                    {index === firstSharedIndex && <li role="separator" aria-label={t('collab.sharedByOthers')} className="mx-2 flex items-center gap-2">
                        <span className="h-px min-w-0 flex-1 bg-sidebar-border" />
                      <span className="shrink-0 text-center text-[10px] leading-5 text-muted-foreground group-data-[collapsible=icon]:hidden">{t('collab.sharedByOthers')}</span>
                      <span className="h-px min-w-0 flex-1 bg-sidebar-border" />
                    </li>}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      // Collapsed, the only place the name shows; open, only for a
                      // name cut off by the ellipsis.
                      tooltip={{ children: `${agentLabel(agent)} · ${label}`, hidden: sidebarState !== 'collapsed' && truncatedAgent !== agent.agentName }}
                      onPointerEnter={(e) => setTruncatedAgent(hasTruncatedLabel(e.currentTarget) ? agent.agentName : null)}
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
                      {/* No title: the row's tooltip already gives the status,
                          and a native one on top showed two hints at once. */}
                      <span className="relative shrink-0" aria-label={label}>
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
                      <span className="min-w-0 truncate" data-truncatable>{agentLabel(agent)}</span>
                      {/* v1.1 M1: Personal badge + "device offline" marker */}
                      {isOwnedAgent(agent, currentUser.id) && <AgentRosterHints agent={agent} showShared={!agent.builtin} className="pointer-events-none ml-auto" />}
                      <DmUnreadBadge count={unreadDmCounts[dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`)]} />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  {groups.map(group => group.shown.at(-1)?.agentName === agent.agentName && group.all.length > group.shown.length ? <MoreAgents key={String(group.owned)} agents={group.all} moreOnline={group.moreOnline} owned={group.owned} onNavigate={onNavigate} /> : null)}
                    </Fragment>
                );
              })}
            {groups.filter(group => !group.shown.length && group.all.length).map(group => <MoreAgents key={String(group.owned)} agents={group.all} moreOnline={0} owned={group.owned} onNavigate={onNavigate} />)}
                </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <SidebarMembers showLabels onNavigate={onNavigate} />
    </>
  );
}
