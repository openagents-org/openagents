'use client';

import {
  BookOpen, CalendarClock, FileText, Globe, Inbox, KanbanSquare, MessageSquare, Sparkles,
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
import { countFiles } from '@/components/files/file-utils';
import { useT } from '@/lib/i18n';
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
  const { agents, sessions, files, browserTabs, tasks, routines, knowledge, unreadNotificationCount } = useWorkspace();
  const t = useT();

  const hasAgents = agents.filter((a) => isRecentAgent(a) && !a.builtin).length > 0;

  const items: NavItem[] = [
    {
      mode: 'threads',
      label: t('views.threads'),
      icon: <MessageSquare />,
      count: sessions.filter((s) => !s.sessionId.startsWith('routine:') && !s.sessionId.startsWith('task:')).length,
    },
    ...(hasAgents
      ? ([
          { mode: 'files', label: t('views.files'), icon: <FileText />, count: countFiles(files) },
          { mode: 'browser', label: t('views.browser'), icon: <Globe />, count: browserTabs.length },
          {
            mode: 'routines',
            label: t('views.routines'),
            icon: <CalendarClock />,
            count: routines.filter((r) => r.status === 'active').length,
          },
          { mode: 'knowledge', label: t('views.knowledge'), icon: <BookOpen />, count: knowledge.length },
          {
            mode: 'tasks',
            label: t('views.tasks'),
            icon: <KanbanSquare />,
            count: tasks.filter((task) => task.status !== 'done').length,
          },
          {
            mode: 'inbox',
            label: t('views.inbox'),
            icon: <Inbox />,
            count: unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
          },
          { mode: 'skills', label: t('views.skills'), icon: <Sparkles /> },
        ] as NavItem[])
      : []),
  ];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('nav.collaboration')}</SidebarGroupLabel>
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
