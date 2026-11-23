'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookmarkPlus, Check, FolderInput, LogIn } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { claimShare, importShare, listMyWorkspaces, threadPath, type MyWorkspace } from '@/lib/share-room-api';
import { cn } from '@/lib/utils';

/**
 * "Keep this conversation" for a workspace made by OpenAgents Share:
 * sign in (or sign up) first, then either make the share workspace your own
 * (POST /v1/guest-links/claim) or move the conversation into one of your
 * workspaces (POST /v1/guest-links/import). Both send the owner link's
 * workspace token and the account's bearer.
 */

const KEEP_INTENT_PREFIX = 'oa-share-keep-intent:';

/** Remember that the person was keeping this share when they left to sign in. */
export function rememberKeepIntent(network: string): void {
  try { sessionStorage.setItem(KEEP_INTENT_PREFIX + network, '1'); } catch { /* private mode */ }
}

/** Was a keep interrupted by signing in? Reading clears it. */
export function takeKeepIntent(network: string): boolean {
  try {
    const flagged = !!sessionStorage.getItem(KEEP_INTENT_PREFIX + network);
    if (flagged) sessionStorage.removeItem(KEEP_INTENT_PREFIX + network);
    return flagged;
  } catch {
    return false;
  }
}

/** Server message for a failed call, as plain text. */
function messageOf(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return message && !/^HTTP \d+$/.test(message) && message !== 'Network error' ? message : fallback;
}

type Busy = null | 'claim' | 'import' | 'list';

interface KeepConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The share workspace's slug (sent as `network`). */
  network: string;
  /** The owner link's workspace token. */
  token: string;
  /** The shared thread, for the full-workspace URL after keeping. */
  threadName: string;
  /** After "Make it my workspace" succeeds; default opens the thread in the full workspace. */
  onClaimed?: () => void;
  /** Leaves the page; replaceable in tests. */
  navigate?: (href: string) => void;
}

function defaultNavigate(href: string) {
  window.location.assign(href);
}

