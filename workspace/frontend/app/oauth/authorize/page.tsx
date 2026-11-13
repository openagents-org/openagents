'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Loader2, LogIn, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { approveOAuth } from '@/lib/account-api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';

/**
 * OAuth consent for the agent hub. The backend's /oauth/authorize validates
 * the client and redirect address, then sends the person here, where they are
 * signed in to OpenAgents. Allow or Cancel goes to POST /v1/oauth/approve,
 * which answers with the client's redirect (carrying a code or access_denied).
 */
function Consent() {
  const t = useT();
  const params = useSearchParams();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const [busy, setBusy] = useState<'allow' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const challenge = params.get('code_challenge') || '';
  const method = params.get('code_challenge_method') || '';
  const clientName = params.get('client_name') || clientId;
  const complete = Boolean(clientId && redirectUri && challenge && method === 'S256');

  const answer = async (approve: boolean) => {
    if (!idToken) return;
    setBusy(approve ? 'allow' : 'cancel');
    setError(null);
    try {
      const { redirect } = await approveOAuth(idToken, {
        client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: method,
        state: params.get('state') || undefined, approve,
      });
      window.location.assign(redirect);
    } catch (e) {
      setError(t('hubApps.consentFailed', { error: e instanceof Error ? e.message : String(e) }));
      setBusy(null);
    }
  };

  let body: React.ReactNode;
  if (!complete) {
    body = <p className="text-sm text-muted-foreground">{t('hubApps.consentInvalid')}</p>;
  } else if (loading) {
    body = <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />;
  } else if (!user) {
    body = (
      <Button onClick={() => goToCentralLogin(signIn)} className="w-full">
        <LogIn className="size-4" />{t('userMenu.signIn')}
      </Button>
    );
  } else {
    body = (
      <div className="space-y-5">
        <p className="text-sm">{t('hubApps.consentLead', { name: clientName, email: user.email || '' })}</p>
        <ul className="space-y-2 text-sm">
          {[t('hubApps.consentSee'), t('hubApps.consentStart')].map((line) => (
            <li key={line} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{line}</li>
          ))}
        </ul>
        <p className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <ShieldAlert className="size-4 shrink-0" />{t('hubApps.consentWarning')}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" disabled={busy !== null} onClick={() => answer(false)}>
            {busy === 'cancel' && <Loader2 className="size-4 animate-spin" />}{t('hubApps.cancel')}
          </Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => answer(true)}>
            {busy === 'allow' && <Loader2 className="size-4 animate-spin" />}{t('hubApps.allow')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md space-y-5 rounded-xl border bg-background p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{t('hubApps.consentTitle', { name: clientName })}</h1>
        {body}
      </div>
    </main>
  );
}

export default function OAuthAuthorizePage() {
  return <Suspense><Consent /></Suspense>;
}
