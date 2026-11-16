'use client';

import { Link2, Mail, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { TeamInvite } from '@/lib/types';
import { copyText } from './copy-text';

/** Invites not yet redeemed: copy the link again, or revoke it. */
export function PendingInvites({ invites, onChanged }: { invites: TeamInvite[]; onChanged: () => Promise<void> }) {
  const t = useT();

  const copyLink = async (invite: TeamInvite) => {
    if (await copyText(invite.url)) toast.success(t('admin.linkCopied'));
  };

  const revoke = async (invite: TeamInvite) => {
    try {
      await workspaceApi.revokeInvite(invite.inviteId);
      await onChanged();
      toast.success(t('admin.inviteRevoked'));
    } catch {
      toast.error(t('admin.inviteRevokeFailed'));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t('admin.pendingInvites')}</h3>
      <Card className="gap-0 divide-y py-0">
        {invites.map((inv) => (
          <div key={inv.inviteId} className="flex items-center gap-3 px-4 py-2.5">
            {inv.email ? (
              <Mail className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {inv.email ?? t('admin.openInviteLink')}
                <span className="ms-1.5 text-xs text-muted-foreground">· {inv.role}</span>
              </p>
              {inv.expiresAt && (
                <p className="text-xs text-muted-foreground">
                  {t('admin.inviteExpires', { time: new Date(inv.expiresAt).toLocaleDateString() })}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => copyLink(inv)}>
              {t('admin.copyLink')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => revoke(inv)}
              title={t('admin.inviteRevoke')}
              aria-label={t('admin.inviteRevoke')}
              className="text-muted-foreground"
            >
              <X />
            </Button>
          </div>
        ))}
      </Card>
    </section>
  );
}
