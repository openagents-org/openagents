'use client';
import { ArtifactPanel } from '@/components/artifacts/artifact-panel';
import { AgentProfilePanel } from '@/components/agents/agent-profile-panel';
import { AgentDirectoryView } from '@/components/agents/agent-directory-view';
import { BrowserView } from '@/components/browser/browser-view';
import { ChatView } from '@/components/chat/chat-view';
import { ConnectAgentView } from '@/components/connect/connect-agent-view';
import { FirstRunOnboarding } from '@/components/connect/first-run-onboarding';
import { FileList } from '@/components/files/file-list';
import { FilePreview } from '@/components/files/file-preview';
import { TrashView } from '@/components/files/trash-view';
import { InboxView } from '@/components/inbox/inbox-view';
import { IssuesView } from '@/components/issues/issues-view';
import { KnowledgeList } from '@/components/knowledge/knowledge-list';
import { KnowledgeView } from '@/components/knowledge/knowledge-view';
import { RoutineList } from '@/components/routines/routine-list';
import { SkillsView } from '@/components/skills/skills-view';
import { NewThreadDialogHost } from '@/components/threads/new-thread-dialog-host';
import { ThreadList } from '@/components/threads/thread-list';
import { WorkflowsView } from '@/components/workflows/workflows-view';
import { useLayout } from './layout-context';
import { MobileHeader } from './mobile-header';
import { OnboardingSurfaceContext } from './onboarding-surface';

/**
 * The phone layout: one pane at a time with list/detail switching. Only on a
 * phone or tablet held narrow (see useIsMobile); a narrow desktop window keeps
 * the desktop shell.
 */
export function MobileShell({
  showOnboarding,
  dismissOnboarding,
}: {
  /** Guided first-agent setup owns the screen. */
  showOnboarding: boolean;
  dismissOnboarding: () => void;
}) {
  const { viewMode, isAgentPanelOpen, mobilePane, showBrowserPreview, filesSection } = useLayout();
    return (
      <OnboardingSurfaceContext.Provider value={{ active: showOnboarding, onDismiss: dismissOnboarding }}>
      <div className="flex flex-col h-[calc(100vh-var(--oa-banner-h,0px))] w-full [&_.container-fluid]:px-5">
        <MobileHeader />
        <div className="flex-1 min-h-0 pt-[var(--header-height-mobile)] pb-[calc(48px+env(safe-area-inset-bottom))]">
          {/* Full-screen views (no list/detail split) */}
          {showOnboarding ? (
            <div className="h-full bg-background overflow-hidden">
              <FirstRunOnboarding onDismiss={dismissOnboarding} />
            </div>
          ) : viewMode === 'connect' ? (
            <div className="h-full bg-background overflow-hidden">
              <ConnectAgentView />
            </div>
          ) : viewMode === 'issues' ? (
            <div className="h-full bg-background overflow-hidden"><IssuesView /></div>
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
          ) : viewMode === 'agents' ? (
            <div className="h-full bg-background overflow-hidden">
              <AgentDirectoryView />
            </div>
          ) : viewMode === 'browser' ? (
            /* The cloud browser has no list pane: its tab strip is the tab switcher */
            <div className="relative h-full bg-background overflow-hidden">
              <BrowserView />
            </div>
          ) : viewMode === 'threads' && showBrowserPreview ? (
            <div className="h-full overflow-hidden bg-background"><ArtifactPanel /></div>
          ) : mobilePane === 'list' ? (
            /* List pane — full width */
            <div className="flex h-full flex-col bg-background overflow-hidden">
              {viewMode === 'threads' && <ThreadList />}
              {viewMode === 'files' && <FileList />}
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
      </OnboardingSurfaceContext.Provider>
    );
}
