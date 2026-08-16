'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { workspaceApi } from '@/lib/api';
import type { TeamMember, WorkspaceRole } from '@/lib/types';
import { useT } from '@/lib/i18n';

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];
// Owner is granted via a role change by an existing owner, never on invite.
const INVITE_ROLES: WorkspaceRole[] = ['admin', 'member', 'viewer'];

export default function MembersSettingsPage() {
  const { workspace, me, query } = useAdminSettings();
  const t = useT();
  const confirm = useConfirm();
  const editable = canAdminister(me);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await workspaceApi.getTeam());
    } catch {
      // Viewers (below `member`) can't list the team — show empty, not an error.
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const workspaceUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/${workspace.slug}${query}`
    : '';

  const copyWorkspaceLink = async () => {
    try {
      await navigator.clipboard.writeText(workspaceUrl);
      toast.success(t('admin.linkCopied'));
    } catch {
      toast.error(t('userMenu.tokenCopyFailed'));
    }
  };

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    try {
      await workspaceApi.addTeamMember(email, inviteRole);
      setInviteEmail('');
      await loadTeam();
      toast.success(t('admin.inviteAdded', { email }));
    } catch {
      toast.error(t('admin.inviteFailed'));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (email: string, role: WorkspaceRole) => {
    try {
      await workspaceApi.updateTeamMember(email, role);
      await loadTeam();
      toast.success(t('admin.roleChanged'));
    } catch {
      toast.error(t('admin.roleChangeFailed'));
      await loadTeam();
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
      await loadTeam();
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
              onKeyDown={(e) => { if (e.key === 'Enter') invite(); }}
              className="flex-1"
            />
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
            >
              {INVITE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <Button onClick={invite} disabled={busy || !inviteEmail.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              <span className="hidden sm:inline">{t('admin.inviteAdd')}</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('admin.inviteHint')}</p>
          <Button variant="outline" size="sm" onClick={copyWorkspaceLink}>
            <Copy className="size-3.5" />
            {t('admin.copyWorkspaceLink')}
          </Button>
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
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {m.email[0]?.toUpperCase()}
                </div>
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
