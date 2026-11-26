'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, Check } from 'lucide-react';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { KeepConversationDialog, takeKeepIntent } from './keep-conversation-dialog';

/**
 * A workspace made by OpenAgents Jam without an account lives only behind
 * its private owner link. This banner lets the person keep it: sign in (or
 * sign up), then make it theirs or move the conversation into one of their
 * workspaces — the same choice as the owner page's "Keep this conversation".
 * Shown only to someone holding that token, and only while nobody keeps the
 * workspace yet.
 */

export type KeepState = 'hidden' | 'offer' | 'saved';

interface Props {
  workspaceId: string;
  /** Workspace slug, for the "keep" call and the thread URL after it. */
  slug?: string;
  /** The open thread; after "Make it my workspace" the page stays on it. */
  threadName?: string;
  /** The workspace token from the owner link; without it there's nothing to keep. */
  token: string;
  /** The workspace was made by OpenAgents Jam (settings.openagents_share). */
  share: boolean;
  /** Someone already keeps it (it has a creator account). */
  claimed: boolean;
}

/** Pure decision, exported for tests: what the banner shows for a workspace. */
export function initialKeepState(share: boolean, claimed: boolean, token: string): KeepState {
  return token && share && !claimed ? 'offer' : 'hidden';
}

export function KeepWorkspaceBanner({ workspaceId, slug, threadName, token, share, claimed }: Props) {
  const t = useT();
  const { user, idToken, loading } = useOpenAgentsAuth();
  const [saved, setSaved] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const network = slug || workspaceId;
  const state: KeepState = saved ? 'saved' : initialKeepState(share, claimed, token);

  // Back from signing in to keep it: reopen the choice.
  useEffect(() => {
    if (loading || !user || !idToken || state !== 'offer') return;
    if (takeKeepIntent(network)) setDialogOpen(true);
  }, [loading, user, idToken, state, network]);

  if (state === 'hidden') return null;
  if (state === 'saved') {
    return (
      <Alert role="status" className="shrink-0 rounded-none border-x-0 border-t-0 px-2 lg:px-4 border-success/30 bg-success/10">
        <Check />
        <AlertDescription className="text-xs">{t('shareKeep.saved')}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert role="status" className="shrink-0 rounded-none border-x-0 border-t-0 px-2 lg:px-4">
      <BookmarkPlus />
      <AlertDescription className="text-xs">{t('shareKeep.offer')}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
          {user ? t('shareKeep.keep') : t('shareKeep.signInToKeep')}
        </Button>
      </AlertAction>
      <KeepConversationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        network={network}
        token={token}
        threadName={threadName || ''}
        onClaimed={() => setSaved(true)}
      />
    </Alert>
  );
}
