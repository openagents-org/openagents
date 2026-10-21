'use client';
import { FirstDeviceHint, SETUP_STEP_BUTTON } from './first-device-hint';
import { useFirstDeviceGuide } from '@/hooks/use-first-device-guide';
import { MoreAgents } from './more-agents';
import { DmUnreadBadge } from './dm-unread-badge';

import * as React from 'react';
import { desktopHost } from '@/lib/desktop-host';
import Image from 'next/image';
import {
  BookOpen, Bot, CircleDot, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, FileText, Globe,
  Inbox, KanbanSquare, MessageSquare, Monitor, Settings, PlusSquare, Sparkles, Users, Waypoints,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentRosterHints } from '@/components/agents/agent-roster-hints'; // v1.1 M1
import { cn } from '@/lib/utils';
import { agentLabel } from '@/lib/helpers';
import { sidebarAgents, isOwnedAgent, isMySidebarAgent, sidebarAgentGroups } from '@/lib/sidebar-agents';
import { agentPresence } from '@/lib/approvals';
import { useWorkspace } from '@/lib/workspace-context';
import { dmSessionId, myAddress } from '@/lib/dm';
import { useT } from '@/lib/i18n';
import {
  useLayout,
  RAIL_WIDTH_COLLAPSED,
  RAIL_WIDTH_EXPANDED,
  type ViewMode,
} from './layout-context';
import { SearchMenu } from './search-menu';
import { NotificationsMenu } from './notifications-menu';
import { InviteMemberButton } from './invite-member-button';
import { UserMenu } from './user-menu';
import { SidebarMembers } from './sidebar-members';
import { CampaignSidebarCard } from '@/components/campaign/campaign-sidebar-card';

interface RailItem {
  mode: ViewMode;
  label: string;
  icon: React.ReactNode;
  /** Show an attention dot — unread threads, unread notifications */
  count?: number;
}

const RAIL_SNAP_POINT = (RAIL_WIDTH_COLLAPSED + RAIL_WIDTH_EXPANDED) / 2;

function clampRailWidth(width: number) {
  return Math.min(RAIL_WIDTH_EXPANDED, Math.max(RAIL_WIDTH_COLLAPSED, width));
}

/**
 * The rail's trailing seam: a drag strip riding the border line, with a round
 * toggle button floating over it at mid-height — the DingTalk treatment. Both
 * gestures land on the same two states.
 *
 * Dragging is Lark-style: the rail follows the pointer, then snaps to whichever
 * state the release landed nearest; a drag that never really moved counts as a
 * click and just toggles. The strip is `fixed` rather than absolute because the
 * sidebar shell clips its overflow, and the control straddles the seam.
 */
