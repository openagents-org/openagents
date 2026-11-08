'use client';

import { GitFork } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';

/** Small "Fork" tag beside a forked thread's title; opens the source thread when the viewer can see it. */
export function ForkTag({ forkedFrom }: { forkedFrom: string }) {
  const { sessions, setCurrentSessionId } = useWorkspace();
  const t = useT();
  const source = sessions.find((s) => s.sessionId === forkedFrom);
  const hint = t('chat.forkedFrom', { title: source?.title || t('threads.untitled') });
  const className = 'inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  const content = <><GitFork className="size-2.5" />{t('chat.forkTag')}</>;
  return source ? (
    <button type="button" className={`${className} hover:text-foreground`} title={hint} aria-label={hint} onClick={() => setCurrentSessionId(source.sessionId)}>
      {content}
    </button>
  ) : (
    <span className={className} title={hint}>{content}</span>
  );
}
