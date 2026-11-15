'use client';

import { useState } from 'react';
import { Check, Mail } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { useIsMobileDevice } from '@/hooks/use-mobile-device';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { sendSetupEmail } from '@/lib/account-api';
import { capture } from '@/lib/analytics';

/** A phone user can continue setup later on the computer that will run agents. */
export function SetupEmailButton() {
  const t = useT();
  const isMobile = useIsMobileDevice();
  const { idToken } = useOpenAgentsAuth();
  const { workspace } = useWorkspace();
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  if (!isMobile || !idToken || !workspace) return null;

  const send = async () => {
    if (state !== 'idle') return;
    setState('sending');
    try {
      const result = await sendSetupEmail(idToken, workspace.slug);
      if (!result.emailSent) throw new Error('Setup email was not sent');
      setState('sent');
      capture('setup_email_sent', { source: 'guided_wizard', is_mobile: true });
    } catch {
      toast.error(t('onboarding.setupEmailFailed'));
      setState('idle');
    }
  };

  return state === 'sent' ? (
    <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-success/30 bg-success/5 px-4 py-3.5 text-sm font-medium text-success">
      <Check className="size-4 shrink-0" />{t('onboarding.setupEmailSent')}
    </div>
  ) : (
    <button
      type="button"
      onClick={send}
      disabled={state !== 'idle'}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
    >
      {state === 'sending' ? <Spinner /> : <Mail className="size-4" />}
      {t(state === 'sending' ? 'onboarding.setupEmailSending' : 'onboarding.setupEmailCta')}
    </button>
  );
}
