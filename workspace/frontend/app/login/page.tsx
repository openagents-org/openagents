'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

function Login() {
  const t = useT();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const target = params.get('returnTo') || '/';
  // Only same-origin application paths may be used as the return destination.
  const returnTo = target.startsWith('/') && !target.startsWith('//') && !target.includes('\\') && !target.startsWith('/login') ? target : '/';
  useEffect(() => { if (!loading && user && idToken) window.location.replace(returnTo); }, [loading, user, idToken, returnTo]);
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
