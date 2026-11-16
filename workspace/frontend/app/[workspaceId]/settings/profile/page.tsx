'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, LogIn, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionHeader } from '@/components/settings/section-chrome';
import { SettingsCard } from '@/components/settings/settings-card';
import { SaveButton } from '@/components/settings/save-button';
import {
  getAccountProfile, updateAccountProfile, type AccountProfile,
} from '@/lib/account-api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { goToCentralLogin } from '@/lib/auth-redirects';
import { useT } from '@/lib/i18n';

const AVATAR_SIZE = 256;

/** Downscale + square-crop a picked image to a small JPEG data URL so the
 * stored avatar stays a few tens of KB (the backend caps the length). */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas unavailable')); return; }
      ctx.drawImage(
        img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, AVATAR_SIZE, AVATAR_SIZE,
      );
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

type Part = 'avatar' | 'name';

export default function ProfileSettingsPage() {
  const t = useT();
  const { user, idToken, loading: authLoading, signIn } = useOpenAgentsAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [name, setName] = useState('');
  // null = untouched; '' = cleared; 'data:...' = newly picked.
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<Part | null>(null);
  // The card saved last, briefly, so its button confirms the save.
  const [justSaved, setJustSaved] = useState<Part | null>(null);

  useEffect(() => {
    if (!justSaved) return;
    const id = window.setTimeout(() => setJustSaved(null), 2000);
    return () => window.clearTimeout(id);
  }, [justSaved]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    getAccountProfile(idToken)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setName(p.displayName || '');
      })
      .catch(() => { if (!cancelled) toast.error(t('admin.loadFailed')); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  if (!authLoading && !user) {
    return (
      <div className="flex flex-col gap-6">
        <SectionHeader title={t('profile.title')} description={t('profile.description')} />
        <SettingsCard
          title={t('userMenu.signIn')}
          description={t('profile.signInPrompt')}
          footer={(
            <Button size="sm" onClick={() => goToCentralLogin(signIn)}>
              <LogIn data-icon="inline-start" />
              {t('userMenu.signIn')}
            </Button>
          )}
        />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  // Custom avatar wins; the provider photo (Google) is the passive default.
  const shownAvatar =
    avatarDraft !== null
      ? (avatarDraft || null)
      : (profile.avatarUrl || user?.photoURL || null);
  const initial = (name || profile.displayName || profile.email)[0]?.toUpperCase();
  const canRemove = Boolean(shownAvatar) && shownAvatar !== user?.photoURL;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatarDraft(await fileToAvatarDataUrl(file));
    } catch {
      toast.error(t('profile.badImage'));
    }
  };

  const nameDirty = name.trim() !== (profile.displayName || '');
  const avatarDirty = avatarDraft !== null;

  const save = async (part: Part) => {
    if (!idToken) return;
    setSaving(part);
    try {
      const updated = await updateAccountProfile(
        idToken,
        part === 'name' ? { displayName: name.trim() } : { avatarUrl: avatarDraft ?? '' },
      );
      setProfile(updated);
      window.dispatchEvent(new Event('workspace-profile-updated'));
      if (part === 'name') setName(updated.displayName || '');
      else setAvatarDraft(null);
      setJustSaved(part);
      toast.success(t('profile.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t('profile.title')} description={t('profile.description')} />

      <SettingsCard
        title={t('profile.photoTitle')}
        description={t('profile.photoHint')}
        footer={<SaveButton dirty={avatarDirty} saving={saving === 'avatar'} saved={justSaved === 'avatar'} onClick={() => save('avatar')} />}
      >
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title={t('profile.changePhoto')}
            className="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {shownAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownAvatar} alt="" className="size-16 rounded-full object-cover" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
                {initial}
              </span>
            )}
          </button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Camera data-icon="inline-start" />
              {t('profile.changePhoto')}
            </Button>
            {canRemove && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAvatarDraft('')}>
                <Trash2 data-icon="inline-start" />
                {t('profile.removePhoto')}
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('profile.displayName')}
        description={t('profile.displayNameHint')}
        footer={<SaveButton dirty={nameDirty} saving={saving === 'name'} saved={justSaved === 'name'} disabled={!name.trim()} onClick={() => save('name')} />}
      >
        <Input
          aria-label={t('profile.displayName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && nameDirty && name.trim()) void save('name'); }}
          placeholder={t('profile.displayNamePlaceholder')}
          maxLength={120}
          className="max-w-sm"
        />
      </SettingsCard>

      <SettingsCard title={t('profile.emailTitle')} description={t('profile.emailHint')}>
        <Input aria-label={t('profile.emailTitle')} value={profile.email} readOnly disabled className="max-w-sm" />
      </SettingsCard>
    </div>
  );
}
