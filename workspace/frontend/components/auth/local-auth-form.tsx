'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';
import type { AuthConfig } from '@/lib/auth-config';
import type { WorkspaceSession } from '@/lib/workspace-session';
import {
  MIN_PASSWORD_LENGTH, localAuthErrorKey, localLogin, localSignup, requestPasswordReset,
  validateLocalAuthForm, type LocalAuthForm,
} from '@/lib/local-auth';

export const RESET_PASSWORD_COMMAND = 'python -m app.cli.local_auth reset-password';

/**
 * Email/password sign-in for a self-hosted instance (local accounts).
 * Sign in / Create account / Forgot password, driven by the backend's
 * /v1/auth/config: account creation shows only while sign-up is open or the
 * person arrived with an invitation.
 */
export function LocalAuthForm({ config, inviteToken, onSession }: {
  config: AuthConfig | null;
  inviteToken: string | null;
  onSession: (session: WorkspaceSession) => void;
}) {
  const t = useT();
  const canSignUp = !!config?.signupOpen || !!inviteToken;
  const [form, setForm] = useState<LocalAuthForm>(inviteToken && canSignUp ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  const switchTo = (next: LocalAuthForm) => {
    setForm(next);
    setError('');
    setResetSentTo(null);
    setPassword('');
    setConfirm('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const invalid = validateLocalAuthForm(form, { email, password, confirm: form === 'signup' ? confirm : undefined });
    if (invalid) { setError(t(invalid, { min: MIN_PASSWORD_LENGTH })); return; }
    setBusy(true);
    setError('');
    const address = email.trim();
    try {
      if (form === 'forgot') {
        await requestPasswordReset(address);
        setResetSentTo(address);
      } else if (form === 'signin') {
        onSession(await localLogin(address, password));
      } else {
        onSession(await localSignup({ email: address, password, displayName, inviteToken }));
      }
    } catch (err) {
      const key = localAuthErrorKey(form, err);
      setError(key ? t(key) : err instanceof Error && err.message ? err.message : t('localAuth.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const tab = (value: LocalAuthForm, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={form === value}
      onClick={() => switchTo(value)}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        form === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {form !== 'forgot' && canSignUp && (
        <div role="tablist" className="flex gap-1 rounded-lg bg-muted p-1">
          {tab('signin', t('localAuth.signInTab'))}
          {tab('signup', t('localAuth.signUpTab'))}
        </div>
      )}

      {inviteToken && form !== 'forgot' && (
        <p className="text-center text-sm text-muted-foreground">{t('localAuth.invitedHint')}</p>
      )}

      {form === 'forgot' && (
        <div className="flex flex-col gap-1 text-center">
          <h2 className="text-base font-semibold">{t('localAuth.forgotTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {config?.emailEnabled === false ? t('localAuth.resetNoEmail') : t('localAuth.forgotBody')}
          </p>
          {config?.emailEnabled === false && (
            <code className="mt-2 rounded bg-muted px-2 py-1 text-xs">{RESET_PASSWORD_COMMAND} &lt;email&gt;</code>
          )}
        </div>
      )}

      {resetSentTo ? (
        <p role="status" className="text-center text-sm">{t('localAuth.resetSent', { email: resetSentTo })}</p>
      ) : (form !== 'forgot' || config?.emailEnabled !== false) && (
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="local-auth-email">{t('localAuth.email')}</Label>
            <Input
              id="local-auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          {form === 'signup' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="local-auth-name">{t('localAuth.displayName')}</Label>
              <Input
                id="local-auth-name"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
              />
            </div>
          )}
          {form !== 'forgot' && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="local-auth-password">{t('localAuth.password')}</Label>
                {form === 'signin' && (
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => switchTo('forgot')}>
                    {t('localAuth.forgot')}
                  </button>
                )}
              </div>
              <Input
                id="local-auth-password"
                type="password"
                autoComplete={form === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {form === 'signup' && (
                <p className="text-xs text-muted-foreground">{t('localAuth.passwordHint', { min: MIN_PASSWORD_LENGTH })}</p>
              )}
            </div>
          )}
          {form === 'signup' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="local-auth-confirm">{t('localAuth.confirmPassword')}</Label>
              <Input
                id="local-auth-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>
            {form === 'signin' ? t('localAuth.submitSignIn') : form === 'signup' ? t('localAuth.submitSignUp') : t('localAuth.sendReset')}
          </Button>
        </form>
      )}

      {form === 'forgot' ? (
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground hover:underline" onClick={() => switchTo('signin')}>
          {t('localAuth.backToSignIn')}
        </button>
      ) : !canSignUp && (
        <p className="text-center text-xs text-muted-foreground">{t('localAuth.signupClosedHint')}</p>
      )}
    </div>
  );
}
