'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/settings/settings-card';
import { getAccountPublicProfile, saveAccountPublicProfile } from '@/lib/account-api';

export function PublicProfileCard({ idToken, displayName }: { idToken: string; displayName: string }) {
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [published, setPublished] = useState(false);
  const [savedPublic, setSavedPublic] = useState(false);
  const [claimed, setClaimed] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setError('');
    setStatus('');
    getAccountPublicProfile(idToken, controller.signal).then((profile) => {
      if (controller.signal.aborted) return;
      setHandle(profile.handle ?? displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28).replace(/-$/, ''));
      setClaimed(profile.handle ?? '');
      setBio(profile.bio);
      setPublished(profile.isPublic);
      setSavedPublic(profile.isPublic);
      setReady(true);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Profile settings are currently unavailable.');
    });
    return () => controller.abort();
  }, [idToken, displayName]);

  const normalized = handle.trim().toLowerCase();
  const valid = normalized.length >= 3 && normalized.length <= 28 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized);
  const base = process.env.NEXT_PUBLIC_PROFILE_BASE_URL ||
    (typeof window !== 'undefined' && window.location.hostname === 'workspace.openagents.org' ? 'https://openagents.org' : '');
  const url = base && claimed ? `${base.replace(/\/+$/, '')}/u/${encodeURIComponent(claimed)}` : '';

  return (
    <SettingsCard title="Public profile" description="Claim a handle across this OpenAgents platform. You can keep your profile private.">
      {ready ? (
        <form className="flex max-w-md flex-col gap-3" onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || saving) return;
          setSaving(true);
          setError('');
          setStatus('');
          try {
            const saved = await saveAccountPublicProfile(idToken, { handle: normalized, bio, isPublic: published });
            setClaimed(saved.handle ?? '');
            setHandle(saved.handle ?? '');
            setBio(saved.bio);
            setPublished(saved.isPublic);
            setSavedPublic(saved.isPublic);
            setStatus('Profile saved.');
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Could not save your profile.');
          } finally {
            setSaving(false);
          }
        }}>
          <label htmlFor="public-profile-handle" className="text-sm font-medium">Handle</label>
          <Input id="public-profile-handle" required minLength={3} maxLength={28} readOnly={Boolean(claimed)} disabled={saving} value={handle}
            autoCapitalize="none" autoComplete="off" spellCheck={false} onChange={(event) => setHandle(event.target.value)} aria-describedby="public-profile-hint" />
          <p id="public-profile-hint" className="text-xs text-muted-foreground">Use 3–28 letters, numbers or hyphens. Your handle is permanent once claimed.</p>
          <label htmlFor="public-profile-bio" className="text-sm font-medium">Bio</label>
          <textarea id="public-profile-bio" rows={3} maxLength={160} className="rounded-md border bg-background p-2 text-sm"
            disabled={saving} value={bio} onChange={(event) => setBio(event.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={published} disabled={saving} onChange={(event) => setPublished(event.target.checked)} />
            Show my name, uploaded photo, handle and bio publicly
          </label>
          {url && savedPublic && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-sm underline" aria-label="Open your public profile">{url}</a>
          )}
          <Button type="submit" size="sm" className="self-start" disabled={!valid || saving}>{saving ? 'Saving…' : claimed ? 'Save profile' : 'Claim handle'}</Button>
          <p className="text-sm text-muted-foreground" role="status">{status}</p>
        </form>
      ) : !error && <p className="text-sm text-muted-foreground" role="status">Loading profile settings…</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </SettingsCard>
  );
}
