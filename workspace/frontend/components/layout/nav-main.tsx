'use client';

import { isRoutineSession, isIssueWorkSession } from '@/lib/conversation-list';

import {
  BookOpen, Bot, CircleDot, CalendarClock, FileText, Globe, Inbox, MessageSquare, Sparkles, Waypoints,
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
  /** Render the count as a red attention badge (something needs the user). */
  urgent?: boolean;
  /** Attention dot beside the label (unread threads, mentions, DMs). */
  unread?: boolean;
}

/** `onNavigate` lets the mobile drawer close itself once a view is picked. */
export function NavMain({ onNavigate }: { onNavigate?: () => void }) {
  const { viewMode, openView, setThreadFilter } = useLayout();
  const { agents, sessions, files, browserTabs, tasks, workflows, routines, knowledge, unreadNotificationCount, unreadThreadsTotal } = useWorkspace();
  const t = useT();

  const hasAgents = agents.filter((a) => isRecentAgent(a) && !a.builtin).length > 0;
  // Fresh workspace (no real agent, no threads) is in guided onboarding — the
  // "threads" view renders the onboarding flow, so label the nav item to match.
  const isOnboarding = !hasAgents && sessions.length === 0;

  const items: NavItem[] = [
    isOnboarding
      ? { mode: 'threads', label: t('views.onboarding'), icon: <Sparkles /> }
      : {
          mode: 'threads',
          label: t('views.threads'),
          icon: <MessageSquare />,
          count: unreadThreadsTotal,
        },
    { mode: 'issues', label: t('views.issues'), icon: <CircleDot />, count: tasks.filter(task => task.status === 'need_input').length },
    ...(hasAgents
      ? ([
          { mode: 'files', label: t('views.files'), icon: <FileText /> },
          { mode: 'browser', label: t('views.browser'), icon: <Globe /> },
          {
            mode: 'routines',
            label: t('views.routines'),
            icon: <CalendarClock />,
          },
          { mode: 'knowledge', label: t('views.knowledge'), icon: <BookOpen /> },

          {
            mode: 'inbox',
            label: t('views.inbox'),
            icon: <Inbox />,
            count: unreadNotificationCount > 0 ? unreadNotificationCount : undefined,
          },
          { mode: 'skills', label: t('views.skills'), icon: <Sparkles /> },
          {
            mode: 'workflows',
            label: t('views.workflows'),
            icon: <Waypoints />,
          },
          // v1.1 M2: team specialists directory
          { mode: 'agents', label: t('collab.viewAgents'), icon: <Bot /> },
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
                isActive={viewMode === item.mode || (viewMode === 'tasks' && item.mode === 'issues')}
                onClick={() => {
                  if (item.mode === 'threads') setThreadFilter('all');
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
                    variant={item.urgent || item.mode === 'inbox' || item.mode === 'threads' ? 'destructive' : 'secondary'}
                    appearance="light"
                    size="sm"
                    shape="circle"
                    className="min-w-5 justify-center px-1.5 tabular-nums"
                  >
                    {item.count > 99 ? '99+' : item.count}
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
