'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, LogIn, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionHeader } from '@/components/settings/section-chrome';
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

export default function ProfileSettingsPage() {
  const t = useT();
  const { user, idToken, loading: authLoading, signIn } = useOpenAgentsAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [name, setName] = useState('');
  // null = untouched; '' = cleared; 'data:...' = newly picked.
  const [avatarDraft, setAvatarDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      <div className="space-y-8">
        <SectionHeader title={t('profile.title')} description={t('profile.description')} />
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">{t('profile.signInPrompt')}</p>
          <Button size="sm" onClick={() => goToCentralLogin(signIn)}>
            <LogIn className="size-4" />
            {t('userMenu.signIn')}
          </Button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Custom avatar wins; the provider photo (Google) is the passive default.
  const shownAvatar =
    avatarDraft !== null
      ? (avatarDraft || null)
      : (profile.avatarUrl || user?.photoURL || null);
  const initial = (name || profile.displayName || profile.email)[0]?.toUpperCase();

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatarDraft(await fileToAvatarDataUrl(file));
    } catch {
      toast.error(t('profile.badImage'));
    }
  };

  const dirty =
    name.trim() !== (profile.displayName || '') || avatarDraft !== null;

  const save = async () => {
    if (!idToken || !name.trim()) return;
    setSaving(true);
    try {
      const updated = await updateAccountProfile(idToken, {
        ...(name.trim() !== (profile.displayName || '') ? { displayName: name.trim() } : {}),
        ...(avatarDraft !== null ? { avatarUrl: avatarDraft } : {}),
      });
      setProfile(updated);
      setName(updated.displayName || '');
      setAvatarDraft(null);
      toast.success(t('profile.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader title={t('profile.title')} description={t('profile.description')} />

      <div className="flex items-start gap-5 rounded-lg border p-4">
        <div className="relative">
          {shownAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shownAvatar}
              alt=""
              className="size-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">
              {initial}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            title={t('profile.changePhoto')}
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border bg-background shadow-sm transition-colors hover:bg-muted"
          >
            <Camera className="size-3.5" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <Label>{t('profile.displayName')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('profile.displayNamePlaceholder')}
              maxLength={120}
            />
            <p className="text-xs text-muted-foreground">{t('profile.displayNameHint')}</p>
          </div>
          <p className="text-xs text-muted-foreground">{profile.email}</p>
          {(profile.avatarUrl || avatarDraft) && (
            <Button variant="ghost" size="sm" onClick={() => setAvatarDraft('')}>
              <X className="size-3.5" />
              {t('profile.removePhoto')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !dirty || !name.trim()}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
