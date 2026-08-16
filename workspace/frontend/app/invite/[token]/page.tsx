'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, Loader2, Mail, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getInvitePeek, acceptInvite, type InvitePeek } from '@/lib/invite-api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin, goToCentralLogout } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';

/**
 * The invitee's landing page for /invite/{token} links. The token in the URL
 * is the invite's own secret — never the workspace machine token. Anyone can
 * peek (workspace name + offered role); joining requires signing in, and
 * email-bound invites additionally require the matching signed-in address.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const t = useT();
  const { user, idToken, loading: authLoading, signIn, signOut } = useOpenAgentsAuth();

  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [peekError, setPeekError] = useState(false);
  const [joining, setJoining] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvitePeek(token)
      .then((p) => { if (!cancelled) setPeek(p); })
      .catch(() => { if (!cancelled) setPeekError(true); });
    return () => { cancelled = true; };
  }, [token]);

  const join = async () => {
    if (!idToken) return;
    setJoining(true);
    setAcceptError(null);
    try {
      const result = await acceptInvite(token, idToken);
      // Member now — land in the workspace via bearer access (clean URL, no
      // credentials in the address bar).
      router.replace(`/${result.slug}`);
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : t('invitePage.acceptFailed'));
      setJoining(false);
    }
  };

  const card = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <img src="/logo-icon.png" alt="OpenAgents" className="mx-auto size-12 dark:hidden" />
        <img src="/logo-white.png" alt="OpenAgents" className="mx-auto hidden size-12 dark:block" />
        {children}
      </div>
    </div>
  );

  if (peekError) {
    return card(
      <>
        <h1 className="text-lg font-semibold">{t('invitePage.invalidTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('invitePage.invalidBody')}</p>
      </>,
    );
  }

  if (!peek || authLoading) {
    return card(<Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />);
  }

  if (peek.status !== 'pending') {
    return card(
      <>
        <h1 className="text-lg font-semibold">{t('invitePage.unavailableTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t(`invitePage.status_${peek.status}` as Parameters<typeof t>[0], {
            workspace: peek.workspaceName,
          })}
        </p>
      </>,
    );
  }

  return card(
    <>
      <h1 className="text-lg font-semibold">
        {t('invitePage.title', { workspace: peek.workspaceName })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {peek.invitedBy
          ? t('invitePage.invitedByAs', { inviter: peek.invitedBy, role: peek.role })
          : t('invitePage.invitedAs', { role: peek.role })}
      </p>
      {peek.invitedEmail && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="size-3.5" />
          {t('invitePage.boundTo', { email: peek.invitedEmail })}
        </p>
      )}

      {user && idToken ? (
        <div className="space-y-3">
          <Button className="w-full" onClick={join} disabled={joining}>
            {joining ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            {t('invitePage.join', { workspace: peek.workspaceName })}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('invitePage.signedInAs', { email: user.email })}{' '}
            <button
              className="underline hover:text-foreground"
              onClick={() => goToCentralLogout(signOut)}
            >
              {t('invitePage.switchAccount')}
            </button>
          </p>
          {acceptError && <p className="text-xs text-destructive">{acceptError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {/* goToCentralLogin round-trips back to this invite URL. */}
          <Button className="w-full" onClick={() => goToCentralLogin(signIn)}>
            <LogIn className="size-4" />
            {t('invitePage.signInToAccept')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('invitePage.signInHint')}</p>
        </div>
      )}
    </>,
  );
}
