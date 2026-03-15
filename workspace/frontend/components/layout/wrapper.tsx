'use client';

import { Sidebar } from './sidebar';
import { MobileHeader } from './mobile-header';
import { useLayout } from './layout-context';
import { ChatView } from '@/components/chat/chat-view';
import { ThreadList } from '@/components/threads/thread-list';
import { FileList } from '@/components/files/file-list';
import { FilePreview } from '@/components/files/file-preview';
import { BrowserTabList } from '@/components/browser/browser-tab-list';
import { BrowserView } from '@/components/browser/browser-view';
import { ConnectAgentView } from '@/components/connect/connect-agent-view';
import { AgentProfilePanel } from '@/components/agents/agent-profile-panel';
import { MonitorGrid } from '@/components/monitor/monitor-grid';
import { useWorkspace } from '@/lib/workspace-context';

export function Wrapper() {
  const { isMobile, viewMode, isAgentPanelOpen, isSidebarOpen, isDetailExpanded, mobilePane } = useLayout();
  const { monitorMode } = useWorkspace();

  // ── Mobile layout: single-pane with list/detail switching ──
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen w-full [&_.container-fluid]:px-5">
        <MobileHeader />
        <div className="flex-1 min-h-0 pt-[var(--header-height-mobile)] pb-[calc(48px+env(safe-area-inset-bottom))]">
          {/* Connect view is always full-screen (no list/detail split) */}
          {viewMode === 'connect' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <ConnectAgentView />
            </div>
          ) : mobilePane === 'list' ? (
            /* List pane — full width */
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs flex flex-col">
              {viewMode === 'threads' && <ThreadList />}
              {viewMode === 'files' && <FileList />}
              {viewMode === 'browser' && <BrowserTabList />}
            </div>
          ) : (
            /* Detail pane — full width */
            <div className="relative h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              {viewMode === 'threads' && (
                <main className="h-full" role="content">
                  <ChatView />
                </main>
              )}
              {viewMode === 'files' && <FilePreview />}
              {viewMode === 'browser' && <BrowserView />}
              {isAgentPanelOpen && <AgentProfilePanel />}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Desktop layout: sidebar + two panes ──
  return (
    <div className="flex h-screen w-full [&_.container-fluid]:px-5">
      {!isDetailExpanded && <Sidebar />}

      <div className="flex flex-col flex-1 min-w-0 w-full">
        <div className="flex grow min-h-0 overflow-hidden mx-2.5 py-2.5 gap-2.5">
          {/* Invisible spacer for fixed sidebar */}
          {!isDetailExpanded && (
            <div
              className="shrink-0 transition-all duration-300"
              style={{
                width: isSidebarOpen
                  ? 'var(--sidebar-width)'
                  : 'var(--sidebar-width-collapsed)',
              }}
            />
          )}

          {/* Monitor mode: replace both panes with 2x3 grid */}
          {viewMode === 'threads' && monitorMode ? (
            <div className="relative flex-1 min-w-0">
              <MonitorGrid />
              {isAgentPanelOpen && <AgentProfilePanel />}
            </div>
          ) : (
            <>
              {/* Middle pane — thread list or file list (hidden for connect view or when expanded) */}
              {viewMode !== 'connect' && !isDetailExpanded && (
                <div className="shrink-0 w-[300px] xl:w-[400px] bg-background overflow-hidden border border-input rounded-xl shadow-xs flex flex-col">
                  {viewMode === 'threads' && <ThreadList />}
                  {viewMode === 'files' && <FileList />}
                  {viewMode === 'browser' && <BrowserTabList />}
                </div>
              )}

              {/* Right pane — chat view, file preview, or connect agent */}
              <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
                {viewMode === 'threads' && (
                  <main className="h-full" role="content">
                    <ChatView />
                  </main>
                )}
                {viewMode === 'files' && <FilePreview />}
                {viewMode === 'browser' && <BrowserView />}
                {viewMode === 'connect' && <ConnectAgentView />}

                {/* Agent profile slide-over */}
                {isAgentPanelOpen && <AgentProfilePanel />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
