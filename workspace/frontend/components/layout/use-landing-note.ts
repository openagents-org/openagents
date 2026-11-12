'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { usePrompt } from '@/components/ui/dialogs-provider';
import { desktopHost } from '@/lib/desktop-host';
import { takeLandingNote } from '@/lib/first-workspace';
import { useT } from '@/lib/i18n';
import { useWorkspace } from '@/lib/workspace-context';

/** "Your only workspace" is worth saying a few times, not every session forever. */
const ONLY_NOTE_LIMIT = 3;
const ONLY_NOTE_COUNT_KEY = 'oa_landing_only_count';
const NOTE_DURATION_MS = 15_000;

/**
 * When the app opened a workspace without the user picking it (sign-in with a
 * single workspace, a workspace just created for them, or the one they were
 * invited to), say which one and why, with a way to the full list, and to
 * rename a workspace created for them.
 */
export function useLandingNote() {
  const t = useT();
  const router = useRouter();
  const prompt = usePrompt();
  const { workspace, loading, renameWorkspace } = useWorkspace();
  const shownRef = useRef(false);

  useEffect(() => {
    if (loading || !workspace || shownRef.current || desktopHost()) return;
    const note = takeLandingNote(workspace.slug) ?? takeLandingNote(workspace.workspaceId);
    if (!note) return;
    shownRef.current = true;

    if (note.reason === 'only') {
      try {
        const count = Number(localStorage.getItem(ONLY_NOTE_COUNT_KEY) || 0);
        if (count >= ONLY_NOTE_LIMIT) return;
        localStorage.setItem(ONLY_NOTE_COUNT_KEY, String(count + 1));
      } catch { /* show it anyway */ }
    }

    const allWorkspaces = { label: t('workspaceLanding.allWorkspaces'), onClick: () => router.push('/') };
    const name = workspace.name || note.name;
    if (note.reason === 'created') {
      toast(t('workspaceLanding.createdTitle', { name }), {
        description: t('workspaceLanding.createdBody'),
        duration: NOTE_DURATION_MS,
        action: {
          label: t('workspaceLanding.rename'),
          onClick: async () => {
            const next = await prompt({ title: t('workspaceLanding.renameTitle'), defaultValue: name, confirmText: t('workspaceLanding.rename') });
            const trimmed = next?.trim();
            if (trimmed && trimmed !== name) {
              await renameWorkspace(trimmed);
              toast.success(t('workspaceLanding.renamed'));
            }
          },
        },
        cancel: allWorkspaces,
      });
    } else {
      toast(t(note.reason === 'invited' ? 'workspaceLanding.invitedTitle' : 'workspaceLanding.onlyTitle', { name }), {
        description: note.reason === 'invited' ? t('workspaceLanding.invitedBody') : undefined,
        duration: NOTE_DURATION_MS,
        action: allWorkspaces,
      });
    }
  }, [loading, workspace, t, router, prompt, renameWorkspace]);
}
