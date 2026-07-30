'use client';

import {
  BookOpen, CalendarClock, FileText, Globe, Inbox, ListTodo, MessageSquare, Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useWorkspace } from '@/lib/workspace-context';
import { isRecentAgent } from '@/lib/helpers';
import { useLayout, type ViewMode } from './layout-context';

interface NavItem {
  mode: ViewMode;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

/** `onNavigate` lets the mobile drawer close itself once a view is picked. */
export function NavMain({ onNavigate }: { onNavigate?: () => void }) {
  const { viewMode, openView } = useLayout();
  const { agents, sessions, files, browserTabs, todos, routines, knowledge, unreadNotificationCount } = useWorkspace();

  const hasAgents = agents.filter(isRecentAgent).length > 0;

  const items: NavItem[] = [
    {
      mode: 'threads',
      label: 'Threads',
      icon: <MessageSquare />,
      count: sessions.filter((s) => !s.sessionId.startsWith('routine:')).length,
    },
    ...(hasAgents
      ? ([
          { mode: 'files', label: 'Files', icon: <FileText />, count: files.length },
          { mode: 'browser', label: 'Browser', icon: <Globe />, count: browserTabs.length },
          {
            mode: 'routines',
            label: 'Routines',
            icon: <CalendarClock />,
            count: routines.filter((r) => r.status === 'active').length,
          },
          { mode: 'knowledge', label: 'Knowledge', icon: <BookOpen />, count: knowledge.length },
          {
            mode: 'tasks',
            label: 'Tasks',
            icon: <ListTodo />,
            count: todos.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
          },
          {
            mode: 'inbox',
            label: 'Inbox',
            icon: <Inbox />,
            count: unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
          },
          { mode: 'skills', label: 'Skill Hub', icon: <Sparkles /> },
        ] as NavItem[])
      : []),
  ];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Collaboration</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.25">
          {items.map((item) => (
            <SidebarMenuItem key={item.mode}>
              <SidebarMenuButton
                tooltip={item.label}
                isActive={viewMode === item.mode}
                onClick={() => {
                  openView(item.mode);
                  onNavigate?.();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </SidebarMenuButton>
              {item.count !== undefined && item.count > 0 && (
                <SidebarMenuBadge className="group-data-[collapsible=icon]:hidden">
                  <Badge
                    variant={item.mode === 'inbox' ? 'destructive' : 'secondary'}
                    appearance="light"
                    size="sm"
                    shape="circle"
                    className="min-w-5 justify-center px-1.5 tabular-nums"
                  >
                    {item.count}
                  </Badge>
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
