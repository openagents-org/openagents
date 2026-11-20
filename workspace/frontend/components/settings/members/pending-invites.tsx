'use client';

import { Link2, Mail, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { IconAction } from '@/components/settings/icon-action';
import { SettingsCard } from '@/components/settings/settings-card';
import { SettingsList } from '@/components/settings/settings-list';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { roleLabel } from '@/lib/roles';
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
    <SettingsCard title={t('admin.pendingInvites')}>
      <SettingsList>
        {invites.map((inv) => (
          <Item key={inv.inviteId} size="sm">
            <ItemMedia variant="icon">
              {inv.email ? <Mail className="text-muted-foreground" /> : <Link2 className="text-muted-foreground" />}
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="font-normal">
                <span className="truncate">{inv.email ?? t('admin.openInviteLink')}</span>
                <Badge variant="outline">{roleLabel(t, inv.role)}</Badge>
              </ItemTitle>
              {inv.expiresAt && (
                <ItemDescription className="text-xs">
                  {t('admin.inviteExpires', { time: new Date(inv.expiresAt).toLocaleDateString() })}
                </ItemDescription>
              )}
            </ItemContent>
            <ItemActions>
              <Button variant="ghost" size="sm" onClick={() => copyLink(inv)}>
                {t('admin.copyLink')}
              </Button>
              <IconAction label={t('admin.inviteRevoke')} destructive onClick={() => revoke(inv)}>
                <X />
              </IconAction>
            </ItemActions>
          </Item>
        ))}
      </SettingsList>
    </SettingsCard>
  );
}
