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
import { TasksView } from '@/components/tasks/tasks-view';
import { RoutineList } from '@/components/routines/routine-list';
import { SkillsView } from '@/components/skills/skills-view';
import { InboxView } from '@/components/inbox/inbox-view';
import { KnowledgeView } from '@/components/knowledge/knowledge-view';
import { useWorkspace } from '@/lib/workspace-context';
import { EmptyState } from '@/components/chat/empty-state';

function WorkspaceLoadingScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <img
          src="/logo-icon.png"
          alt="OpenAgents"
          className="size-16 animate-[pulse_2s_ease-in-out_infinite] dark:hidden"
        />
        <img
          src="/logo-white.png"
          alt="OpenAgents"
          className="size-16 animate-[pulse_2s_ease-in-out_infinite] hidden dark:block"
        />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">OpenAgents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Workspace</p>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted overflow-hidden">
        <div className="h-full w-1/3 bg-primary rounded-full animate-[loading-bar_1.5s_ease-in-out_infinite]" />
      </div>
      <style>{`
        @keyframes loading-bar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

export function Wrapper() {
  const { isMobile, viewMode, isAgentPanelOpen, isSidebarOpen, isDetailExpanded, mobilePane, splitBrowser, showBrowserPreview } = useLayout();
  const { monitorMode, agents, loading } = useWorkspace();
  const hasAgents = agents.length > 0;

  if (loading) {
    return <WorkspaceLoadingScreen />;
  }

  // ── Mobile layout: single-pane with list/detail switching ──
  if (isMobile) {
    return (
      <div className="flex flex-col h-screen w-full [&_.container-fluid]:px-5">
        <MobileHeader />
        <div className="flex-1 min-h-0 pt-[var(--header-height-mobile)] pb-[calc(48px+env(safe-area-inset-bottom))]">
          {/* Full-screen views (no list/detail split) */}
          {!hasAgents && viewMode === 'threads' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <EmptyState />
            </div>
          ) : viewMode === 'connect' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <ConnectAgentView />
            </div>
          ) : viewMode === 'tasks' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <TasksView />
            </div>
          ) : viewMode === 'inbox' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <InboxView />
            </div>
          ) : viewMode === 'skills' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <SkillsView />
            </div>
          ) : viewMode === 'knowledge' ? (
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <KnowledgeView />
            </div>
          ) : mobilePane === 'list' ? (
            /* List pane — full width */
            <div className="h-full mx-2 my-1.5 bg-background overflow-hidden border border-input rounded-xl shadow-xs flex flex-col">
              {viewMode === 'threads' && <ThreadList />}
              {viewMode === 'files' && <FileList />}
              {viewMode === 'browser' && <BrowserTabList />}
              {viewMode === 'routines' && <RoutineList />}
            </div>
          ) : (
            /* Detail pane — full width, edge-to-edge on mobile */
            <div className="relative h-full bg-background overflow-hidden">
              {(viewMode === 'threads' || viewMode === 'routines') && (
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

          {/* No agents + threads view: full-width onboarding (no thread list, no message input) */}
          {!hasAgents && viewMode === 'threads' ? (
            <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
              <EmptyState />
            </div>
          ) : viewMode === 'threads' && monitorMode ? (
            /* Monitor mode: replace both panes with 2x3 grid */
            <div className="relative flex-1 min-w-0">
              <MonitorGrid />
              {isAgentPanelOpen && <AgentProfilePanel />}
            </div>
          ) : (
            <>
              {/* Middle pane — thread list or file list
                  Hidden for: connect view, expanded detail, or when browser preview is active */}
              {viewMode !== 'connect' && viewMode !== 'tasks' && viewMode !== 'inbox' && viewMode !== 'knowledge' && viewMode !== 'skills' && !isDetailExpanded && !(splitBrowser && showBrowserPreview && viewMode === 'threads') && (
                <div className="shrink-0 w-[300px] xl:w-[400px] bg-background overflow-hidden border border-input rounded-xl shadow-xs flex flex-col">
                  {viewMode === 'threads' && <ThreadList />}
                  {viewMode === 'files' && <FileList />}
                  {viewMode === 'browser' && <BrowserTabList />}
                  {viewMode === 'routines' && <RoutineList />}
                </div>
              )}

              {/* Right pane — chat view, file preview, or connect agent */}
              {viewMode === 'threads' && splitBrowser && showBrowserPreview ? (
                /* Split view: chat + browser side by side (thread list hidden) */
                <div className="flex flex-1 min-w-0 gap-2.5">
                  <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
                    <main className="h-full" role="content">
                      <ChatView />
                    </main>
                    {isAgentPanelOpen && <AgentProfilePanel />}
                  </div>
                  <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
                    <BrowserView />
                  </div>
                </div>
              ) : (
                <div className="relative flex-1 min-w-0 bg-background overflow-hidden border border-input rounded-xl shadow-xs">
                  {(viewMode === 'threads' || viewMode === 'routines') && (
                    <main className="h-full" role="content">
                      <ChatView />
                    </main>
                  )}
                  {viewMode === 'files' && <FilePreview />}
                  {viewMode === 'browser' && <BrowserView />}
                  {viewMode === 'connect' && <ConnectAgentView />}
                  {viewMode === 'tasks' && <TasksView />}
                  {viewMode === 'inbox' && <InboxView />}
                  {viewMode === 'skills' && <SkillsView />}
                  {viewMode === 'knowledge' && <KnowledgeView />}

                  {/* Agent profile slide-over */}
                  {isAgentPanelOpen && <AgentProfilePanel />}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
