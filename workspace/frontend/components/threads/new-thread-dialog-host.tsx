'use client';

import { NewThreadDialog } from './new-thread-dialog';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useTeamRoster } from '@/hooks/use-team-roster';
import { useMe } from '@/hooks/use-me';

/**
 * Mounts the New Thread dialog once at the app level, driven by shared layout
 * state (`newThreadOpen`). This lets any surface — the sidebar button or an
 * empty-state "New Thread" prompt — open the same participant picker via
 * `openNewThread()` without each one owning its own dialog instance.
 */
export function NewThreadDialogHost() {
  const { newThreadOpen, setNewThreadOpen, newThreadAsChannel, setViewMode, setThreadFilter, isMobile, openMobileDetail } = useLayout();
  const { agents, sessions, createSession, updateSession, workspace, currentUser } = useWorkspace();
  const team = useTeamRoster();
  // v1.1 M1: a private thread records who directs it — the person creating it.
  // Token-only / anonymous sessions have no email; the server then leaves the
  // director unset.
  const me = useMe(workspace?.slug || workspace?.workspaceId);

  return (
    <NewThreadDialog
      open={newThreadOpen}
      onOpenChange={setNewThreadOpen}
      agents={agents}
      sessions={sessions}
      teammates={team.filter((person) => person.email.toLowerCase() !== (me?.email || currentUser.id).toLowerCase())}
      defaultAsChannel={newThreadAsChannel}
      onCreateThread={async ({ participants, humanParticipants, resumeFrom, visibility, asChannel }) => {
        const session = await createSession({
          participants,
          resumeFrom,
          visibility,
          humanParticipants,
          directorEmail: visibility === 'private' && me?.email ? me.email : undefined,
        });
        // The create event carries no channel flag, so label it right after.
        // The thread exists either way; a failed label only leaves it a thread.
        if (asChannel) {
          await updateSession(session.sessionId, { isChannel: true }).catch(() => {});
          setThreadFilter('channels');
        }
        setViewMode('threads');
        // On mobile, jump to the detail pane so the new thread is visible.
        if (isMobile) openMobileDetail();
      }}
    />
  );
}
