'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Monitor, XCircle } from 'lucide-react';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT, type MessageKey } from '@/lib/i18n';
import { answerQrLogin, qrLoginIdFrom, type QrLoginSummary } from '@/lib/qr-login';
import { Button } from '@/components/ui/button';

/**
 * Where a login QR code points (…/qr-login?id=…). The OpenAgents app reads the
 * id itself and confirms natively; this page is the same confirmation for a
 * phone that opens the link in its browser instead — signed in to the
 * workspace there, it approves exactly as the app would.
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'confirm'; summary: QrLoginSummary }
  | { kind: 'busy'; summary: QrLoginSummary }
  | { kind: 'done'; approved: boolean; summary: QrLoginSummary }
  | { kind: 'error'; key: MessageKey };

function errorKey(e: unknown): MessageKey {
  const status = (e as { status?: number })?.status;
  if (status === 410) return 'qrLogin.phoneExpired';
  if (status === 409) return 'qrLogin.phoneUsed';
  return 'qrLogin.phoneFailed';
}

export default function QrLoginConfirmPage() {
  const t = useT();
  const { user, idToken, loading, signIn } = useOpenAgentsAuth();
  const [id, setId] = useState<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const scanned = useRef(false);

  useEffect(() => { setId(qrLoginIdFrom(window.location.search)); }, []);

  // Claim the code for this account as soon as we know who that is.
  useEffect(() => {
    if (!id || !idToken || scanned.current) return;
    scanned.current = true;
    answerQrLogin(id, 'scan', idToken).then(
      (summary) => setPhase({ kind: 'confirm', summary }),
      (e) => setPhase({ kind: 'error', key: errorKey(e) }),
    );
  }, [id, idToken]);

  const answer = async (approve: boolean) => {
    if (!id || !idToken || phase.kind !== 'confirm') return;
    const summary = phase.summary;
    setPhase({ kind: 'busy', summary });
    try {
      await answerQrLogin(id, approve ? 'approve' : 'cancel', idToken);
      setPhase({ kind: 'done', approved: approve, summary });
    } catch (e) {
      setPhase({ kind: 'error', key: errorKey(e) });
    }
  };

  let body: React.ReactNode;
  if (id === null) {
    body = <p className="text-sm text-muted-foreground">{t('qrLogin.phoneBadLink')}</p>;
  } else if (loading || id === undefined) {
    body = <p className="text-sm text-muted-foreground">{t('qrLogin.phoneLoading')}</p>;
  } else if (!user || !idToken) {
    body = (
      <>
        <p className="text-sm text-muted-foreground">{t('qrLogin.phoneSignInFirst')}</p>
        <Button onClick={() => goToCentralLogin(() => void signIn())}>{t('workspaceGate.logIn')}</Button>
      </>
    );
  } else if (phase.kind === 'error') {
    body = (
      <>
        <XCircle className="size-10 text-destructive" />
        <p className="text-sm text-muted-foreground">{t(phase.key)}</p>
      </>
    );
  } else if (phase.kind === 'done') {
    body = phase.approved ? (
      <>
        <CheckCircle2 className="size-10 text-green-600" />
        <p className="text-sm text-muted-foreground">{t('qrLogin.phoneApproved', { device: phase.summary.device })}</p>
      </>
    ) : (
      <p className="text-sm text-muted-foreground">{t('qrLogin.phoneCancelled')}</p>
    );
  } else if (phase.kind === 'confirm' || phase.kind === 'busy') {
    const busy = phase.kind === 'busy';
    body = (
      <>
        <Monitor className="size-10" />
        <h1 className="text-lg font-semibold">{t('qrLogin.phoneTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('qrLogin.phoneBody', { device: phase.summary.device, email: user.email })}
        </p>
        <p className="text-xs text-muted-foreground">{t('qrLogin.phoneWarning')}</p>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Button disabled={busy} onClick={() => void answer(true)} data-testid="qr-login-approve">{t('qrLogin.phoneApprove')}</Button>
          <Button disabled={busy} variant="outline" onClick={() => void answer(false)}>{t('qrLogin.phoneCancel')}</Button>
        </div>
      </>
    );
  } else {
    body = <p className="text-sm text-muted-foreground">{t('qrLogin.phoneLoading')}</p>;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
      {body}
    </main>
  );
}
