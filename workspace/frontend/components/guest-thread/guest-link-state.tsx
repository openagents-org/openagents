'use client';

import Image from 'next/image';
import { Clock, Link2Off, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';

/** Full-page loading / not found / expired / failed states for a thread link.
 * Each is final until the guest acts — no spinner loops, no auto-retry. */
export function GuestLinkState({ state, onRetry }: { state: 'loading' | 'not_found' | 'expired' | 'error'; onRetry?: () => void }) {
  const t = useT();
  if (state === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background" role="status" aria-label={t('guestThread.loading')}>
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }
  const copy = state === 'not_found'
    ? { icon: <Link2Off />, title: t('guestThread.notFoundTitle'), body: t('guestThread.notFoundBody') }
    : state === 'expired'
      ? { icon: <Clock />, title: t('guestThread.expiredTitle'), body: t('guestThread.expiredBody') }
      : { icon: <WifiOff />, title: t('guestThread.loadFailedTitle'), body: t('guestThread.loadFailedBody') };
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <Image src="/logo-icon.png" alt="OpenAgents" width={32} height={32} className="mb-6" />
      <Empty className="flex-none" data-guest-link-state={state}>
        <EmptyHeader>
          <EmptyMedia variant="icon">{copy.icon}</EmptyMedia>
          <EmptyTitle>{copy.title}</EmptyTitle>
          <EmptyDescription>{copy.body}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          {state === 'error' && onRetry && <Button onClick={onRetry}>{t('guestThread.tryAgain')}</Button>}
          <Button variant={state === 'error' ? 'outline' : 'default'} asChild>
            <a href="/">{t('guestThread.goToOpenAgents')}</a>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
