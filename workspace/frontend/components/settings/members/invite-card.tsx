'use client';

import { useState } from 'react';
import { Link2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { roleLabel } from '@/lib/roles';
import type { WorkspaceRole } from '@/lib/types';
import { copyText } from './copy-text';

// Owner is granted via a role change by an existing owner, never on invite.
const INVITE_ROLES: WorkspaceRole[] = ['admin', 'member', 'viewer'];

/** Invite by email, or mint an open link — both at the role picked here. */
export function InviteCard({ onInvited }: { onInvited: () => Promise<void> }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const [sending, setSending] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  const sendInvite = async () => {
    const address = email.trim().toLowerCase();
    if (!address) return;
    setSending(true);
    try {
      const invite = await workspaceApi.createInvite(role, address);
      setEmail('');
      await onInvited();
      if (invite.emailSent) {
        toast.success(t('admin.inviteEmailSent', { email: address }));
      } else {
        // No email provider configured — hand the link to the inviter instead.
        const copied = await copyText(invite.url);
        toast.success(
          copied ? t('admin.inviteCreatedCopied', { email: address }) : t('admin.inviteCreated', { email: address }),
        );
      }
    } catch {
      toast.error(t('admin.inviteFailed'));
    } finally {
      setSending(false);
    }
  };

  // Open shareable link: role-limited, expiring, revocable — never the
  // workspace machine token.
  const createLink = async () => {
    setLinkBusy(true);
    try {
      const invite = await workspaceApi.createInvite(role);
      await onInvited();
      const copied = await copyText(invite.url);
      toast.success(copied ? t('admin.linkCopied') : t('admin.linkCreated'));
    } catch {
      toast.error(t('admin.inviteFailed'));
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('admin.inviteTitle')}</CardTitle>
        <CardDescription>{t('admin.inviteHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          placeholder={t('admin.invitePlaceholder')}
          aria-label={t('admin.inviteTitle')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendInvite(); }}
          className="flex-1"
        />
        <Select value={role} onValueChange={(v) => setRole(v as WorkspaceRole)}>
          <SelectTrigger className="w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {INVITE_ROLES.map((r) => (
                <SelectItem key={r} value={r}>{roleLabel(t, r)}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button onClick={sendInvite} disabled={sending || !email.trim()}>
          {sending ? <Spinner data-icon="inline-start" /> : <Mail data-icon="inline-start" />}
          <span className="hidden sm:inline">{t('admin.inviteSend')}</span>
        </Button>
      </CardContent>
      <CardFooter className="flex-wrap gap-x-3 gap-y-2">
        <Button variant="outline" size="sm" onClick={createLink} disabled={linkBusy}>
          {linkBusy ? <Spinner data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
          {t('admin.createInviteLink')}
        </Button>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('admin.inviteLinkHint')}</p>
      </CardFooter>
    </Card>
  );
}
