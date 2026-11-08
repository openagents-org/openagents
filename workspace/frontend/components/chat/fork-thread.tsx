'use client';

import { GitFork } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';

/** System notice after a fork's copied history: which thread it came from, linking back when visible. */
export function ForkedNotice({ forkedFrom, title }: { forkedFrom?: string; title?: string }) {
  const { sessions, setCurrentSessionId } = useWorkspace();
  const t = useT();
  const source = forkedFrom ? sessions.find((s) => s.sessionId === forkedFrom) : undefined;
  const label = t('chat.forkedFrom', { title: source?.title || title || t('threads.untitled') });
  return (
    <div className="flex items-center gap-3 py-3" role="note">
      <div className="h-px flex-1 bg-border" />
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <GitFork className="size-3 shrink-0" />
        {source ? (
          <button type="button" className="truncate hover:text-foreground hover:underline" onClick={() => setCurrentSessionId(source.sessionId)}>
            {label}
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
