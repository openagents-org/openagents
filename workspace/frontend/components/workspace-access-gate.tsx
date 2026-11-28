'use client';

import { useT } from '@/lib/i18n';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveWorkspaceToken } from '@/lib/workspace-token';
import { setWorkspaceCookie } from '@/lib/workspace-cookie';

/** Reuse the existing private access-link instructions on self-hosted entry. */
export function WorkspaceAccessGate({ error: initialError = null }: { error?: 'invalid' | 'unavailable' | null }) {
  const t = useT();
  const router = useRouter();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  async function openWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = token.trim();
      const slug = await resolveWorkspaceToken(value);
      setWorkspaceCookie(slug, value);
      router.replace(`/${encodeURIComponent(slug)}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error && failure.message === 'invalid' ? 'invalid' : 'unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 bg-background">
      <h1 className="text-xl font-semibold">{t('workspaceGate.openWorkspace')}</h1>
      <form onSubmit={openWorkspace} className="flex w-full max-w-sm flex-col gap-3">
        <label htmlFor="workspace-access-token" className="text-sm">{t('workspaceGate.tokenLabel')}</label>
        <Input id="workspace-access-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={busy} required />
        {error && <p role="alert" className="text-sm text-destructive">{t(error === 'invalid' ? 'workspaceGate.invalidToken' : 'workspaceGate.accessUnavailable')}</p>}
        <Button type="submit" disabled={busy || !token.trim()}>{t(busy ? 'workspaceGate.opening' : 'workspaceGate.openWorkspace')}</Button>
      </form>
    </div>
  );
}
