'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Mail, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import type { TeamInvite, TeamMember, WorkspaceRole } from '@/lib/types';
import { useT } from '@/lib/i18n';

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];
// Owner is granted via a role change by an existing owner, never on invite.
const INVITE_ROLES: WorkspaceRole[] = ['admin', 'member', 'viewer'];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function MembersSettingsPage() {
  const { me } = useAdminSettings();
  const t = useT();
  const confirm = useConfirm();
  const editable = canAdminister(me);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Invites are admin-only; a plain member still sees the member list.
      const [team, invs] = await Promise.all([
        workspaceApi.getTeam().catch(() => [] as TeamMember[]),
        workspaceApi.listInvites().catch(() => [] as TeamInvite[]),
      ]);
      setMembers(team);
      setInvites(invs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingInvites = invites.filter((i) => i.status === 'pending');

  const sendInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    try {
      const invite = await workspaceApi.createInvite(inviteRole, email);
      setInviteEmail('');
      await load();
      if (invite.emailSent) {
        toast.success(t('admin.inviteEmailSent', { email }));
      } else {
        // No email provider configured — hand the link to the inviter instead.
        const copied = await copyText(invite.url);
        toast.success(
          copied ? t('admin.inviteCreatedCopied', { email }) : t('admin.inviteCreated', { email }),
        );
      }
    } catch {
      toast.error(t('admin.inviteFailed'));
    } finally {
      setBusy(false);
    }
  };

  // Open shareable link: role-limited, expiring, revocable — never the
  // workspace machine token.
  const createLink = async () => {
    setLinkBusy(true);
    try {
      const invite = await workspaceApi.createInvite(inviteRole);
      await load();
      const copied = await copyText(invite.url);
      toast.success(copied ? t('admin.linkCopied') : t('admin.linkCreated'));
    } catch {
      toast.error(t('admin.inviteFailed'));
    } finally {
      setLinkBusy(false);
    }
  };

  const copyInviteLink = async (invite: TeamInvite) => {
    const copied = await copyText(invite.url);
    if (copied) toast.success(t('admin.linkCopied'));
  };

  const revoke = async (invite: TeamInvite) => {
    try {
      await workspaceApi.revokeInvite(invite.inviteId);
      await load();
      toast.success(t('admin.inviteRevoked'));
    } catch {
      toast.error(t('admin.inviteRevokeFailed'));
    }
  };

  const changeRole = async (email: string, role: WorkspaceRole) => {
    try {
      await workspaceApi.updateTeamMember(email, role);
      await load();
      toast.success(t('admin.roleChanged'));
    } catch {
      toast.error(t('admin.roleChangeFailed'));
      await load();
    }
  };

  const remove = async (email: string) => {
    const ok = await confirm({
      title: t('admin.removeTitle'),
      description: t('admin.removeDescription', { email }),
      confirmText: t('admin.removeMember'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.removeTeamMember(email);
      await load();
      toast.success(t('admin.removed', { email }));
    } catch {
      toast.error(t('admin.removeFailed'));
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader title={t('admin.membersTitle')} description={t('admin.membersDescription')} />
      {!editable && <ReadOnlyBanner />}

      {editable && (
        <div className="space-y-3 rounded-lg border p-4">
          <Label>{t('admin.inviteTitle')}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="email"
              placeholder={t('admin.invitePlaceholder')}
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendInvite(); }}
              className="flex-1"
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
            >
              {INVITE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <Button onClick={sendInvite} disabled={busy || !inviteEmail.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              <span className="hidden sm:inline">{t('admin.inviteSend')}</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.inviteHint')}</p>
          <Button variant="outline" size="sm" onClick={createLink} disabled={linkBusy}>
            {linkBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            {t('admin.createInviteLink')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('admin.inviteLinkHint')}</p>
        </div>
      )}

      {editable && pendingInvites.length > 0 && (
        <div className="space-y-2">
          <Label variant="secondary">{t('admin.pendingInvites')}</Label>
          <div className="divide-y rounded-lg border">
            {pendingInvites.map((inv) => (
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
                <Button variant="ghost" size="sm" onClick={() => copyInviteLink(inv)}>
                  {t('admin.copyLink')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => revoke(inv)}
                  title={t('admin.inviteRevoke')}
                >
                  <X className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : members.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">{t('admin.noMembers')}</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {members.map((m) => {
            const isSelf = !!me.email && m.email === me.email;
            return (
              <div key={m.email} className="flex items-center gap-3 px-4 py-3">
                {m.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatarUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {(m.displayName || m.email)[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.displayName || m.email}
                    {isSelf && (
                      <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                        ({t('admin.you')})
                      </span>
                    )}
                  </p>
                  {m.displayName && (
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  )}
                </div>
                {editable ? (
                  <>
                    <select
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      value={m.role}
                      onChange={(e) => changeRole(m.email, e.target.value as WorkspaceRole)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(m.email)}
                      title={t('admin.removeMember')}
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {m.role}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
