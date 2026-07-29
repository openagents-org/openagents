'use client';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { AppHeader } from './app-header';
import { MobileHeader } from './mobile-header';
import { useLayout, RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } from './layout-context';
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
import { KnowledgeList } from '@/components/knowledge/knowledge-list';
import { useWorkspace } from '@/lib/workspace-context';
import { EmptyState } from '@/components/chat/empty-state';
import { NewThreadDialogHost } from '@/components/threads/new-thread-dialog-host';

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
  const {
    isMobile, viewMode, isAgentPanelOpen, isSidebarOpen, setSidebarOpen,
    hasListPanel, mobilePane, splitBrowser, showBrowserPreview, isRailExpanded,
    railDragWidth,
  } = useLayout();
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
            <div className="h-full bg-background overflow-hidden">
              <EmptyState />
            </div>
          ) : viewMode === 'connect' ? (
            <div className="h-full bg-background overflow-hidden">
              <ConnectAgentView />
            </div>
          ) : viewMode === 'tasks' ? (
            <div className="h-full bg-background overflow-hidden">
              <TasksView />
            </div>
          ) : viewMode === 'inbox' ? (
            <div className="h-full bg-background overflow-hidden">
              <InboxView />
            </div>
          ) : viewMode === 'skills' ? (
            <div className="h-full bg-background overflow-hidden">
              <SkillsView />
            </div>
          ) : mobilePane === 'list' ? (
            /* List pane — full width */
            <div className="flex h-full flex-col bg-background overflow-hidden">
              {viewMode === 'threads' && <ThreadList />}
              {viewMode === 'files' && <FileList />}
              {viewMode === 'browser' && <BrowserTabList />}
              {viewMode === 'routines' && <RoutineList />}
              {viewMode === 'knowledge' && <KnowledgeList />}
            </div>
          ) : (
            /* Detail pane — full width, edge-to-edge on mobile */
            <div className="relative h-full bg-background overflow-hidden">
              {(viewMode === 'threads' || viewMode === 'routines') && (
                <div className="h-full">
                  <ChatView />
                </div>
              )}
              {viewMode === 'files' && <FilePreview />}
              {viewMode === 'browser' && <BrowserView />}
              {viewMode === 'knowledge' && <KnowledgeView />}
              {isAgentPanelOpen && <AgentProfilePanel />}
            </div>
          )}
        </div>
        <NewThreadDialogHost />
      </div>
    );
  }

  // ── Desktop layout (app-shell-4) ──
  // The sidebar holds both the icon rail and the list panel; SidebarInset is
  // the detail area, and each view brings its own `--header-height` header so
  // rail, list and detail line up on a single row.
  //
  // A few views take over the whole detail area, so the list collapses away:
  // onboarding (no agents yet), monitor mode, and the split browser preview.
  const listSuppressed =
    (!hasAgents && viewMode === 'threads') ||
    (viewMode === 'threads' && monitorMode) ||
    (viewMode === 'threads' && splitBrowser && showBrowserPreview);
  const sidebarOpen = isSidebarOpen && hasListPanel && !listSuppressed;

  // The shell sizes itself: rail width plus the list panel when it is showing.
  // Expanding the rail to show labels widens the shell by the same amount.
  // While the rail's edge is being dragged the live width wins, so the shell
  // tracks the pointer and only settles on a state when the drag ends.
  const railWidth =
    railDragWidth ?? (isRailExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED);
  const shellWidth = railWidth + (sidebarOpen ? 388 : 0);

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className="h-screen min-h-0 [&_.container-fluid]:px-5"
      style={{
        '--sidebar-width': `${shellWidth}px`,
        '--sidebar-width-icon': `${railWidth}px`,
        '--header-height': '48px',
      } as React.CSSProperties}
    >
      <AppSidebar />

      <SidebarInset className="min-w-0">
        <AppHeader />
        <div className="relative flex min-h-0 grow overflow-hidden">
          {!hasAgents && viewMode === 'threads' ? (
            /* No agents yet: full-width onboarding */
            <div className="relative flex-1 min-w-0 overflow-hidden bg-background">
              <EmptyState />
            </div>
          ) : viewMode === 'threads' && monitorMode ? (
            /* Monitor mode: 2x3 grid over the whole detail area */
            <div className="relative flex-1 min-w-0">
              <MonitorGrid />
              {isAgentPanelOpen && <AgentProfilePanel />}
            </div>
          ) : viewMode === 'threads' && splitBrowser && showBrowserPreview ? (
            /* Split view: chat + browser side by side */
            <div className="flex flex-1 min-w-0">
              <div className="relative flex-1 min-w-0 overflow-hidden border-e border-border bg-background">
                <div className="h-full">
                  <ChatView />
                </div>
                {isAgentPanelOpen && <AgentProfilePanel />}
              </div>
              <div className="relative flex-1 min-w-0 overflow-hidden bg-background">
                <BrowserView />
              </div>
            </div>
          ) : (
            <div className="relative flex-1 min-w-0 overflow-hidden bg-background">
              {(viewMode === 'threads' || viewMode === 'routines') && (
                <div className="h-full">
                  <ChatView />
                </div>
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
        </div>
      </SidebarInset>

      <NewThreadDialogHost />
    </SidebarProvider>
  );
}
