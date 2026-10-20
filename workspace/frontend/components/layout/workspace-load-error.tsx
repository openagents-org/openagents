'use client';

import { useState } from 'react';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';

export function WorkspaceLoadError({ status, onRetry }: {
  status: number | null;
  onRetry: () => void;
}) {
  const t = useT();
  const { user, signIn } = useOpenAgentsAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const accessError = status === 401 || status === 403;
  const notFound = status === 404;
  const title = notFound ? t('workspaceGate.notFoundTitle')
    : accessError ? t('workspaceGate.accessRequiredTitle') : t('admin.loadFailed');
  const body = notFound ? t('workspaceGate.notFoundBody')
    : accessError ? t('workspaceGate.accessRequiredBody')
    : status !== null ? t('workspaceGate.serviceFailedBody') : t('workspaceGate.loadFailedBody');

  async function chooseAccount() {
    setSigningIn(true);
    setSignInFailed(false);
    try {
      // The existing sign-in flow prompts for an account. Keep the current
      // identity until it succeeds; never fall back to token-only access.
      await signIn();
    } catch {
      setSignInFailed(true);
    } finally {
      setSigningIn(false);
    }
  }

  return <div role="alert" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-background p-6 text-center">
    <h1 className="text-lg font-semibold">{title}</h1>
    <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    {accessError && user?.email && <p className="text-sm">{t('workspaceGate.currentAccount', { email: user.email })}</p>}
    {signInFailed && <p className="text-sm text-destructive">{t('workspaceGate.googleAuthFailed')}</p>}
    <div className="flex flex-wrap justify-center gap-2">
      {accessError && <button type="button" onClick={chooseAccount} disabled={signingIn}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {signingIn ? t('auth.signingIn') : user ? t('workspaceGate.chooseAccount') : t('workspaceGate.logIn')}
      </button>}
      {!notFound && <button type="button" onClick={onRetry} disabled={signingIn}
        className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50">{t('common.retry')}</button>}
      <a href="/" className="rounded-md border px-4 py-2 text-sm font-medium">{t('workspaceGate.goHome')}</a>
    </div>
  </div>;
}
