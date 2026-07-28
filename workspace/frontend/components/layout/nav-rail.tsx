'use client';

import Image from 'next/image';
import {
  BookOpen, CalendarClock, FileText, Globe, Inbox, ListTodo, MessageSquare,
  PlusSquare, Sparkles,
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
 * The icon rail: the app-shell-4 first inner sidebar. It stays at
 * `--sidebar-width-icon` at all times — only the list panel next to it
 * collapses — so every entry is icon-only with a forced tooltip.
 */
export function NavRail() {
  const { viewMode, openView, setSelectedAgentName } = useLayout();
  const {
    workspace, agents, unreadSessionIds, unreadNotificationCount,
  } = useWorkspace();

  const recentAgents = agents.filter(isRecentAgent);
  const hasAgents = recentAgents.length > 0;

  const items: RailItem[] = [
    {
      mode: 'threads',
      label: 'Threads',
      icon: <MessageSquare />,
      unread: unreadSessionIds.size > 0,
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
      className="w-[calc(var(--sidebar-width-icon)+1px)]! border-e border-sidebar-border"
    >
      {/* Brand */}
      <SidebarHeader className="flex items-center justify-center py-3">
        <span
          className="relative flex size-8 shrink-0 items-center justify-center"
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
      </SidebarHeader>

      {/* View nav + agents */}
      <SidebarContent>
        <SidebarGroup className="px-1.5">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => (
                <SidebarMenuItem key={item.mode}>
                  <SidebarMenuButton
                    className="relative justify-center!"
                    aria-label={item.label}
                    tooltip={{ children: item.label, hidden: false }}
                    isActive={viewMode === item.mode}
                    onClick={() => openView(item.mode)}
                  >
                    {item.icon}
                    {item.unread && (
                      <span
                        className={cn(
                          'absolute top-0.5 right-0.5 size-1.5 rounded-full',
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
                        className="justify-center!"
                        aria-label={agent.agentName}
                        tooltip={{ children: agent.agentName, hidden: false }}
                        onClick={() => setSelectedAgentName(agent.agentName)}
                      >
                        <AgentAvatar
                          name={agent.agentName}
                          size={20}
                          status={agent.status}
                          showStatus
                          className="[&_svg]:size-full!"
                        />
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
                'justify-center!',
                !hasAgents &&
                  !isConnectActive &&
                  'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary',
              )}
              aria-label={hasAgents ? 'Connect Agent' : 'Connect Your First Agent'}
              tooltip={{
                children: hasAgents ? 'Connect Agent' : 'Connect Your First Agent',
                hidden: false,
              }}
              isActive={isConnectActive}
              onClick={() => openView('connect')}
            >
              <PlusSquare />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="px-1.5">
          <Separator />
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <SearchMenu iconOnly />
          <NotificationsMenu side="right" align="end" />
          <UserMenu side="right" align="end" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
