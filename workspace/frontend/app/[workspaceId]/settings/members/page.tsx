'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminSettings, canAdminister } from '@/components/settings/admin-context';
import { ReadOnlyBanner, SectionHeader } from '@/components/settings/section-chrome';
import { AgentRoster } from '@/components/settings/agent-roster'; // v1.1 M1
import { GroupsPanel } from '@/components/settings/groups-panel'; // v1.1 permission model
import { InviteCard } from '@/components/settings/members/invite-card';
import { MemberRow } from '@/components/settings/members/member-row';
import { PendingInvites } from '@/components/settings/members/pending-invites';
import { workspaceApi } from '@/lib/api';
import type { TeamInvite, TeamMember, WorkspaceRole } from '@/lib/types';
import { useT } from '@/lib/i18n';

export default function MembersSettingsPage() {
  const { me } = useAdminSettings();
  const t = useT();
  const confirm = useConfirm();
  const editable = canAdminister(me);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="flex flex-col gap-8">
      <SectionHeader title={t('admin.membersTitle')} description={t('admin.membersDescription')} />
      {!editable && <ReadOnlyBanner />}

      {/* v1.1 permission model: the roster and the security groups share the page */}
      <Tabs defaultValue="people" className="w-full flex-col gap-6">
        <TabsList variant="line">
          <TabsTrigger value="people">{t('groups.tabPeople')}</TabsTrigger>
          <TabsTrigger value="groups">{t('groups.tabGroups')}</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="flex w-full min-w-0 flex-col gap-8">
          {editable && <InviteCard onInvited={load} />}

          {editable && pendingInvites.length > 0 && <PendingInvites invites={pendingInvites} onChanged={load} />}

          {/* v1.1 M1: unified roster — people first, agents below */}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">{t('collab.peopleSection')}</h3>
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            ) : members.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t('admin.noMembers')}</p>
            ) : (
              <Card className="gap-0 divide-y py-0">
                {members.map((m) => (
                  <MemberRow
                    key={m.email}
                    member={m}
                    isSelf={!!me.email && m.email === me.email}
                    editable={editable}
                    onChangeRole={(role) => changeRole(m.email, role)}
                    onRemove={() => remove(m.email)}
                  />
                ))}
              </Card>
            )}
          </section>

          {/* v1.1 M1: agents — owner + Personal/Team editable by owner/admins */}
          {!loading && <AgentRoster me={me} members={members} />}
        </TabsContent>

        <TabsContent value="groups">
          {!loading && <GroupsPanel editable={editable} members={members} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
