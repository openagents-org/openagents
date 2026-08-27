'use client';

import { useEffect, useRef } from 'react';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { AppHeader } from './app-header';
import { MobileHeader } from './mobile-header';
import { useLayout, RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } from './layout-context';
import { isRecentAgent } from '@/lib/helpers';
import { ChatView } from '@/components/chat/chat-view';
import { ThreadList } from '@/components/threads/thread-list';
import { FileList } from '@/components/files/file-list';
import { FilePreview } from '@/components/files/file-preview';
import { TrashView } from '@/components/files/trash-view';
import { BrowserTabList } from '@/components/browser/browser-tab-list';
import { BrowserView } from '@/components/browser/browser-view';
import { ConnectAgentView, FirstRunOnboarding } from '@/components/connect/connect-agent-view';
import { AgentProfilePanel } from '@/components/agents/agent-profile-panel';
import { MonitorGrid } from '@/components/monitor/monitor-grid';
import { TasksView } from '@/components/tasks/tasks-view';
import { WorkflowsView } from '@/components/workflows/workflows-view';
import { RoutineList } from '@/components/routines/routine-list';
import { SkillsView } from '@/components/skills/skills-view';
import { InboxView } from '@/components/inbox/inbox-view';
import { KnowledgeView } from '@/components/knowledge/knowledge-view';
import { KnowledgeList } from '@/components/knowledge/knowledge-list';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { NewThreadDialogHost } from '@/components/threads/new-thread-dialog-host';

function WorkspaceLoadingScreen() {
  const t = useT();

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
          <p className="text-sm text-muted-foreground mt-0.5">{t('nav.workspaceFallback')}</p>
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
    railDragWidth, filesSection, selectedAgentName, setSelectedAgentName,
  } = useLayout();
  const { monitorMode, agents, loading, sessions, currentSessionId } = useWorkspace();

  // Auto-dismiss the docked agent-profile panel when the user navigates away:
  // switching to another thread (incl. starting a new chat) or to another view
  // should not leave the profile pinned to the right. It stays open only while
  // the selected agent's own DM is the active session in the threads view.
  // Compared against previous values so merely *opening* the panel (which sets
  // session+view+agent in the same tick) doesn't immediately close it.
  const prevNavRef = useRef<{ session: string | null; view: string }>({ session: currentSessionId, view: viewMode });
  useEffect(() => {
    const navChanged =
      prevNavRef.current.session !== currentSessionId || prevNavRef.current.view !== viewMode;
    prevNavRef.current = { session: currentSessionId, view: viewMode };
    if (!navChanged || !selectedAgentName) return;
    const pair = ['human:user', `openagents:${selectedAgentName}`].sort();
    const agentDm = `dm:${pair[0]},${pair[1]}`;
    if (viewMode !== 'threads' || currentSessionId !== agentDm) setSelectedAgentName(null);
  }, [currentSessionId, viewMode, selectedAgentName, setSelectedAgentName]);
  // "Real agent" = a non-builtin agent that the sidebar would actually show
  // (online or seen within the last hour). A long-offline leftover agent is
  // hidden from the sidebar, so it must not silently block onboarding either —
  // otherwise the workspace looks empty yet never onboards (matches nav's rule).
  const hasAgents = agents.some((a) => isRecentAgent(a) && !a.builtin);
  // Guided onboarding takes over only for a genuinely fresh workspace: no real
  // agent AND no threads yet. Gating on threads protects an established
  // workspace (with history) from being hijacked by onboarding when its agent
  // happens to be offline > 1h.
  const showOnboarding = !hasAgents && sessions.length === 0 && viewMode === 'threads';

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
          {showOnboarding ? (
            <div className="h-full bg-background overflow-hidden">
              <FirstRunOnboarding />
            </div>
          ) : viewMode === 'connect' ? (
            <div className="h-full bg-background overflow-hidden">
              <ConnectAgentView />
            </div>
          ) : viewMode === 'tasks' ? (
            <div className="h-full bg-background overflow-hidden">
              <TasksView />
            </div>
          ) : viewMode === 'workflows' ? (
            <div className="h-full bg-background overflow-hidden">
              <WorkflowsView />
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
              {viewMode === 'files' && (filesSection === 'trash' ? <TrashView /> : <FilePreview />)}
              {viewMode === 'browser' && <BrowserView />}
              {viewMode === 'knowledge' && <KnowledgeView />}
            </div>
          )}
        </div>

        {/* The agent profile is opened from the nav drawer, which is reachable
            from every view and both panes — so it hangs off the shell rather
            than off one branch above, where it only rendered on the detail pane
            of a list view and tapping an agent looked like a dead click. It is
            `fixed` so the panel's own `absolute` inset resolves to the viewport,
            over the header and tab bar. */}
        {isAgentPanelOpen && (
          <div className="fixed inset-0 z-60">
            <AgentProfilePanel />
          </div>
        )}

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
    showOnboarding ||
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
          {showOnboarding ? (
            /* No agents yet: guided first-run onboarding (choose node vs local,
               node recommended) → hands off to the Connect view. */
            <div className="relative flex-1 min-w-0 overflow-hidden bg-background">
              <FirstRunOnboarding />
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
                /* In the chat view the profile DOCKS beside the thread instead
                   of sliding over it: clicking an agent opens their DM in the
                   middle with the profile alongside, so neither hides the other. */
                <div className="h-full flex">
                  <div className="relative flex-1 min-w-0 overflow-hidden">
                    <ChatView />
                  </div>
                  {isAgentPanelOpen && <AgentProfilePanel docked />}
                </div>
              )}
              {viewMode === 'files' && (filesSection === 'trash' ? <TrashView /> : <FilePreview />)}
              {viewMode === 'browser' && <BrowserView />}
              {viewMode === 'connect' && <ConnectAgentView />}
              {viewMode === 'tasks' && <TasksView />}
              {viewMode === 'workflows' && <WorkflowsView />}
              {viewMode === 'inbox' && <InboxView />}
              {viewMode === 'skills' && <SkillsView />}
              {viewMode === 'knowledge' && <KnowledgeView />}

              {/* Agent profile slide-over (non-chat views keep the overlay) */}
              {isAgentPanelOpen && viewMode !== 'threads' && viewMode !== 'routines' && <AgentProfilePanel />}
            </div>
          )}
        </div>
      </SidebarInset>

      <NewThreadDialogHost />
    </SidebarProvider>
  );
}
