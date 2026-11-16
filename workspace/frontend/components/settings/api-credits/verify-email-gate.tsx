'use client';

import { useState } from 'react';
import { Gift, MailWarning } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { resendVerificationEmail } from '@/lib/account-api';
import { useT } from '@/lib/i18n';

/** Verified-email gate: no key, no missions until the address is confirmed. */
export function VerifyEmailGate({
  email,
  idToken,
  allowance,
  cap,
}: {
  email: string;
  idToken: string | null;
  allowance?: number;
  cap?: number;
}) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'already' | 'failed'>('idle');
  const resend = async () => {
    if (!idToken) { setState('failed'); return; }
    setState('sending');
    try {
      const r = await resendVerificationEmail(idToken);
      setState(r.alreadyVerified ? 'already' : r.sent ? 'sent' : 'failed');
    } catch {
      setState('failed');
    }
  };
  return (
    <Alert role="status" className="border-warning/30 bg-warning/10">
      <MailWarning className="text-warning" />
      <AlertTitle className="text-warning">{t('campaign.verifyTitle')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>
          {allowance && allowance > 0
            ? t('campaign.verifyBodyAllowance', { email, allowance, cap: cap ?? 100 })
            : t('campaign.verifyBody', { email })}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={resend} disabled={state === 'sending' || state === 'sent'} variant="outline" size="sm">
            {state === 'sending' ? <Spinner data-icon="inline-start" /> : <Gift data-icon="inline-start" />}
            {t('campaign.verifyResend')}
          </Button>
          {state === 'sent' && <span className="text-xs text-success">{t('campaign.verifySent')}</span>}
          {state === 'already' && <span className="text-xs text-success">{t('campaign.verifyAlready')}</span>}
          {state === 'failed' && <span className="text-xs text-warning">{t('campaign.verifyFailed')}</span>}
        </div>
      </AlertDescription>
    </Alert>
  );
}
