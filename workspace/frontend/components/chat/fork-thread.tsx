'use client';

import { GitFork } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';

/** One-line note at the top of a forked thread, linking back to its source when visible. */
export function ForkedFromNote({ forkedFrom }: { forkedFrom: string }) {
  const { sessions, setCurrentSessionId } = useWorkspace();
  const t = useT();
  const source = sessions.find((s) => s.sessionId === forkedFrom);
  return (
    <div className="flex items-center gap-1.5 border-b px-4 py-1.5 text-xs text-muted-foreground">
      <GitFork className="size-3 shrink-0" />
      {source ? (
        <button type="button" className="truncate hover:text-foreground hover:underline" onClick={() => setCurrentSessionId(source.sessionId)}>
          {t('chat.forkedFrom', { title: source.title })}
        </button>
      ) : (
        <span>{t('chat.forkedFromUnavailable')}</span>
      )}
    </div>
  );
}
