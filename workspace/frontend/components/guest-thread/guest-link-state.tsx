'use client';

import Image from 'next/image';
import { ArrowRightLeft, Clock, Eye, Link2Off, Lock, LogIn, UserRoundX, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n';

/** Full-page loading / not found / expired / failed states for a thread link
 * (and, for the owner link, "moved to your workspace").
 * Each is final until the person acts — no spinner loops, no auto-retry. */
export function GuestLinkState({ state, onRetry, variant = 'guest', movedHref, email, onSignIn, onSwitchAccount, preview = false }: {
  state: 'loading' | 'not_found' | 'expired' | 'error' | 'moved' | 'invite_signin' | 'invite_denied';
  /** Invite-only, not invited: the signed-in account it checked. */
  email?: string | null;
  /** Invite-only: sign in (central login, back here). */
  onSignIn?: () => void;
  /** Invite-only, wrong account: sign out and in with another. */
  onSwitchAccount?: () => void;
  /** The owner's preview of what a signed-out guest sees. */
  preview?: boolean;
  onRetry?: () => void;
  /** `owner`: the copy speaks about the private owner link. */
  variant?: 'guest' | 'owner';
  /** For `moved`: where the conversation lives now. */
  movedHref?: string | null;
}) {
  const t = useT();
  if (state === 'loading') return <ThreadSkeleton label={t('guestThread.loading')} />;
  const copy = state === 'invite_signin'
    ? { icon: <Lock />, title: t('guestThread.inviteOnlyTitle'), body: t('guestThread.inviteOnlyBody') }
    : state === 'invite_denied'
    ? { icon: <UserRoundX />, title: email ? t('guestThread.inviteDeniedTitle', { email }) : t('guestThread.inviteDeniedTitleNoEmail'), body: t('guestThread.inviteDeniedBody') }
    : state === 'moved'
    ? { icon: <ArrowRightLeft />, title: t('shareJam.movedTitle'), body: t('shareJam.movedBody') }
    : state === 'not_found' && variant === 'owner'
    ? { icon: <Link2Off />, title: t('shareJam.notFoundTitle'), body: t('shareJam.notFoundBody') }
    : state === 'not_found'
    ? { icon: <Link2Off />, title: t('guestThread.notFoundTitle'), body: t('guestThread.notFoundBody') }
    : state === 'expired'
      ? { icon: <Clock />, title: t('guestThread.expiredTitle'), body: t('guestThread.expiredBody') }
      : { icon: <WifiOff />, title: t('guestThread.loadFailedTitle'), body: t('guestThread.loadFailedBody') };
  return (
    // The workspace's framing: the app background with one inset card.
    <div className="flex min-h-dvh flex-col bg-background p-0 lg:bg-sidebar lg:p-2">
      <div className="flex flex-1 flex-col items-center justify-center p-6 lg:rounded-xl lg:border lg:bg-background">
        <Brand />
        {preview && (
          <p className="mt-4 flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground" data-preview-signed-out="">
            <Eye className="size-3.5" />{t('guestThread.previewSignedOut')}
          </p>
        )}
        <Empty className="mt-6 max-w-md flex-none" data-guest-link-state={state}>
          <EmptyHeader>
            <EmptyMedia variant="icon">{copy.icon}</EmptyMedia>
            <EmptyTitle>{copy.title}</EmptyTitle>
            <EmptyDescription>{copy.body}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center gap-2">
            {state === 'error' && onRetry && <Button onClick={onRetry}>{t('guestThread.tryAgain')}</Button>}
          {state === 'invite_signin' && onSignIn && <Button onClick={onSignIn} disabled={preview} data-invite-sign-in=""><LogIn data-icon="inline-start" />{t('guestThread.inviteSignIn')}</Button>}
          {state === 'invite_denied' && onSwitchAccount && <Button onClick={onSwitchAccount} data-invite-switch="">{t('guestThread.inviteSwitch')}</Button>}
            {state === 'moved' && movedHref && (
              <Button asChild><a href={movedHref} data-moved-open="">{t('shareJam.open')}</a></Button>
            )}
            <Button variant={state === 'error' || state === 'invite_signin' || state === 'invite_denied' || (state === 'moved' && movedHref) ? 'outline' : 'default'} asChild>
              <a href="/">{t('guestThread.goToOpenAgents')}</a>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold">
      <span className="flex size-6 items-center justify-center overflow-hidden">
        <Image src="/logo-black.png" alt="" width={24} height={24} className="size-full object-contain dark:hidden" />
        <Image src="/logo-white.png" alt="" width={24} height={24} className="hidden size-full object-contain dark:block" />
      </span>
      OpenAgents
    </span>
  );
}

/** The thread view's outline while it loads: sidebar, header, a few messages, composer. */
function ThreadSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-dvh bg-background lg:bg-sidebar" role="status" aria-label={label} data-guest-link-state="loading">
      <div className="hidden w-60 shrink-0 flex-col gap-5 px-3 pt-4 lg:flex" aria-hidden="true">
        <div className="flex items-center gap-2 px-1.5"><Skeleton className="size-5 rounded-md" /><Skeleton className="h-4 w-32" /></div>
        <div className="flex flex-col gap-2 px-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-8 w-full" /></div>
        <div className="flex flex-col gap-2.5 px-1.5">
          <Skeleton className="h-3 w-20" />
          <div className="flex items-center gap-2"><Skeleton className="size-5 rounded-full" /><Skeleton className="h-3.5 w-24" /></div>
        </div>
        <div className="flex flex-col gap-2.5 px-1.5">
          <Skeleton className="h-3 w-20" />
          <div className="flex items-center gap-2"><Skeleton className="size-6 rounded-full" /><Skeleton className="h-3.5 w-20" /></div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pe-2" aria-hidden="true">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3 lg:hidden"><Skeleton className="size-6 rounded-md" /><Skeleton className="h-4 w-36" /></div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-xl lg:border">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b px-4"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-14" /></div>
          <div className="flex flex-1 flex-col gap-6 px-4 py-6 lg:px-8">
            {[0.6, 0.9, 0.45].map((width, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5" style={{ width: `${width * 100}%` }} />
                  {i === 1 && <Skeleton className="h-3.5 w-1/2" />}
                </div>
              </div>
            ))}
          </div>
          <div className="px-3 pb-3 lg:px-5"><Skeleton className="h-24 w-full rounded-lg" /></div>
        </div>
      </div>
    </div>
  );
}
