'use client';

import { useRef, useState } from 'react';
import { Loader2, Trash2, UserRound } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { avatarSrc, deleteAvatar, uploadAvatar } from '@/lib/account-api';
import { useAvatars } from '@/lib/avatars';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

// Matches AVATAR_MAX_UPLOAD_SIZE on the backend. Checked here too so an
// oversized file fails instantly instead of after a slow upload.
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * The signed-in user's avatar: preview, upload, remove.
 *
 * The server re-encodes whatever it's given to a square WebP, so there's no
 * cropping UI here — any reasonable image produces a reasonable avatar.
 */
export function AvatarSection() {
  const { idToken } = useOpenAgentsAuth();
  const { profile, refresh } = useAvatars();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!idToken || !profile) return null;

  const label = profile.displayName || profile.email;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error('That image is larger than 5MB. Pick a smaller one.');
      return;
    }

    setBusy(true);
    try {
      await uploadAvatar(idToken, file);
      await refresh();
      toast.success('Avatar updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload that image');
    } finally {
      setBusy(false);
      // Clear the input so picking the same file again still fires onChange.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteAvatar(idToken);
      await refresh();
      toast.success('Avatar removed');
    } catch {
      toast.error('Could not remove your avatar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <UserRound className="size-4 text-muted-foreground" />
        <Label>Your avatar</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown next to your messages across every workspace you&apos;re in. JPEG, PNG, GIF or WebP,
        up to 5MB.
      </p>

      <div className="flex items-center gap-3">
        <Avatar className="size-12">
          <AvatarImage src={avatarSrc(profile.avatarUrl)} alt={label} />
          <AvatarFallback className="text-sm">{initials(label)}</AvatarFallback>
        </Avatar>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {profile.avatarUrl ? 'Change' : 'Upload'}
        </Button>

        {profile.avatarUrl && (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={remove}
            title="Remove avatar"
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        )}
      </div>
    </div>
  );
}
