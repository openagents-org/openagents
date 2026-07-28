'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout, type ViewMode } from './layout-context';
import { SearchMenu } from './search-menu';
import { NotificationsMenu } from './notifications-menu';
import { UserMenu } from './user-menu';

const VIEW_LABELS: Record<ViewMode, string> = {
  threads: 'Threads',
  files: 'Files',
  knowledge: 'Knowledge',
  browser: 'Browser',
  tasks: 'Tasks',
  routines: 'Routines',
  inbox: 'Inbox',
  connect: 'Connect Agent',
  skills: 'Skill Hub',
};

export function SiteHeader() {
  const { viewMode } = useLayout();
  const { sessions, files, currentSessionId, selectedFileId, currentFilePath } = useWorkspace();

  // Second crumb: whatever is open in the detail pane for this view.
  let detail: string | null = null;
  if (viewMode === 'threads' && currentSessionId) {
    detail = sessions.find((s) => s.sessionId === currentSessionId)?.title || null;
  } else if (viewMode === 'files') {
    detail = files.find((f) => f.id === selectedFileId)?.filename || currentFilePath || null;
  }

  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1 shrink-0" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className={detail ? 'hidden md:block' : undefined}>
              <BreadcrumbPage className={detail ? 'font-normal text-muted-foreground' : undefined}>
                {VIEW_LABELS[viewMode]}
              </BreadcrumbPage>
            </BreadcrumbItem>
            {detail && (
              <>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate">{detail}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="ml-auto flex items-center gap-1 text-muted-foreground">
        <SearchMenu />
        <NotificationsMenu />
        <UserMenu />
      </div>
    </header>
  );
}
