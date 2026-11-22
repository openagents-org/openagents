'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/responsive-dialog';
import { useT } from '@/lib/i18n';
import { GUEST_NAME_MAX, normalizeGuestName } from '@/lib/guest-thread';
import { GuestThreadError } from '@/lib/guest-thread-api';

interface GuestNameDialogProps {
  open: boolean;
  reason: 'first-post' | 'session-expired' | null;
  onJoin: (name: string) => Promise<unknown>;
  onCancel: () => void;
}

/** Asked only when the guest first posts — reading never needs a name. */
export function GuestNameDialog({ open, reason, onJoin, onCancel }: GuestNameDialogProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeGuestName(name);
    if (!normalized) { setError(t('guestThread.nameInvalid')); return; }
    setBusy(true);
    setError(null);
    try {
      await onJoin(normalized);
    } catch (err) {
      const kind = err instanceof GuestThreadError ? err.kind : null;
      setError(kind === 'invalid' ? t('guestThread.nameInvalid')
        : kind === 'rate_limited' ? t('guestThread.rateLimited')
        : t('guestThread.joinFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{t('guestThread.nameTitle')}</DialogTitle>
            <DialogDescription>
              {reason === 'session-expired' ? t('guestThread.sessionExpired') : t('guestThread.nameDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-2">
            <Label htmlFor="guest-name">{t('guestThread.nameLabel')}</Label>
            <Input
              id="guest-name"
              autoFocus
              autoComplete="name"
              value={name}
              maxLength={GUEST_NAME_MAX + 10}
              placeholder={t('guestThread.namePlaceholder')}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'guest-name-error' : undefined}
            />
            {error && <p id="guest-name-error" className="text-xs text-destructive" role="alert">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{t('guestThread.nameCancel')}</Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Spinner data-icon="inline-start" />}
              {t('guestThread.nameSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