function RailResizeHandle() {
  const {
    isRailExpanded, toggleRail, setRailExpanded, railDragWidth, setRailDragWidth,
  } = useLayout();
  const t = useT();
  const dragRef = React.useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null);
  const isDragging = railDragWidth !== null;
  const toggleLabel = isRailExpanded ? t('nav.collapseSidebar') : t('nav.expandSidebar');

  // While dragging, the resize cursor has to win everywhere — the pointer
  // leaves the handle long before the rail stops following it.
  React.useEffect(() => {
    if (!isDragging) return;
    const { style } = document.body;
    const prevCursor = style.cursor;
    const prevSelect = style.userSelect;
    style.cursor = 'col-resize';
    style.userSelect = 'none';
    return () => {
      style.cursor = prevCursor;
      style.userSelect = prevSelect;
    };
  }, [isDragging]);

  const startWidth = () => (isRailExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: startWidth(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setRailDragWidth(startWidth());
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 3) drag.moved = true;
    setRailDragWidth(clampRailWidth(drag.startWidth + dx));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setRailDragWidth(null);
    if (!drag.moved) {
      toggleRail();
      return;
    }
    setRailExpanded(clampRailWidth(drag.startWidth + (e.clientX - drag.startX)) >= RAIL_SNAP_POINT);
  };

  const handlePointerCancel = () => {
    dragRef.current = null;
    setRailDragWidth(null);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={isRailExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED}
      aria-valuemin={RAIL_WIDTH_COLLAPSED}
      aria-valuemax={RAIL_WIDTH_EXPANDED}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={toggleRail}
      style={{ left: 'var(--sidebar-width-icon)' }}
      className={cn(
        'group/seam fixed inset-y-0 z-30 w-3 -translate-x-1/2 cursor-col-resize touch-none select-none',
        railDragWidth === null && 'transition-[left] duration-200 ease-linear',
      )}
    >
      {/* The seam lights up while it is hovered or being dragged */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary/50 opacity-0 transition-opacity',
          'group-hover/seam:opacity-100',
          isDragging && 'opacity-100',
        )}
      />

      {/* Mid-height toggle, floating over the border line */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={toggleLabel}
            aria-expanded={isRailExpanded}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={toggleRail}
            className={cn(
              'absolute top-1/2 left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center',
              'rounded-full border border-border bg-background text-muted-foreground shadow-xs',
              'opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              'group-hover/seam:opacity-100',
              isDragging && 'opacity-0',
            )}
          >
            {isRailExpanded ? (
              <ChevronLeft className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{toggleLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * The icon rail: the app-shell-4 first inner sidebar. It always fills
 * `--sidebar-width-icon`, and that width follows the rail's own expanded state
 * — collapsed it is icon-only with forced tooltips, expanded it shows labels.
 */
export function NavRail() {
  const {
    viewMode, openView, setSelectedAgentName, isRailExpanded, railDragWidth, setThreadFilter, openMobileDetail,
  } = useLayout();
  const {
    workspace, agents, unreadThreadsTotal, unreadNotificationCount, pendingApprovalsByAgent,
    onlineUsers, currentUser, tasks, setCurrentSessionId, unreadDmCounts, dmConversations,
  } = useWorkspace();
  const t = useT();
  const [agentsOpen, setAgentsOpen] = React.useState(true);

  const recentAgents = sidebarAgents(agents, currentUser.id);
  // Yumi (built-in) still appears in the roster, but does not satisfy the
  // "connect your first agent" call to action.
  const hasAgents = recentAgents.filter((a) => !a.builtin).length > 0;
  const onlineAgents = recentAgents.filter((a) => a.status === 'online');
  const groups = sidebarAgentGroups(agents, currentUser.id, dmConversations);
  const visibleAgents = groups.flatMap(group => group.shown);
  const firstSharedIndex = visibleAgents.findIndex(agent => !isMySidebarAgent(agent, currentUser.id));

  // Unread threads, @mentions and DMs — only what the Threads view lists.


  const items: RailItem[] = [
    {
      mode: 'threads',
      label: t('views.threads'),
      icon: <MessageSquare />,
      count: unreadThreadsTotal,
    },
    { mode: 'issues', label: t('views.issues'), icon: <CircleDot />, count: tasks.filter(task => task.status === 'need_input').length },
    { mode: 'files', label: t('views.files'), icon: <FileText /> },
    { mode: 'browser', label: t('views.browser'), icon: <Globe /> },
    { mode: 'routines', label: t('views.routines'), icon: <CalendarClock /> },
    { mode: 'knowledge', label: t('views.knowledge'), icon: <BookOpen /> },

    {
      mode: 'inbox',
      label: t('views.inbox'),
      icon: <Inbox />,
      count: unreadNotificationCount,
    },
    { mode: 'skills', label: t('views.skills'), icon: <Sparkles /> },
    { mode: 'workflows', label: t('views.workflows'), icon: <Waypoints /> },
    // v1.1 M2: team specialists directory
    { mode: 'agents', label: t('collab.viewAgents'), icon: <Bot /> },
  ];

  const isConnectActive = viewMode === 'connect';
  const setupStep = useFirstDeviceGuide();
  const showFirstDeviceHint = !!setupStep && !isConnectActive;
  const connectLabel = setupStep === 'device' ? t('nav.connectFirstDevice') : hasAgents ? t('nav.connectAgent') : t('nav.connectFirstAgent');
  const workspaceLabel = workspace?.name || t('nav.workspaceFallback');

  // Mid-drag the rail previews the state it would snap to, so labels appear
  // and disappear under the pointer instead of only after the release.
  const showLabels =
    railDragWidth !== null ? railDragWidth >= RAIL_SNAP_POINT : isRailExpanded;

  return (
    /* The trailing border uses `border-border`, the same seam the list panel
       draws on its own trailing edge — `border-sidebar-border` is transparent
       in this theme, which left the rail bleeding into the list. */
    <Sidebar
      collapsible="none"
      className={cn(
        'relative w-[calc(var(--sidebar-width-icon)+1px)]! shrink-0 border-e border-border',
        // No easing mid-drag: the width has to track the pointer exactly.
        railDragWidth === null && 'transition-[width] duration-200 ease-linear',
      )}
    >
      {/* Brand. The expand/collapse control lives in the footer now — a fixed
          bottom-left button, plus the draggable seam on the trailing edge. */}
      <SidebarHeader className="py-3">
        <div
          className={cn(
            'flex items-center',
            showLabels ? 'w-full gap-2 px-1' : 'justify-center',
          )}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center overflow-hidden"
            title={workspaceLabel}
          >
            <Image
              src="/logo-black.png"
              alt=""
              width={32}
              height={32}
              className="size-full object-contain dark:hidden"
            />
            <Image
              src="/logo-white.png"
              alt=""
              width={32}
              height={32}
              className="hidden size-full object-contain dark:block"
            />
          </span>

          {showLabels && (
            <span
              className="min-w-0 flex-1 truncate text-sm font-semibold"
              aria-label={workspaceLabel}
              onMouseEnter={(event) => {
                const label = event.currentTarget;
                // Keep short names quiet. The native tooltip is added only
                // when the ellipsis is actually hiding part of the name.
                if (label.scrollWidth > label.clientWidth) {
                  label.title = workspaceLabel;
                } else {
                  label.removeAttribute('title');
                }
              }}
            >
              {workspaceLabel}
            </span>
          )}
        </div>
      </SidebarHeader>

      {/* View nav + agents */}
      <SidebarContent>
        <SidebarGroup className="px-1.5">
          {/* Group labels only make sense once there is room for them — the
              collapsed rail is icon-only, and a 52px column has nowhere to put
              a caption. */}
          {showLabels && <SidebarGroupLabel className="px-2">{t('nav.collaboration')}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => (
                <SidebarMenuItem key={item.mode}>
                  <SidebarMenuButton
                    className={cn('relative', !showLabels && 'justify-center!')}
                    aria-label={item.label}
                    tooltip={{ children: item.label, hidden: showLabels }}
                    isActive={viewMode === item.mode || (viewMode === 'tasks' && item.mode === 'issues')}
                    onClick={() => { if (item.mode === 'threads') setThreadFilter('all'); openView(item.mode); }}
                  >
                    {item.icon}
                    {showLabels && <span className="truncate">{item.label}</span>}
                    {!!item.count && <span className={cn('shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums', showLabels ? 'ml-auto' : 'absolute -right-1 -top-1', (item.mode === 'inbox' || item.mode === 'threads') ? 'bg-destructive text-white' : 'bg-muted text-foreground')} aria-label={t('nav.unreadCount', { count: item.count })}>{item.count > 99 ? '99+' : item.count}</span>}

                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Agents — avatars stay on the rail so presence is always visible */}
        {recentAgents.length > 0 && (
          <>
            <div className="px-3">
              <Separator />
            </div>
            <SidebarGroup className="px-1.5">
              {showLabels && (
                <SidebarGroupLabel
                  asChild
                  className="cursor-pointer px-2 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
                >
                  <button
                    type="button"
                    onClick={() => setAgentsOpen((prev) => !prev)}
                    aria-expanded={agentsOpen}
                    aria-controls="rail-agent-list"
                  >
                    {t('nav.agentsWithCount', { online: onlineAgents.length, total: recentAgents.length })}
                    <ChevronDown
                      className={cn(
                        'ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200',
                        !agentsOpen && '-rotate-90',
                      )}
                    />
                  </button>
                </SidebarGroupLabel>
              )}
              {/* Collapsing the group only applies to the expanded rail —
                  icon-only, keeping presence visible is the rail's whole job,
                  so the avatars stay. */}
              <SidebarGroupContent
                id="rail-agent-list"
                className={cn(showLabels && !agentsOpen && 'hidden')}
              >
                <SidebarMenu className="gap-0.5">
                  {visibleAgents.map((agent, index) => (
                    <React.Fragment key={agent.agentName}>
                      {index === firstSharedIndex && <li role="separator" aria-label={t('collab.sharedByOthers')} className="mx-2 flex items-center gap-2">
                        <span className="h-px min-w-0 flex-1 bg-sidebar-border" />
                        {showLabels && <span className="shrink-0 text-center text-[10px] leading-5 text-muted-foreground">{t('collab.sharedByOthers')}</span>}
                        <span className="h-px min-w-0 flex-1 bg-sidebar-border" />
                      </li>}
                    <SidebarMenuItem key={agent.agentName} className="group/agent">
                      <SidebarMenuButton
                        className={cn(!showLabels && 'justify-center!', showLabels && 'group-hover/agent:pr-8 group-focus-within/agent:pr-8')}
                        aria-label={agentLabel(agent)}
                        tooltip={{ children: agentLabel(agent), hidden: showLabels }}
                        onClick={() => {
                          setSelectedAgentName(null);
                          setCurrentSessionId(dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`));
                          openView('threads');
                          setThreadFilter('dms');
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
                        {showLabels && <span className="truncate">{agentLabel(agent)}</span>}
                        {/* v1.1 M1: Personal badge + "device offline" marker (labelled rail only) */}
                        {showLabels && isOwnedAgent(agent, currentUser.id) && <AgentRosterHints agent={agent} showShared={!agent.builtin} className="ml-auto" />}
                        <DmUnreadBadge count={unreadDmCounts[dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`)]} compact={!showLabels} />
                      </SidebarMenuButton>
                      <button type="button" className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-sidebar text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground group-hover/agent:opacity-100 group-focus-within/agent:opacity-100 [@media(hover:none)]:opacity-100" title={t('nav.agentSettings', { name: agentLabel(agent) })} aria-label={t('nav.agentSettings', { name: agentLabel(agent) })} onClick={() => { setSelectedAgentName(agent.agentName); openMobileDetail(); }}><Settings className="size-3.5" /></button>
                    </SidebarMenuItem>
                    {groups.map(group => group.shown.at(-1)?.agentName === agent.agentName && group.all.length > group.shown.length ? <MoreAgents key={String(group.owned)} agents={group.all} moreOnline={group.moreOnline} owned={group.owned} showLabels={showLabels} /> : null)}
                    </React.Fragment>
                  ))}
                  {groups.filter(group => !group.shown.length && group.all.length).map(group => <MoreAgents key={String(group.owned)} agents={group.all} moreOnline={0} owned={group.owned} showLabels={showLabels} />)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        <SidebarMembers showLabels={showLabels} />
      </SidebarContent>

      {/* Connect agent + global tools */}
      <SidebarFooter className="gap-1 px-1.5 pb-3">
        {desktopHost() && (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className={cn(!showLabels && 'justify-center!')}
                aria-label={t('nav.localManagement')}
                tooltip={{ children: t('nav.localManagement'), hidden: showLabels }}
                onClick={() => desktopHost()?.openComputer()}
              >
                <Monitor />
                {/* Named like the launcher's own switch to it, so the two read
                    as one place. Connecting this computer lives under Connect. */}
                {showLabels && <span>{t('nav.localManagement')}</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {/* Credits-campaign progress (expanded rail only; self-hides when the
            campaign is off or complete). */}
        {showLabels && <CampaignSidebarCard />}
        {showFirstDeviceHint && setupStep && <FirstDeviceHint step={setupStep} compact={!showLabels} />}
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(
                !showLabels && 'justify-center!',
                showFirstDeviceHint && SETUP_STEP_BUTTON,
                !hasAgents && !showFirstDeviceHint &&
                  !isConnectActive &&
                  'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary',
              )}
              aria-label={connectLabel}
              tooltip={{ children: connectLabel, hidden: showLabels }}
              isActive={isConnectActive}
              onClick={() => openView('connect')}
            >
              <PlusSquare />
              {showLabels && <span className="truncate">{connectLabel}</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="px-1.5">
          <Separator />
        </div>

        <div
          className={cn(
            'flex gap-0.5',
            showLabels ? 'flex-row items-center justify-evenly px-1' : 'flex-col items-center',
          )}
        >
          <SearchMenu iconOnly />
          <NotificationsMenu side="right" align="end" />
          <InviteMemberButton />
          <UserMenu side="right" align="end" />
        </div>

      </SidebarFooter>

      <RailResizeHandle />
    </Sidebar>
  );
}
