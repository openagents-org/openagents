'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, CopyPlus, LogIn, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { Spinner } from '@/components/ui/spinner';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { forkSharedThread, GuestThreadError } from '@/lib/guest-thread-api';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { listMyWorkspaces, threadPath, type MyWorkspace } from '@/lib/jam-api';
import { cn } from '@/lib/utils';

const FORK_INTENT_PREFIX = 'oa-share-fork-intent:';

/** Remember that the guest was taking a copy when they left to sign in. */
export function rememberForkIntent(token: string): void {
  try { sessionStorage.setItem(FORK_INTENT_PREFIX + token, '1'); } catch { /* private mode */ }
}

/** Was taking a copy interrupted by signing in? Reading clears it. */
export function takeForkIntent(token: string): boolean {
  try {
    const flagged = !!sessionStorage.getItem(FORK_INTENT_PREFIX + token);
    if (flagged) sessionStorage.removeItem(FORK_INTENT_PREFIX + token);
    return flagged;
  } catch {
    return false;
  }
}

const NEW = '__new__';

function defaultNavigate(href: string) {
  window.location.assign(href);
}

/**
 * "Continue in my workspace": a signed-in guest takes a private copy of the
 * conversation (without the agent) into a new workspace or one of theirs.
 * Renders the header button and its dialog.
 */
export function ContinueInWorkspace({ token, navigate = defaultNavigate }: { token: string; navigate?: (href: string) => void }) {
  const t = useT();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const signedIn = !!user && !!idToken;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>(NEW);
  const [workspaces, setWorkspaces] = useState<MyWorkspace[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back from signing in to take a copy: reopen the dialog.
  useEffect(() => {
    if (!loading && signedIn && takeForkIntent(token)) setOpen(true);
  }, [loading, signedIn, token]);

  useEffect(() => {
    if (!open) { setError(null); setBusy(false); setTarget(NEW); }
  }, [open]);

  const loadWorkspaces = useCallback(async () => {
    if (!idToken) return;
    setListFailed(false);
    try {
      setWorkspaces(await listMyWorkspaces(idToken));
    } catch {
      setWorkspaces([]);
      setListFailed(true);
    }
  }, [idToken]);

  useEffect(() => {
    if (open && signedIn && workspaces === null) void loadWorkspaces();
  }, [open, signedIn, workspaces, loadWorkspaces]);

  const signInToContinue = () => {
    rememberForkIntent(token);
    goToCentralLogin(() => { void signIn(); });
  };

  const fork = async () => {
    if (!idToken) return;
    setBusy(true); setError(null);
    try {
      const result = await forkSharedThread(token, idToken, target === NEW ? null : target);
      navigate(threadPath(result.workspace.slug, result.channel.name));
    } catch (e) {
      const status = e instanceof GuestThreadError ? e.status : null;
      setError(status === 403 ? t('guestThread.forkForbidden') : t('guestThread.forkFailed'));
      setBusy(false);
    }
  };

  const option = (value: string, title: string, body: string | null, icon: React.ReactNode) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={target === value}
      disabled={busy}
      onClick={() => setTarget(value)}
      data-fork-target={value === NEW ? 'new' : value}
      className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50', target === value && 'border-primary/40 bg-muted/40')}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">{icon}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium">{title}</span>
        {body && <span className="text-xs text-muted-foreground">{body}</span>}
      </span>
      {target === value && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );

  let body: React.ReactNode;
  let footer: React.ReactNode;
  let description = t('guestThread.forkBody');
  if (loading) {
    body = <div className="flex justify-center py-6"><Spinner className="size-5 text-muted-foreground" /></div>;
    footer = null;
  } else if (!signedIn) {
    description = t('guestThread.forkSignInDescription');
    body = <p className="text-sm text-muted-foreground" data-fork-step="sign-in">{t('guestThread.forkBody')}</p>;
    footer = (
      <Button onClick={signInToContinue} data-fork-sign-in="">
        <LogIn data-icon="inline-start" />{t('guestThread.signIn')}
      </Button>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3" data-fork-step="choose">
        <div role="radiogroup" aria-label={t('guestThread.continueInWorkspace')} className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {option(NEW, t('guestThread.forkNew'), t('guestThread.forkNewBody'), <Plus className="size-4" />)}
          {workspaces === null && <div className="flex justify-center py-2"><Spinner className="size-4 text-muted-foreground" /></div>}
          {workspaces && workspaces.length > 0 && <p className="mt-1 px-1 text-xs font-medium text-muted-foreground">{t('guestThread.forkYours')}</p>}
          {workspaces?.map((w) => option(w.workspaceId, w.name || w.slug, null, <span className="text-xs font-semibold uppercase">{(w.name || w.slug).slice(0, 1)}</span>))}
        </div>
        {listFailed && <p className="text-xs text-muted-foreground">{t('guestThread.forkWorkspacesFailed')}</p>}
        {error && <Alert variant="destructive" data-fork-error=""><AlertDescription>{error}</AlertDescription></Alert>}
      </div>
    );
    footer = (
      <>
        <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
        <Button disabled={busy} onClick={() => void fork()} data-fork-continue="">
          {busy && <Spinner data-icon="inline-start" />}{t('guestThread.forkContinue')}
        </Button>
      </>
    );
  }

  return (
    <>
      <WithTooltip label={t('guestThread.continueInWorkspace')}>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={t('guestThread.continueInWorkspace')} data-fork-open="">
          <CopyPlus data-icon="inline-start" />
          <span className="hidden sm:inline">{t('guestThread.continueInWorkspace')}</span>
          <span className="sm:hidden">{t('guestThread.continueShort')}</span>
        </Button>
      </WithTooltip>
      <Dialog open={open} onOpenChange={(next) => { if (!busy || next) setOpen(next); }}>
        <DialogContent className="sm:max-w-md" data-fork-dialog="">
          <DialogHeader>
            <DialogTitle>{t('guestThread.continueInWorkspace')}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">{body}</DialogBody>
          {footer && <DialogFooter>{footer}</DialogFooter>}
        </DialogContent>
      </Dialog>
    </>
  );
}
