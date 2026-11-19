'use client';

// ── v1.1 permission model — Members → Groups tab ─────────────────────────────
// Security groups: the builtin `everyone` / `guest` (read-only, derived
// counts) and custom groups with create / rename / delete (impact preview
// first) and a members list (people + agents) with add / remove. Mutations
// are admin-only; everyone else sees the lists.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { Input } from '@/components/ui/input';
import { ItemGroup } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { invalidateGranteeCandidates } from '@/components/sharing/grantee-picker';
import { SettingsCard } from '@/components/settings/settings-card';
import { ListEmpty, ListError, ListLoading } from '@/components/settings/settings-list';
import { workspaceApi } from '@/lib/api';
import { displayNameFromEmail } from '@/lib/collab';
import { useT } from '@/lib/i18n';
import type { SecurityGroup, TeamMember } from '@/lib/types';
import { GroupListItem } from './group-list-item';
import { GroupMembers } from './group-members';

export function GroupsPanel({ editable, members }: { editable: boolean; members: TeamMember[] }) {
  const t = useT();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [groups, setGroups] = useState<SecurityGroup[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await workspaceApi.listGroups();
      setGroups(list);
      setLoadFailed(false);
    } catch {
      setGroups([]);
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => groups?.find((g) => g.id === selectedId) ?? null, [groups, selectedId]);

  const groupName = (g: SecurityGroup) =>
    g.kind === 'everyone' ? t('groups.everyoneName') : g.kind === 'guest' ? t('groups.guestName') : g.name;

  const memberName = (email: string) =>
    members.find((m) => m.email.toLowerCase() === email.toLowerCase())?.displayName || displayNameFromEmail(email);

  const create = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const g = await workspaceApi.createGroup(name);
      setNewName('');
      invalidateGranteeCandidates();
      await load();
      setSelectedId(g.id);
      toast.success(t('groups.created', { name }));
    } catch {
      toast.error(t('groups.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const rename = async (g: SecurityGroup) => {
    const name = await prompt({
      title: t('groups.renameTitle'),
      defaultValue: g.name,
      placeholder: t('groups.createPlaceholder'),
      confirmText: t('groups.rename'),
      validate: (v) => (v.trim() ? null : t('common.required')),
    });
    if (name == null || name.trim() === g.name) return;
    setBusyId(g.id);
    try {
      await workspaceApi.renameGroup(g.id, name.trim());
      invalidateGranteeCandidates();
      await load();
      toast.success(t('groups.renamed'));
    } catch {
      toast.error(t('groups.renameFailed'));
    } finally {
      setBusyId(null);
    }
  };

  // Delete: dry run first so the confirm can say what goes away.
  const remove = async (g: SecurityGroup) => {
    setBusyId(g.id);
    let impact = { affected_grants: 0, members: g.member_count };
    try {
      impact = await workspaceApi.deleteGroup(g.id, { dryRun: true });
    } catch { /* fall back to the counts we have */ }
    setBusyId(null);
    const ok = await confirm({
      title: t('groups.deleteTitle', { name: g.name }),
      description: t('groups.deleteImpact', { grants: impact.affected_grants, members: impact.members }),
      confirmText: t('groups.deleteConfirm'),
      destructive: true,
    });
    if (!ok) return;
    setBusyId(g.id);
    try {
      await workspaceApi.deleteGroup(g.id);
      invalidateGranteeCandidates();
      if (selectedId === g.id) setSelectedId(null);
      await load();
      toast.success(t('groups.deleted'));
    } catch {
      toast.error(t('groups.deleteFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const derived = !!selected && (selected.kind !== 'custom' || selected.builtin);

  return (
    <div className="grid gap-6 md:grid-cols-5">
      {/* ── Group list ── */}
      <SettingsCard
        className="md:col-span-2"
        title={t('groups.title')}
        description={editable ? t('groups.description') : <>{t('groups.description')} {t('groups.adminOnly')}</>}
      >
        {editable && (
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('groups.createPlaceholder')}
              aria-label={t('groups.createPlaceholder')}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              maxLength={80}
              className="flex-1"
            />
            <Button onClick={create} disabled={creating || !newName.trim()}>
              {creating ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {t('groups.create')}
            </Button>
          </div>
        )}
        {groups === null ? (
          <ListLoading />
        ) : loadFailed ? (
          <ListError>{t('groups.loadFailed')}</ListError>
        ) : (
          <ItemGroup className="gap-1 has-data-[size=sm]:gap-1">
            {groups.map((g) => (
              <GroupListItem
                key={g.id}
                group={g}
                name={groupName(g)}
                active={g.id === selectedId}
                editable={editable}
                busy={busyId === g.id}
                onSelect={() => setSelectedId(g.id)}
                onRename={() => rename(g)}
                onRemove={() => remove(g)}
              />
            ))}
            {groups.every((g) => g.kind !== 'custom') && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{t('groups.noGroups')}</p>
            )}
          </ItemGroup>
        )}
      </SettingsCard>

      {/* ── Members of the selected group ── */}
      {selected ? (
        <SettingsCard
          className="md:col-span-3"
          title={t('groups.membersTitle', { name: groupName(selected) })}
          description={derived && t('groups.derivedMembership')}
        >
          <GroupMembers
            key={selected.id}
            group={selected}
            editable={editable && !derived}
            derived={derived}
            memberName={memberName}
            onChanged={load}
          />
        </SettingsCard>
      ) : (
        <Card className="md:col-span-3">
          <CardContent>
            <ListEmpty icon={<UsersRound />}>{t('groups.selectGroupHint')}</ListEmpty>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
