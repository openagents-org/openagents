'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
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

  return <Empty role="alert" className="fixed inset-0 z-50 overflow-y-auto rounded-none bg-background">
    <EmptyHeader>
      <EmptyTitle className="text-lg font-semibold">{title}</EmptyTitle>
      <EmptyDescription>{body}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      {accessError && user?.email && <p>{t('workspaceGate.currentAccount', { email: user.email })}</p>}
      {signInFailed && <p className="text-destructive">{t('workspaceGate.googleAuthFailed')}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {accessError && <Button onClick={chooseAccount} disabled={signingIn}>
          {signingIn ? t('auth.signingIn') : user ? t('workspaceGate.chooseAccount') : t('workspaceGate.logIn')}
        </Button>}
        {!notFound && <Button variant="outline" onClick={onRetry} disabled={signingIn}>{t('common.retry')}</Button>}
        <Button variant="outline" asChild><a href="/">{t('workspaceGate.goHome')}</a></Button>
      </div>
    </EmptyContent>
  </Empty>;
}
