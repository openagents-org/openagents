'use client';
import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/reui/button';
import { Spinner } from '@/components/ui/spinner';
import { LocalAuthForm } from '@/components/auth/local-auth-form';
import { inviteTokenFrom, safeReturnTo } from '@/lib/local-auth';

function Login() {
  const t = useT();
  const { user, idToken, loading, signIn, authMode, authConfig, adoptWorkspaceSession } = useOpenAgentsAuth();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Only same-origin application paths may be used as the return destination.
  const returnTo = safeReturnTo(params.get('returnTo'));
  useEffect(() => { if (!loading && user && idToken) window.location.replace(returnTo); }, [loading, user, idToken, returnTo]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-background"><Spinner className="size-5 text-muted-foreground" /></main>;
  }

  // Self-hosted instance with local accounts: email/password on this origin.
  if (authMode === 'local') {
    return <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8">
      <div className="flex flex-col items-center gap-3">
        <Image src="/logo-icon.png" alt="OpenAgents" width={40} height={40} />
        <h1 className="text-xl font-semibold">{t('localAuth.title')}</h1>
      </div>
      <LocalAuthForm
        config={authConfig}
        inviteToken={inviteTokenFrom(params)}
        onSession={(session) => {
          adoptWorkspaceSession(session);
          window.location.replace(returnTo);
        }}
      />
    </main>;
  }

  return <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-8">
    <h1 className="text-xl font-semibold">{t('workspaceGate.signInTitle')}</h1>
    <p className="max-w-md text-center text-sm text-muted-foreground">{t('workspaceGate.signInBody')}</p>
    <Button disabled={loading || busy} onClick={async () => {
      setBusy(true); setError('');
      try { await signIn(); } catch (e) { setError(e instanceof Error ? e.message : t('workspaceGate.loadFailedTitle')); }
      finally { setBusy(false); }
    }}>{t('workspaceGate.logIn')}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </main>;
}
export default function LoginPage() { return <Suspense><Login /></Suspense>; }
