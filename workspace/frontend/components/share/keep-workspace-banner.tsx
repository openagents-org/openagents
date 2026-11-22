'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookmarkPlus, Check } from 'lucide-react';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getApiBaseUrl } from '@/lib/api-base';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

/**
 * A workspace made by OpenAgents Share without an account lives only behind
 * its private owner link. This banner lets the person keep it: sign in (or
 * sign up), then claim it with the owner link's token (POST
 * /v1/guest-links/claim). Shown only to someone holding that token, and only
 * while nobody keeps the workspace yet.
 */

const KEEP_FLAG = 'oa-share-keep:';

export type KeepState = 'hidden' | 'offer' | 'saving' | 'saved' | 'taken' | 'error';

interface Props {
  workspaceId: string;
  /** The workspace token from the owner link; without it there's nothing to keep. */
  token: string;
  /** The workspace was made by OpenAgents Share (settings.openagents_share). */
  share: boolean;
  /** Someone already keeps it (it has a creator account). */
  claimed: boolean;
}

async function call(path: string, init: RequestInit, token: string, idToken: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Workspace-Token': token };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers, cache: 'no-store' });
  const body = await res.json().catch(() => null);
  return { status: res.status, data: body?.data ?? null };
}

/** Pure decision, exported for tests: what the banner shows for a workspace. */
export function initialKeepState(share: boolean, claimed: boolean, token: string): KeepState {
  return token && share && !claimed ? 'offer' : 'hidden';
}

export function KeepWorkspaceBanner({ workspaceId, token, share, claimed }: Props) {
  const t = useT();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const [state, setState] = useState<KeepState>('hidden');

  const claim = useCallback(async () => {
    setState('saving');
    try {
      const r = await call('/v1/guest-links/claim', { method: 'POST', body: JSON.stringify({ network: workspaceId }) }, token, idToken);
      if (r.status === 200) setState('saved');
      else if (r.status === 409) setState('taken');
      else setState('error');
    } catch {
      setState('error');
    }
  }, [workspaceId, token, idToken]);

  useEffect(() => {
    if (loading) return;
    const next = initialKeepState(share, claimed, token);
    setState((prev) => (prev === 'saved' || prev === 'saving' || prev === 'taken' ? prev : next));
    // Back from signing in to keep it: finish the job without a second click.
    if (next === 'offer' && user && idToken) {
      let flagged = false;
      try { flagged = !!sessionStorage.getItem(KEEP_FLAG + workspaceId); } catch { /* private mode */ }
      if (flagged) {
        try { sessionStorage.removeItem(KEEP_FLAG + workspaceId); } catch { /* private mode */ }
        void claim();
      }
    }
  }, [workspaceId, token, share, claimed, loading, user, idToken, claim]);

  const onKeep = () => {
    if (user && idToken) { void claim(); return; }
    try { sessionStorage.setItem(KEEP_FLAG + workspaceId, '1'); } catch { /* private mode */ }
    goToCentralLogin(() => { void signIn(); }, { forceCentral: false });
  };

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
      <AlertDescription className="text-xs">
        {state === 'taken' ? t('shareKeep.taken') : state === 'error' ? t('shareKeep.error') : t('shareKeep.offer')}
      </AlertDescription>
      {(state === 'offer' || state === 'saving' || state === 'error') && (
        <AlertAction>
          <Button size="sm" variant="outline" onClick={onKeep} disabled={state === 'saving'}>
            {user ? t('shareKeep.keep') : t('shareKeep.signInToKeep')}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
