'use client';

import { GitFork } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';

/** The source thread is described on hover without changing the current thread. */
export function ForkTag({ forkedFrom }: { forkedFrom: string }) {
  const { sessions } = useWorkspace();
  const t = useT();
  const source = sessions.find((s) => s.sessionId === forkedFrom);
  const hint = t('chat.forkedFrom', { title: source?.title || t('threads.untitled') });
  const className = 'inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  const content = <><GitFork className="size-2.5" />{t('chat.forkTag')}</>;
  return (
    <span className={className} title={hint}>{content}</span>
  );
}
