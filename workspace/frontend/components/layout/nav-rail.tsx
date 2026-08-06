'use client';

import * as React from 'react';
import Image from 'next/image';
import {
  BookOpen, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, FileText, Globe,
  Inbox, ListTodo, MessageSquare, PlusSquare, Sparkles, Users,
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
import { cn } from '@/lib/utils';
import { isRecentAgent } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import {
  useLayout,
  RAIL_WIDTH_COLLAPSED,
  RAIL_WIDTH_EXPANDED,
  type ViewMode,
} from './layout-context';
import { SearchMenu } from './search-menu';
import { NotificationsMenu } from './notifications-menu';
import { UserMenu } from './user-menu';

interface RailItem {
  mode: ViewMode;
  label: string;
  icon: React.ReactNode;
  /** Show an attention dot — unread threads, unread notifications */
  unread?: boolean;
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
    viewMode, openView, setSelectedAgentName, isRailExpanded, railDragWidth,
  } = useLayout();
  const {
    workspace, agents, sessions, unreadSessionIds, unreadNotificationCount,
    onlineUsers, currentUser,
  } = useWorkspace();
  const t = useT();
  const [agentsOpen, setAgentsOpen] = React.useState(true);

  const recentAgents = agents.filter(isRecentAgent);
  // Yumi (built-in) still appears in the roster, but does not satisfy the
  // "connect your first agent" call to action.
  const hasAgents = recentAgents.filter((a) => !a.builtin).length > 0;
  const onlineAgentCount = recentAgents.filter((a) => a.status === 'online').length;

  // Only threads the list actually shows may light the rail. Counting archived
  // and routine sessions too — as `unreadSessionIds` does on its own — leaves
  // the dot stuck on with nothing unread anywhere the user can see.
  const hasUnreadThreads = sessions.some(
    (s) =>
      s.status === 'active' &&
      !s.sessionId.startsWith('routine:') &&
      unreadSessionIds.has(s.sessionId),
  );

  const items: RailItem[] = [
    {
      mode: 'threads',
      label: t('views.threads'),
      icon: <MessageSquare />,
      unread: hasUnreadThreads,
    },
    ...(hasAgents
      ? ([
          { mode: 'files', label: t('views.files'), icon: <FileText /> },
          { mode: 'browser', label: t('views.browser'), icon: <Globe /> },
          { mode: 'routines', label: t('views.routines'), icon: <CalendarClock /> },
          { mode: 'knowledge', label: t('views.knowledge'), icon: <BookOpen /> },
          { mode: 'tasks', label: t('views.tasks'), icon: <ListTodo /> },
          {
            mode: 'inbox',
            label: t('views.inbox'),
            icon: <Inbox />,
            unread: unreadNotificationCount > 0,
          },
          { mode: 'skills', label: t('views.skills'), icon: <Sparkles /> },
        ] as RailItem[])
      : []),
  ];

  const isConnectActive = viewMode === 'connect';
  const connectLabel = hasAgents ? t('nav.connectAgent') : t('nav.connectFirstAgent');
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
            className="flex size-8 shrink-0 items-center justify-center"
            title={workspaceLabel}
          >
            <Image
              src="/logo-black.png"
              alt="OpenAgents"
              width={32}
              height={32}
              className="size-full object-contain dark:hidden"
            />
            <Image
              src="/logo-white.png"
              alt="OpenAgents"
              width={32}
              height={32}
              className="hidden size-full object-contain dark:block"
            />
          </span>

          {showLabels && (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
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
                    isActive={viewMode === item.mode}
                    onClick={() => openView(item.mode)}
                  >
                    {item.icon}
                    {showLabels && <span className="truncate">{item.label}</span>}
                    {item.unread && (
                      <span
                        className={cn(
                          'absolute size-1.5 rounded-full',
                          showLabels ? 'top-1/2 right-2 -translate-y-1/2' : 'top-0.5 right-0.5',
                          item.mode === 'inbox' ? 'bg-destructive' : 'bg-primary',
                        )}
                        aria-hidden="true"
                      />
                    )}
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
                    {t('nav.agentsWithCount', { online: onlineAgentCount, total: recentAgents.length })}
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
                  {recentAgents.map((agent) => (
                    <SidebarMenuItem key={agent.agentName}>
                      <SidebarMenuButton
                        className={cn(!showLabels && 'justify-center!')}
                        aria-label={agent.agentName}
                        tooltip={{ children: agent.agentName, hidden: showLabels }}
                        onClick={() => setSelectedAgentName(agent.agentName)}
                      >
                        <AgentAvatar
                          name={agent.agentName}
                          size={20}
                          status={agent.status}
                          showStatus
                          className="[&_svg]:size-full!"
                        />
                        {showLabels && <span className="truncate">{agent.agentName}</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}

        {/* Humans currently in the workspace. Collapsed there is no room for a
            name, so each becomes an initial chip carrying the name in its
            tooltip — the same trade the agent avatars make. */}
        {onlineUsers.length > 0 && (
          <>
            <div className="px-3">
              <Separator />
            </div>
            <SidebarGroup className="px-1.5">
              {showLabels && (
                <SidebarGroupLabel className="px-2">
                  <Users className="me-1 size-3" />
                  {t('nav.onlineWithCount', { count: onlineUsers.length })}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {onlineUsers.map((user) => {
                    const label =
                      user.id === currentUser.id ? t('nav.you', { name: user.name }) : user.name;

                    return (
                      <SidebarMenuItem key={user.id}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                'flex h-8 items-center gap-2 rounded-md text-sm',
                                showLabels ? 'px-2' : 'justify-center',
                              )}
                            >
                              {showLabels ? (
                                <>
                                  <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                                  <span className="min-w-0 truncate text-foreground">
                                    {label}
                                  </span>
                                </>
                              ) : (
                                <span className="relative flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase text-muted-foreground">
                                  {user.name.trim().charAt(0) || '?'}
                                  <span className="absolute -end-0.5 -bottom-0.5 size-1.5 rounded-full bg-emerald-500 ring-1 ring-sidebar" />
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" hidden={showLabels}>
                            {label}
                          </TooltipContent>
                        </Tooltip>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      {/* Connect agent + global tools */}
      <SidebarFooter className="gap-1 px-1.5 pb-3">
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(
                !showLabels && 'justify-center!',
                !hasAgents &&
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
            showLabels ? 'flex-row items-center px-1' : 'flex-col items-center',
          )}
        >
          <SearchMenu iconOnly />
          <NotificationsMenu side="right" align="end" />
          <UserMenu side="right" align="end" />
        </div>

      </SidebarFooter>

      <RailResizeHandle />
    </Sidebar>
  );
}
