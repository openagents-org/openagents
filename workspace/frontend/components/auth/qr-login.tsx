'use client';

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { desktopHost } from '@/lib/desktop-host';
import {
  applyQrLoginParam, pollQrLogin, qrLoginEnabled, startQrLogin,
  type QrLoginRequest, type QrLoginStatus,
} from '@/lib/qr-login';

/** Fresh codes shown in a row before waiting for a click — nobody is looking. */
const MAX_AUTO_RENEWALS = 4;

/**
 * Whether the QR option belongs on this page: turned on for testing (see
 * lib/qr-login) and not inside the desktop app, whose own sign-in form offers
 * it there.
 */
export function useQrLoginOption(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    applyQrLoginParam(window.location.search);
    setEnabled(qrLoginEnabled() && !desktopHost());
  }, []);
  return enabled;
}

/**
 * The QR code a phone scans to sign this browser in. Signing in goes through
 * the auth context (adoptWorkspaceSession), so the page re-renders signed in
 * exactly as after any other login.
 */
export function QrLoginPanel({ onSignedIn }: { onSignedIn?: () => void }) {
  const t = useT();
  const { adoptWorkspaceSession } = useOpenAgentsAuth();
  const [req, setReq] = useState<QrLoginRequest | null>(null);
  const [status, setStatus] = useState<QrLoginStatus | 'loading' | 'error'>('loading');
  const [error, setError] = useState('');
  const renewals = useRef(0);
  const [generation, setGeneration] = useState(0);
  // Bumped after every poll: the status often comes back unchanged, and the
  // next poll must still be scheduled.
  const [tick, setTick] = useState(0);

  // Ask for a request (again on every `generation`).
  useEffect(() => {
    let live = true;
    setStatus('loading');
    setError('');
    startQrLogin('web').then(
      (r) => { if (live) { setReq(r); setStatus('pending'); } },
      (e) => { if (live) { setStatus('error'); setError(e instanceof Error ? e.message : ''); } },
    );
    return () => { live = false; };
  }, [generation]);

  // Poll it until it is approved, cancelled or expired.
  useEffect(() => {
    if (!req || (status !== 'pending' && status !== 'scanned')) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await pollQrLogin(req);
        if (!live) return;
        if (result.status === 'approved' && result.session) {
          setStatus('approved');
          adoptWorkspaceSession(result.session);
          onSignedIn?.();
        } else if (result.status === 'expired' && status === 'pending' && renewals.current < MAX_AUTO_RENEWALS) {
          renewals.current += 1;
          setGeneration((g) => g + 1);
        } else {
          setStatus(result.status);
          setTick((n) => n + 1);
        }
      } catch {
        // A dropped poll is retried on the next tick; the code is still valid.
        if (live) setTick((n) => n + 1);
      }
    }, req.pollIntervalMs);
    return () => { live = false; clearTimeout(timer); };
  }, [req, status, tick, adoptWorkspaceSession, onSignedIn]);

  const renew = () => { renewals.current = 0; setGeneration((g) => g + 1); };
  const faded = status === 'scanned' || status === 'expired' || status === 'cancelled' || status === 'approved';

  return (
    <div className="flex flex-col items-center gap-3" data-testid="qr-login-panel">
      <div className="relative rounded-xl border bg-white p-3">
        {req ? (
          <QRCodeSVG value={req.qrUrl} size={184} level="M" marginSize={1} className={faded ? 'opacity-15' : ''} />
        ) : (
          <div className="size-[184px] animate-pulse rounded bg-neutral-100" />
        )}
        {faded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm font-medium text-neutral-900">
            {status === 'scanned' && <><Smartphone className="size-7" />{t('qrLogin.scanned')}</>}
            {status === 'approved' && <><CheckCircle2 className="size-7 text-green-600" />{t('qrLogin.signingIn')}</>}
            {(status === 'expired' || status === 'cancelled') && (
              <button type="button" onClick={renew} className="flex flex-col items-center gap-2 underline-offset-4 hover:underline">
                <RefreshCw className="size-6" />
                {t(status === 'expired' ? 'qrLogin.expired' : 'qrLogin.cancelled')}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="max-w-[16rem] text-center text-sm text-muted-foreground">
        {status === 'scanned' ? t('qrLogin.confirmOnPhone') : t('qrLogin.instructions')}
      </p>
      {status === 'error' && (
        <p role="alert" className="max-w-xs text-center text-sm text-destructive">
          {error || t('qrLogin.unavailable')}{' '}
          <button type="button" onClick={renew} className="underline underline-offset-4">{t('qrLogin.retry')}</button>
        </p>
      )}
    </div>
  );
}

/** "Log in with QR code" under a sign-in gate's main button; nothing when the option is off. */
export function QrLoginOption({ onSignedIn }: { onSignedIn?: () => void }) {
  const t = useT();
  const enabled = useQrLoginOption();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        data-testid="qr-login-open"
      >
        <QrCode className="size-4" />
        {t('qrLogin.open')}
      </button>
    );
  }
  return <QrLoginPanel onSignedIn={onSignedIn} />;
}
