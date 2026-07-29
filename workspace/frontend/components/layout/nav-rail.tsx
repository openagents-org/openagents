'use client';

import Image from 'next/image';
import {
  BookOpen, CalendarClock, FileText, Globe, Inbox, ListTodo, MessageSquare,
  PanelLeftClose, PanelLeftOpen, PlusSquare, Sparkles,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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
import { useLayout, type ViewMode } from './layout-context';
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

/**
 * The icon rail: the app-shell-4 first inner sidebar. It always fills
 * `--sidebar-width-icon`, and that width follows the rail's own expanded state
 * — collapsed it is icon-only with forced tooltips, expanded it shows labels.
 */
export function NavRail() {
  const {
    viewMode, openView, setSelectedAgentName, isRailExpanded, toggleRail,
  } = useLayout();
  const {
    workspace, agents, sessions, unreadSessionIds, unreadNotificationCount,
  } = useWorkspace();

  const recentAgents = agents.filter(isRecentAgent);
  const hasAgents = recentAgents.length > 0;

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
      label: 'Threads',
      icon: <MessageSquare />,
      unread: hasUnreadThreads,
    },
    ...(hasAgents
      ? ([
          { mode: 'files', label: 'Files', icon: <FileText /> },
          { mode: 'browser', label: 'Browser', icon: <Globe /> },
          { mode: 'routines', label: 'Routines', icon: <CalendarClock /> },
          { mode: 'knowledge', label: 'Knowledge', icon: <BookOpen /> },
          { mode: 'tasks', label: 'Tasks', icon: <ListTodo /> },
          {
            mode: 'inbox',
            label: 'Inbox',
            icon: <Inbox />,
            unread: unreadNotificationCount > 0,
          },
          { mode: 'skills', label: 'Skill Hub', icon: <Sparkles /> },
        ] as RailItem[])
      : []),
  ];

  const isConnectActive = viewMode === 'connect';

  return (
    <Sidebar
      collapsible="none"
      className="w-[calc(var(--sidebar-width-icon)+1px)]! shrink-0 border-e border-sidebar-border transition-[width] duration-200 ease-linear"
    >
      {/* Brand — doubles as the rail's expand/collapse control */}
      <SidebarHeader className="py-3">
        <div
          className={cn(
            'group/brand relative flex items-center',
            isRailExpanded ? 'w-full gap-2 px-1' : 'justify-center',
          )}
        >
          <span
            className={cn(
              'relative flex size-8 shrink-0 items-center justify-center transition-opacity',
              !isRailExpanded && 'group-hover/brand:opacity-0',
            )}
            title={workspace?.name || 'Workspace'}
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

          {isRailExpanded && (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {workspace?.name || 'Workspace'}
            </span>
          )}

          {/* Collapsed, the control hides behind the logo until hover, so the
              rail stays a clean strip of icons. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleRail}
                aria-label={isRailExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                  isRailExpanded
                    ? 'ml-auto'
                    : 'absolute inset-0 m-auto opacity-0 group-hover/brand:opacity-100',
                )}
              >
                {isRailExpanded ? (
                  <PanelLeftClose className="size-4" />
                ) : (
                  <PanelLeftOpen className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isRailExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            </TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>

      {/* View nav + agents */}
      <SidebarContent>
        <SidebarGroup className="px-1.5">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => (
                <SidebarMenuItem key={item.mode}>
                  <SidebarMenuButton
                    className={cn('relative', !isRailExpanded && 'justify-center!')}
                    aria-label={item.label}
                    tooltip={{ children: item.label, hidden: isRailExpanded }}
                    isActive={viewMode === item.mode}
                    onClick={() => openView(item.mode)}
                  >
                    {item.icon}
                    {isRailExpanded && <span className="truncate">{item.label}</span>}
                    {item.unread && (
                      <span
                        className={cn(
                          'absolute size-1.5 rounded-full',
                          isRailExpanded ? 'top-1/2 right-2 -translate-y-1/2' : 'top-0.5 right-0.5',
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
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {recentAgents.map((agent) => (
                    <SidebarMenuItem key={agent.agentName}>
                      <SidebarMenuButton
                        className={cn(!isRailExpanded && 'justify-center!')}
                        aria-label={agent.agentName}
                        tooltip={{ children: agent.agentName, hidden: isRailExpanded }}
                        onClick={() => setSelectedAgentName(agent.agentName)}
                      >
                        <AgentAvatar
                          name={agent.agentName}
                          size={20}
                          status={agent.status}
                          showStatus
                          className="[&_svg]:size-full!"
                        />
                        {isRailExpanded && <span className="truncate">{agent.agentName}</span>}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
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
                !isRailExpanded && 'justify-center!',
                !hasAgents &&
                  !isConnectActive &&
                  'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary',
              )}
              aria-label={hasAgents ? 'Connect Agent' : 'Connect Your First Agent'}
              tooltip={{
                children: hasAgents ? 'Connect Agent' : 'Connect Your First Agent',
                hidden: isRailExpanded,
              }}
              isActive={isConnectActive}
              onClick={() => openView('connect')}
            >
              <PlusSquare />
              {isRailExpanded && (
                <span className="truncate">
                  {hasAgents ? 'Connect Agent' : 'Connect Your First Agent'}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="px-1.5">
          <Separator />
        </div>

        <div
          className={cn(
            'flex gap-0.5',
            isRailExpanded ? 'flex-row items-center px-1' : 'flex-col items-center',
          )}
        >
          <SearchMenu iconOnly />
          <NotificationsMenu side="right" align="end" />
          <UserMenu side="right" align="end" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
