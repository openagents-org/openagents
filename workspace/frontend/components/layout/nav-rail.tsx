'use client';
import { useOnboardingSurface, useDismissOnboarding } from './onboarding-surface';
import { FirstDeviceHint } from './first-device-hint';
import { ConnectAgentButton } from './connect-agent-button';
import { useFirstDeviceGuide } from '@/hooks/use-first-device-guide';
import * as React from 'react';
import Image from 'next/image';
import {
BookOpen,Bot,CircleDot,CalendarClock,FileText,Globe,
Inbox,Mail,MessageSquare,Sparkles,Waypoints
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
import { Button } from '@/components/ui/button';
 // v1.1 M1
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { unreadIssueCounts } from '@/lib/signals';
import { useT } from '@/lib/i18n';
import {
useLayout,type ViewMode
} from './layout-context';
import { SearchMenu } from './search-menu';
import { UserMenu } from './user-menu';
import { SidebarMembers } from './sidebar-members';
import { RailEdge } from './rail-edge';
import { RailAgents } from './rail-agents';

interface RailItem {
  mode: ViewMode;
  label: string;
  icon: React.ReactNode;
  /** Show an attention dot — unread threads, unread notifications */
  count?: number;
  /** Render the count in red (something needs the user). */
  urgent?: boolean;
}

/**
 * The icon rail: the app-shell-4 first inner sidebar. It always fills
 * `--sidebar-width-icon`, and that width follows the rail's own expanded state
 * — collapsed it is icon-only with forced tooltips, expanded it shows labels.
 */
export function NavRail() {
  const {
    viewMode, railViewMode, openView, setSelectedAgentName, isRailExpanded, setThreadFilter, openMobileDetail,
  } = useLayout();
  const {
    workspace, agents, unreadThreadsTotal, unreadNotificationCount, pendingApprovalsByAgent,
    onlineUsers, currentUser, setCurrentSessionId, unreadDmCounts, dmConversations, unreadSignals,
  } = useWorkspace();
  const unreadIssues = Object.values(unreadIssueCounts(unreadSignals)).reduce((sum, n) => sum + n, 0);
  const t = useT();

  // Yumi (built-in) still appears in the roster, but does not satisfy the
  // "connect your first agent" call to action.
  const hasConnectedAgents = agents.some((a) => !a.builtin);

  // Unread threads, @mentions and DMs — only what the Threads view lists.

  const items: RailItem[] = [
    {
      mode: 'threads',
      label: t('views.threads'),
      icon: <MessageSquare />,
      count: unreadThreadsTotal,
    },
    {
      mode: 'issues',
      label: t('views.issues'),
      icon: <CircleDot />,
      count: unreadIssues,
      urgent: true,
    },
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

  const onboarding = useOnboardingSurface();
  const dismissOnboarding = useDismissOnboarding();
  const isConnectActive = onboarding || viewMode === 'connect';
  const setupStep = useFirstDeviceGuide();
  const showFirstDeviceHint = !!setupStep && !isConnectActive;
  const connectLabel = hasConnectedAgents ? t('nav.manageAgents') : t('nav.connectAgent');
  const workspaceLabel = workspace?.name || t('nav.workspaceFallback');

  const showLabels = isRailExpanded;
  // Expanded, Inbox is the envelope beside Manage Agents (shadcn dashboard-01's
  // Quick Create row); collapsed there is no room beside it, so it stays a
  // regular rail item.
  const navItems = showLabels ? items.filter((item) => item.mode !== 'inbox') : items;
  const inboxActive = !onboarding && railViewMode === 'inbox';

  return (
    /* No trailing border: the list and detail panes beside the rail form an
       inset card with its own edge (see Wrapper). The extra pixel of width is
       the gap that border used to fill, kept so the shell's width math holds. */
    <Sidebar
      collapsible="none"
      className={cn(
        'relative w-[calc(var(--sidebar-width-icon)+1px)]! shrink-0',
        'transition-[width] duration-200 ease-linear',
      )}
    >
      {/* Brand, sized as shadcn dashboard-01's: a 20px mark and the name in
          text-base. Expanding and collapsing is the trailing edge's job
          (RailEdge) and Cmd/Ctrl+B. */}
      <SidebarHeader className="px-1.5 pt-3 pb-0">
        <div
          className={cn(
            'flex h-8 items-center',
            showLabels ? 'w-full gap-2 p-1.5' : 'justify-center',
          )}
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center overflow-hidden"
            title={workspaceLabel}
          >
            <Image
              src="/logo-black.png"
              alt=""
              width={20}
              height={20}
              className="size-full object-contain dark:hidden"
            />
            <Image
              src="/logo-white.png"
              alt=""
              width={20}
              height={20}
              className="hidden size-full object-contain dark:block"
            />
          </span>

          {showLabels && (
            <span
              className="min-w-0 flex-1 truncate text-base font-semibold"
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
        {/* The primary action, as dashboard-01's Quick Create row: Manage
            Agents, with Inbox beside it while there is room. */}
        <SidebarGroup className="px-1.5 pb-0">
          {showFirstDeviceHint && setupStep && <FirstDeviceHint step={setupStep} compact={!showLabels} />}
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-2">
              <ConnectAgentButton
                label={connectLabel}
                active={isConnectActive}
                showLabels={showLabels}
                onClick={() => openView('connect')}
              />
              {showLabels && (
                <Button
                  variant="outline"
                  size="icon"
                  className="relative size-8 shrink-0"
                  aria-label={t('views.inbox')}
                  aria-current={inboxActive ? 'page' : undefined}
                  title={t('views.inbox')}
                  onClick={() => openView('inbox')}
                >
                  <Mail />
                  <span className="sr-only">{t('views.inbox')}</span>
                  {unreadNotificationCount > 0 && (
                    <span
                      className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs font-medium text-white tabular-nums"
                      aria-label={t('nav.unreadCount', { count: unreadNotificationCount })}
                    >
                      {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                    </span>
                  )}
                </Button>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="px-1.5">
          {/* Group labels only make sense once there is room for them — the
              collapsed rail is icon-only, and a 52px column has nowhere to put
              a caption. */}
          {showLabels && <SidebarGroupLabel className="px-2">{t('nav.collaboration')}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.filter((item) => item.mode !== 'agents' || workspace?.settings?.services_enabled === true).map((item) => (
                <SidebarMenuItem key={item.mode}>
                  <SidebarMenuButton
                    className={cn('relative', !showLabels && 'justify-center!')}
                    aria-label={item.label}
                    tooltip={{ children: item.label, hidden: showLabels }}
                    isActive={!onboarding && railViewMode === item.mode}
                    onClick={() => { if (item.mode === 'threads') { if (onboarding) dismissOnboarding?.(); setThreadFilter('all'); } openView(item.mode); }}
                  >
                    {item.icon}
                    {showLabels && <span className="truncate">{item.label}</span>}
                    {/* Collapsed, the badge sits inside the button's corner: the button
                        (and the scrolling rail) clip overflow, so a negative
                        offset cut it in half. */}
                    {!!item.count && <span className={cn('flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums', showLabels ? 'ml-auto' : 'absolute right-0 top-0', (item.urgent || item.mode === 'inbox' || item.mode === 'threads') ? 'bg-destructive text-white' : 'bg-muted text-foreground')} aria-label={t('nav.unreadCount', { count: item.count })}>{item.count > 99 ? '99+' : item.count}</span>}

                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <RailAgents showLabels={showLabels} />

        <SidebarMembers showLabels={showLabels} />
      </SidebarContent>

      {/* Global tools. No bell or invite here: Inbox already sits beside
          Manage Agents (or on the collapsed rail), and inviting is the
          Members header's "+". */}
      <SidebarFooter className="gap-1 px-1.5 pb-3">
        <div
          className={cn(
            'flex gap-0.5',
            showLabels ? 'flex-row items-center justify-between px-1' : 'flex-col items-center',
          )}
        >
          <SearchMenu iconOnly />
          <UserMenu side="right" align="end" />
        </div>

      </SidebarFooter>

      <RailEdge />
    </Sidebar>
  );
}
