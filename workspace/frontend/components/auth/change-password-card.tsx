'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/settings/settings-card';
import { useT } from '@/lib/i18n';
import { MIN_PASSWORD_LENGTH, changeLocalPassword, localAuthErrorKey } from '@/lib/local-auth';

/** Profile settings: change a local account's password (self-hosted local auth only). */
export function ChangePasswordCard({ idToken }: { idToken: string }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    if (!current) { setError(t('localAuth.passwordRequired')); return; }
    if (next.length < MIN_PASSWORD_LENGTH) { setError(t('localAuth.passwordTooShort', { min: MIN_PASSWORD_LENGTH })); return; }
    if (next !== confirm) { setError(t('localAuth.passwordMismatch')); return; }
    setBusy(true);
    setError('');
    try {
      await changeLocalPassword(idToken, current, next);
      setCurrent(''); setNext(''); setConfirm('');
      toast.success(t('localAuth.changed'));
    } catch (err) {
      const key = localAuthErrorKey('change', err);
      setError(key ? t(key) : err instanceof Error && err.message ? err.message : t('localAuth.genericError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title={t('localAuth.changeTitle')}
      description={t('localAuth.changeHint')}
      footer={(
        <Button size="sm" disabled={busy || !current || !next || !confirm} onClick={() => void submit()}>
          {t('localAuth.changeSubmit')}
        </Button>
      )}
    >
      <form className="flex max-w-sm flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Input type="password" autoComplete="current-password" aria-label={t('localAuth.currentPassword')} placeholder={t('localAuth.currentPassword')} value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Input type="password" autoComplete="new-password" aria-label={t('localAuth.newPassword')} placeholder={t('localAuth.newPassword')} value={next} onChange={(e) => setNext(e.target.value)} />
        <Input type="password" autoComplete="new-password" aria-label={t('localAuth.confirmPassword')} placeholder={t('localAuth.confirmPassword')} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {/* Enter submits from any field. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </SettingsCard>
  );
}
