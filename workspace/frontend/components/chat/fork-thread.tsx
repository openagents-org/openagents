'use client';

import { GitFork } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { WithTooltip } from '@/components/ui/with-tooltip';

/** The source thread is described on hover without changing the current thread. */
export function ForkTag({ forkedFrom }: { forkedFrom: string }) {
  const { sessions } = useWorkspace();
  const t = useT();
  const source = sessions.find((s) => s.sessionId === forkedFrom);
  const hint = t('chat.forkedFrom', { title: source?.title || t('threads.untitled') });
  return (
    <WithTooltip label={hint}><Badge variant="secondary">
      <GitFork data-icon="inline-start" />
      {t('chat.forkTag')}
    </Badge></WithTooltip>
  );
}
