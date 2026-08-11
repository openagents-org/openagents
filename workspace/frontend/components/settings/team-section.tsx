'use client';

import { useState, useEffect, useCallback } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Users, UserPlus, Trash2, Loader2, ShieldCheck } from 'lucide-react';
import { avatarSrc } from '@/lib/account-api';
import { workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
import type { TeamMember, Workspace, WorkspaceRole } from '@/lib/types';

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];
// Roles that can be assigned when inviting (owner is granted, not invited).
const INVITE_ROLES: WorkspaceRole[] = ['admin', 'member', 'viewer'];

/**
 * Team management: the require-login switch + human member list (invite, change
 * role, remove). Mutations hit the backend immediately; the backend enforces
 * owner/admin permissions, so failures surface as a toast rather than being
 * hidden — a viewer/member simply gets "insufficient role".
 */
export function TeamSection({ workspace }: { workspace: Workspace }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [requireLogin, setRequireLogin] = useState(workspace.requireLogin);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await workspaceApi.getTeam());
    } catch {
      // Non-members can't list — leave empty rather than erroring loudly.
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  const toggleRequireLogin = async (next: boolean) => {
    setRequireLogin(next); // optimistic
    try {
      await workspaceApi.updateWorkspace({ require_login: next });
      toast.success(next ? 'Login now required' : 'Login no longer required');
    } catch {
      setRequireLogin(!next); // revert
      toast.error('Only an owner or admin can change this');
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
      toast.success(`Added ${email}`);
    } catch {
      toast.error('Could not add member (need owner/admin)');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (email: string, role: WorkspaceRole) => {
    try {
      await workspaceApi.updateTeamMember(email, role);
      await loadTeam();
    } catch {
      toast.error('Could not change role');
      await loadTeam();
    }
  };

  const remove = async (email: string) => {
    try {
      await workspaceApi.removeTeamMember(email);
      await loadTeam();
      toast.success(`Removed ${email}`);
    } catch {
      toast.error('Could not remove member');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-muted-foreground" />
        <Label>Members</Label>
      </div>

      {/* Enforced-login toggle */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Require login</span>
          </div>
          <p className="text-xs text-muted-foreground">
            When on, people must sign in and be a member to open this workspace.
          </p>
        </div>
        <Switch checked={requireLogin} onCheckedChange={toggleRequireLogin} />
      </div>

      {/* Invite */}
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label variant="secondary" className="text-xs">Invite by email</Label>
          <Input
            type="email"
            placeholder="teammate@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') invite(); }}
          />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
        >
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <Button onClick={invite} disabled={busy || !inviteEmail.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        </Button>
      </div>

      {/* Member list */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : members.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No members to show.</p>
      ) : (
        <div className="rounded-lg border divide-y">
          {members.map((m) => (
            <div key={m.email} className="flex items-center gap-2 px-3 py-2">
              <Avatar className="size-7 shrink-0">
                <AvatarImage src={avatarSrc(m.avatarUrl)} alt={m.displayName || m.email} />
                <AvatarFallback>{(m.displayName || m.email)[0]?.toUpperCase() ?? '?'}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{m.displayName || m.email}</p>
                {m.displayName && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
              </div>
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={m.role}
                onChange={(e) => changeRole(m.email, e.target.value as WorkspaceRole)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <Button variant="ghost" size="icon" onClick={() => remove(m.email)} title="Remove">
                <Trash2 className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
