'use client';
import { Suspense, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MIN_PASSWORD_LENGTH, localAuthErrorKey, resetPassword } from '@/lib/local-auth';

/** Landing page for a local-account password reset link: /reset-password?token=… */
function ResetPassword() {
  const t = useT();
  const { adoptWorkspaceSession } = useOpenAgentsAuth();
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD_LENGTH) { setError(t('localAuth.passwordTooShort', { min: MIN_PASSWORD_LENGTH })); return; }
    if (password !== confirm) { setError(t('localAuth.passwordMismatch')); return; }
    setBusy(true);
    setError('');
    try {
      adoptWorkspaceSession(await resetPassword(token, password));
      window.location.replace('/');
    } catch (err) {
      const key = localAuthErrorKey('reset', err);
      setError(key ? t(key) : err instanceof Error && err.message ? err.message : t('localAuth.genericError'));
      setBusy(false);
    }
  };

  return <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8">
    <div className="flex flex-col items-center gap-3">
      <Image src="/logo-icon.png" alt="OpenAgents" width={40} height={40} />
      <h1 className="text-xl font-semibold">{t('localAuth.resetTitle')}</h1>
    </div>
    {!token ? (
      <p role="alert" className="max-w-sm text-center text-sm text-destructive">{t('localAuth.resetMissingToken')}</p>
    ) : (
      <form className="flex w-full max-w-sm flex-col gap-3" onSubmit={submit} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password">{t('localAuth.newPassword')}</Label>
          <Input id="reset-password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t('localAuth.passwordHint', { min: MIN_PASSWORD_LENGTH })}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-confirm">{t('localAuth.confirmPassword')}</Label>
          <Input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy}>{t('localAuth.resetSubmit')}</Button>
      </form>
    )}
    <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground hover:underline">{t('localAuth.backToSignIn')}</Link>
  </main>;
}

export default function ResetPasswordPage() { return <Suspense><ResetPassword /></Suspense>; }
