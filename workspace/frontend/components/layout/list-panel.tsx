'use client';

import { ThreadList } from '@/components/threads/thread-list';
import { FileList } from '@/components/files/file-list';
import { BrowserTabList } from '@/components/browser/browser-tab-list';
import { RoutineList } from '@/components/routines/routine-list';
import { KnowledgeList } from '@/components/knowledge/knowledge-list';
import { useLayout } from './layout-context';

/**
 * The app-shell-4 second inner sidebar: a wide list panel that fills whatever
 * space the sidebar has left over after the icon rail. Each list owns its own
 * `--header-height` header, so it lines up with the rail and the detail header.
 */
export function ListPanel() {
  const { viewMode } = useLayout();

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {viewMode === 'threads' && <ThreadList />}
      {viewMode === 'files' && <FileList />}
      {viewMode === 'browser' && <BrowserTabList />}
      {viewMode === 'routines' && <RoutineList />}
      {viewMode === 'knowledge' && <KnowledgeList />}
    </div>
  );
}
