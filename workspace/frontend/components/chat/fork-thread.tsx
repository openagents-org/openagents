'use client';

import { useState } from 'react';
import { GitFork, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';

/** Header button: copy the thread (settings, agents, history) into a new private thread and open it. */
export function ForkThreadButton({ channelName }: { channelName: string }) {
  const { forkSession } = useWorkspace();
  const t = useT();
  const [busy, setBusy] = useState(false);

  const fork = async () => {
    setBusy(true);
    try {
      await forkSession(channelName);
    } catch {
      toast.error(t('chat.forkThreadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={fork}
      disabled={busy}
      className="gap-1.5 h-7 text-xs font-medium"
      title={t('chat.forkThreadHint')}
      aria-label={t('chat.forkThread')}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitFork className="size-3.5" />}
    </Button>
  );
}

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
