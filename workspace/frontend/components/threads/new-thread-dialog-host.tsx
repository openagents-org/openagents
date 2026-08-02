'use client';

import { NewThreadDialog } from './new-thread-dialog';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';

/**
 * Mounts the New Thread dialog once at the app level, driven by shared layout
 * state (`newThreadOpen`). This lets any surface — the sidebar button or an
 * empty-state "New Thread" prompt — open the same agent-picker via
 * `openNewThread()` without each one owning its own dialog instance.
 */
export function NewThreadDialogHost() {
  const { newThreadOpen, setNewThreadOpen, setViewMode, isMobile, openMobileDetail } = useLayout();
  const { agents, sessions, createSession } = useWorkspace();

  return (
    <NewThreadDialog
      open={newThreadOpen}
      onOpenChange={setNewThreadOpen}
      agents={agents}
      sessions={sessions}
      onCreateThread={({ participants, resumeFrom, phase, phaseOwner }) => {
        createSession({ participants, resumeFrom, phase, phaseOwner });
        setViewMode('threads');
        // On mobile, jump to the detail pane so the new thread is visible.
        if (isMobile) openMobileDetail();
      }}
    />
  );
}
