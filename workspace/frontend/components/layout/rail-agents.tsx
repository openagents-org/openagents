'use client';
import * as React from 'react';
import { ChevronDown, Plus, Settings } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentRosterHints, isDeviceOffline } from '@/components/agents/agent-roster-hints';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useHumanNames } from '@/hooks/use-team-roster';
import { agentPresence } from '@/lib/approvals';
import { displayNameFromEmail } from '@/lib/collab';
import { dmSessionId, myAddress } from '@/lib/dm';
import { agentLabel } from '@/lib/helpers';
import { useT } from '@/lib/i18n';
import { isMySidebarAgent, isOwnedAgent, sidebarAgentGroups, sidebarAgents } from '@/lib/sidebar-agents';
import { cn, hasTruncatedLabel } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { AgentSectionLabel } from './agent-section-label';
import { DmUnreadBadge } from './dm-unread-badge';
import { useLayout } from './layout-context';
import { MoreAgents } from './more-agents';

/**
 * The rail's agents: avatars that stay on the rail, labelled or not, so
 * presence is always visible. One click opens the DM; the row's hover action
 * opens the agent's settings.
 */
export function RailAgents({ showLabels }: { showLabels: boolean }) {
  const { openView, openAddAgent, setSelectedAgentName, setThreadFilter, openMobileDetail } = useLayout();
  const {
    agents, pendingApprovalsByAgent, currentUser, setCurrentSessionId, unreadDmCounts, dmConversations,
  } = useWorkspace();
  const t = useT();
  const [agentsOpen, setAgentsOpen] = React.useState(true);
  // The agent row under the pointer whose name is cut off, if any: with
  // labels showing, only such a row repeats its name in a tooltip.
  const [truncatedAgent, setTruncatedAgent] = React.useState<string | null>(null);

  const recentAgents = sidebarAgents(agents, currentUser.id);
  const onlineAgents = recentAgents.filter((a) => a.status === 'online');
  const groups = sidebarAgentGroups(agents, currentUser.id, dmConversations);
  const visibleAgents = groups.flatMap(group => group.shown);
  const firstSharedIndex = visibleAgents.findIndex(agent => !isMySidebarAgent(agent, currentUser.id));
  const humanNames = useHumanNames();
  // Shared agents carry their owner's name, so they never pass for the viewer's own.
  const ownerName = (email: string | null | undefined) => email ? humanNames[email.toLowerCase()] || displayNameFromEmail(email) : '';

  if (recentAgents.length === 0) return null;
  return (
    <>
      <div className="px-3">
        <Separator />
      </div>
      {/* Collapsing the list only applies to the labelled rail — icon-only,
          keeping presence visible is the rail's whole job. */}
      <Collapsible open={!showLabels || agentsOpen} onOpenChange={setAgentsOpen} asChild>
      <SidebarGroup className="px-1.5">
        {/* Laid out as the Members header below: the fold chevron, then a
            "+" straight to the add-agent gallery. */}
        <div className={cn('flex items-center', !showLabels && 'justify-center')}>
          {showLabels && (
            <SidebarGroupLabel asChild className="min-w-0 flex-1 cursor-pointer px-2">
              <CollapsibleTrigger title={t('nav.agentsWithCount', { online: onlineAgents.length, total: recentAgents.length })}>
                <span className="truncate">{t('nav.agentsWithCount', { online: onlineAgents.length, total: recentAgents.length })}</span>
                <ChevronDown
                  className={cn(
                    'ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200',
                    !agentsOpen && '-rotate-90',
                  )}
                />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={t('nav.addAgent')}
            title={t('nav.addAgent')}
            onClick={openAddAgent}
          >
            <Plus />
          </Button>
        </div>
        <CollapsibleContent>
        <SidebarGroupContent id="rail-agent-list">
          <SidebarMenu className="gap-0.5">
            {visibleAgents.map((agent, index) => (
              <React.Fragment key={agent.agentName}>
                {(index === 0 || index === firstSharedIndex) && <AgentSectionLabel owned={index !== firstSharedIndex} online={groups[index === firstSharedIndex ? 1 : 0].all.length} total={groups[index === firstSharedIndex ? 1 : 0].total} first={index === 0} showLabels={showLabels} />}
              <SidebarMenuItem key={agent.agentName} className="group/agent">
                <SidebarMenuButton
                  className={cn(!showLabels && 'justify-center!', showLabels && 'group-hover/agent:pr-8 group-focus-within/agent:pr-8')}
                  aria-label={agentLabel(agent)}
                  // Collapsed, the tooltip is the only name there is. With
                  // labels, it shows only for a name cut off by the ellipsis,
                  // or to say what the device-offline marker means (it is the
                  // row's one hover hint; the marker no longer has its own).
                  tooltip={{
                    children: isDeviceOffline(agent) ? `${agentLabel(agent)} · ${t('collab.deviceOffline')}` : agentLabel(agent),
                    hidden: showLabels && truncatedAgent !== agent.agentName && !isDeviceOffline(agent),
                  }}
                  onPointerEnter={(e) => setTruncatedAgent(hasTruncatedLabel(e.currentTarget) ? agent.agentName : null)}
                  onClick={() => {
                    setSelectedAgentName(null);
                    setCurrentSessionId(dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`));
                    openView('threads');
                    setThreadFilter('all');
                    openMobileDetail();
                  }}
                >
                  <AgentAvatar
                    name={agent.agentName}
                    size={20}
                    status={agentPresence(agent.status, pendingApprovalsByAgent, agent.agentName)}
                    showStatus
                    className="[&_svg]:size-full!"
                  />
                  {showLabels && <span className="truncate" data-truncatable>{agentLabel(agent)}</span>}
                  {showLabels && !isMySidebarAgent(agent, currentUser.id) && agent.ownerEmail && <span className="ml-auto min-w-0 max-w-[45%] shrink truncate text-xs text-muted-foreground" title={t('collab.ownedBy', { owner: ownerName(agent.ownerEmail) })}>{ownerName(agent.ownerEmail)}</span>}
                  {/* v1.1 M1: Personal badge + "device offline" marker (labelled rail only) */}
                  {showLabels && isOwnedAgent(agent, currentUser.id) && <AgentRosterHints agent={agent} showShared={!agent.builtin} className="pointer-events-none ml-auto" />}
                  <DmUnreadBadge count={unreadDmCounts[dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`)]} compact={!showLabels} />
                </SidebarMenuButton>
                {/* Labelled rail only: collapsed, it landed on the avatar
                    and stacked its own hint on the row's. */}
                {showLabels && (
                  <SidebarMenuAction
                    showOnHover
                    className="[@media(hover:none)]:opacity-100"
                    title={t('nav.agentSettings', { name: agentLabel(agent) })}
                    aria-label={t('nav.agentSettings', { name: agentLabel(agent) })}
                    onClick={() => { setSelectedAgentName(agent.agentName); openMobileDetail(); }}
                  >
                    <Settings />
                  </SidebarMenuAction>
                )}
              </SidebarMenuItem>
              {groups.map(group => group.shown.at(-1)?.agentName === agent.agentName && group.all.length > group.shown.length ? <MoreAgents key={String(group.owned)} agents={group.all} moreOnline={group.moreOnline} owned={group.owned} showLabels={showLabels} /> : null)}
              </React.Fragment>
            ))}
            {groups.filter(group => !group.shown.length && group.all.length).map(group => <MoreAgents key={String(group.owned)} agents={group.all} moreOnline={0} owned={group.owned} showLabels={showLabels} />)}
          </SidebarMenu>
        </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
      </Collapsible>
    </>
  );
}