export function KeepConversationDialog({ open, onOpenChange, network, token, threadName, onClaimed, navigate = defaultNavigate }: KeepConversationDialogProps) {
  const t = useT();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const signedIn = !!user && !!idToken;
  const [step, setStep] = useState<'choose' | 'pick'>('choose');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<MyWorkspace[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setStep('choose'); setError(null); setBusy(null); setTarget(null); }
  }, [open]);

  // Signed in while the dialog is open (e.g. the localhost popup): the
  // sign-in intent is used up.
  useEffect(() => {
    if (open && signedIn) takeKeepIntent(network);
  }, [open, signedIn, network]);

  const creds = { slug: network, token };

  const signInToKeep = () => {
    rememberKeepIntent(network);
    goToCentralLogin(() => { void signIn(); });
  };

  const claim = async () => {
    if (!idToken) return;
    setBusy('claim'); setError(null);
    try {
      await claimShare(creds, idToken);
      if (onClaimed) { onClaimed(); onOpenChange(false); setBusy(null); return; }
      navigate(threadPath(network, threadName));
    } catch (e) {
      setError(messageOf(e, t('shareRoom.keepFailed')));
      setBusy(null);
    }
  };

  const loadWorkspaces = useCallback(async () => {
    if (!idToken) return;
    setBusy('list'); setError(null);
    try {
      const list = (await listMyWorkspaces(idToken)).filter((w) => w.slug !== network && w.workspaceId !== network);
      setWorkspaces(list);
      setTarget((prev) => prev ?? (list.length === 1 ? list[0].workspaceId : null));
    } catch (e) {
      setError(messageOf(e, t('shareRoom.workspacesFailed')));
    } finally {
      setBusy(null);
    }
  }, [idToken, network, t]);

  const pickWorkspace = () => {
    setStep('pick');
    void loadWorkspaces();
  };

  const moveConversation = async () => {
    if (!idToken || !target) return;
    setBusy('import'); setError(null);
    try {
      const result = await importShare(creds, target, idToken);
      navigate(threadPath(result.workspace.slug, result.channel.name));
    } catch (e) {
      setError(messageOf(e, t('shareRoom.keepFailed')));
      setBusy(null);
    }
  };

  const failure = error && (
    <Alert variant="destructive" data-keep-error="">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );

  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  let description = t('shareRoom.keepDescription');
  if (loading) {
    body = <div className="flex justify-center py-6"><Spinner className="size-5 text-muted-foreground" /></div>;
  } else if (!signedIn) {
    description = t('shareRoom.keepSignInDescription');
    body = <p className="text-sm text-muted-foreground" data-keep-step="sign-in">{t('shareRoom.keepSignInBody')}</p>;
    footer = (
      <Button onClick={signInToKeep} data-keep-sign-in="">
        <LogIn data-icon="inline-start" />{t('shareRoom.signIn')}
      </Button>
    );
  } else if (step === 'choose') {
    body = (
      <div className="flex flex-col gap-3" data-keep-step="choose">
        <ItemGroup className="gap-2">
          <Item asChild variant="outline">
            <button type="button" className="text-left hover:bg-muted disabled:opacity-60" disabled={!!busy} onClick={() => void claim()} data-keep-choice="claim">
              <ItemMedia variant="icon"><BookmarkPlus /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('shareRoom.makeMine')}</ItemTitle>
                <ItemDescription>{t('shareRoom.makeMineBody')}</ItemDescription>
              </ItemContent>
              {busy === 'claim' && <ItemActions><Spinner className="size-4" /></ItemActions>}
            </button>
          </Item>
          <Item asChild variant="outline">
            <button type="button" className="text-left hover:bg-muted disabled:opacity-60" disabled={!!busy} onClick={pickWorkspace} data-keep-choice="import">
              <ItemMedia variant="icon"><FolderInput /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t('shareRoom.addToMine')}</ItemTitle>
                <ItemDescription>{t('shareRoom.addToMineBody')}</ItemDescription>
              </ItemContent>
            </button>
          </Item>
        </ItemGroup>
        {failure}
      </div>
    );
  } else {
    description = t('shareRoom.addToMineBody');
    body = (
      <div className="flex flex-col gap-3" data-keep-step="pick">
        {busy === 'list' && !workspaces && <div className="flex justify-center py-4"><Spinner className="size-5 text-muted-foreground" /></div>}
        {workspaces && workspaces.length === 0 && <p className="text-sm text-muted-foreground">{t('shareRoom.noWorkspaces')}</p>}
        {workspaces && workspaces.length > 0 && (
          <div role="radiogroup" aria-label={t('shareRoom.pickWorkspace')} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {workspaces.map((w) => (
              <button
                key={w.workspaceId}
                type="button"
                role="radio"
                aria-checked={target === w.workspaceId}
                disabled={busy === 'import'}
                onClick={() => setTarget(w.workspaceId)}
                data-keep-workspace={w.workspaceId}
                className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted', target === w.workspaceId && 'border-primary/50 bg-primary/5')}
              >
                <span className="min-w-0 flex-1 truncate">{w.name || w.slug}</span>
                {target === w.workspaceId && <Check className="size-4 text-primary" />}
              </button>
            ))}
          </div>
        )}
        {failure}
      </div>
    );
    footer = (
      <>
        <Button variant="outline" disabled={busy === 'import'} onClick={() => { setStep('choose'); setError(null); }}>{t('shareRoom.back')}</Button>
        <Button disabled={!target || !!busy} onClick={() => void moveConversation()} data-keep-move="">
          {busy === 'import' && <Spinner data-icon="inline-start" />}{t('shareRoom.moveHere')}
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy || next) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md" data-keep-dialog="">
        <DialogHeader>
          <DialogTitle>{t('shareRoom.keepTitle')}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">{body}</DialogBody>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
