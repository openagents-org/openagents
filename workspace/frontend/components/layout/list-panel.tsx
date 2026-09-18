'use client';

import { Activity, useRef } from 'react';
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
  const visited = useRef(new Set<string>());
  visited.current.add(viewMode);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {visited.current.has('threads') && <Activity mode={viewMode === 'threads' ? 'visible' : 'hidden'}><ThreadList /></Activity>}
      {visited.current.has('files') && <Activity mode={viewMode === 'files' ? 'visible' : 'hidden'}><FileList /></Activity>}
      {visited.current.has('browser') && <Activity mode={viewMode === 'browser' ? 'visible' : 'hidden'}><BrowserTabList /></Activity>}
      {visited.current.has('routines') && <Activity mode={viewMode === 'routines' ? 'visible' : 'hidden'}><RoutineList /></Activity>}
      {visited.current.has('knowledge') && <Activity mode={viewMode === 'knowledge' ? 'visible' : 'hidden'}><KnowledgeList /></Activity>}
    </div>
  );
}
