'use client';

// ── v1.1 permission model — Members → Groups tab ─────────────────────────────
// Security groups: the builtin `everyone` / `guest` (read-only, derived
// counts) and custom groups with create / rename / delete (impact preview
// first) and a members list (people + agents) with add / remove. Mutations
// are admin-only; everyone else sees the lists.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { GranteePicker, invalidateGranteeCandidates } from '@/components/sharing/grantee-picker';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { displayNameFromEmail } from '@/lib/collab';
import { GROUP_MEMBER_KINDS, granteeChipLabel, granteeFromMember, granteeKey } from '@/lib/access-ui';
import type { Grantee, GroupMember, SecurityGroup, TeamMember } from '@/lib/types';

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

  return (
    <div className="space-y-4">
      <div>
        <Label variant="secondary">{t('groups.title')}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('groups.description')}</p>
        {!editable && <p className="mt-1 text-xs text-muted-foreground">{t('groups.adminOnly')}</p>}
      </div>

      {editable && (
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('groups.createPlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            maxLength={80}
            className="flex-1"
          />
          <Button onClick={create} disabled={creating || !newName.trim()}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t('groups.create')}
          </Button>
        </div>
      )}

      {groups === null ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadFailed ? (
        <p className="py-3 text-sm text-destructive">{t('groups.loadFailed')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* ── Group list ── */}
          <div className="divide-y rounded-lg border">
            {groups.map((g) => {
              const builtin = g.builtin || g.kind !== 'custom';
              const active = g.id === selectedId;
              return (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(g.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(g.id); }}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg',
                    active ? 'bg-muted/70' : 'hover:bg-muted/40',
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UsersRound className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      <span className="truncate">{groupName(g)}</span>
                      {builtin && <Badge variant="outline" size="xs" className="shrink-0">{t('groups.builtin')}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t('groups.memberCount', { count: g.member_count })}
                      {g.kind === 'everyone' && ` · ${t('groups.everyoneHint')}`}
                      {g.kind === 'guest' && ` · ${t('groups.guestHint')}`}
                    </p>
                  </div>
                  {editable && !builtin && (
                    <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {busyId === g.id ? (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => rename(g)} title={t('groups.rename')}>
                            <Pencil className="size-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(g)} title={t('groups.delete')}>
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {groups.every((g) => g.kind !== 'custom') && (
              <p className="px-3 py-2.5 text-xs text-muted-foreground">{t('groups.noGroups')}</p>
            )}
          </div>

          {/* ── Members of the selected group ── */}
          <div className="rounded-lg border p-3">
            {!selected ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('groups.selectGroupHint')}</p>
            ) : (
              <GroupMembers
                key={selected.id}
                group={selected}
                title={t('groups.membersTitle', { name: groupName(selected) })}
                editable={editable && selected.kind === 'custom' && !selected.builtin}
                derived={selected.kind !== 'custom' || selected.builtin}
                memberName={memberName}
                onChanged={load}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Members list for one group ───────────────────────────────────────────────

function GroupMembers({
  group,
  title,
  editable,
  derived,
  memberName,
  onChanged,
}: {
  group: SecurityGroup;
  title: string;
  editable: boolean;
  derived: boolean;
  memberName: (email: string) => string;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const [list, setList] = useState<GroupMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Grantee[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await workspaceApi.listGroupMembers(group.id));
      setFailed(false);
    } catch {
      setList([]);
      setFailed(true);
    }
  }, [group.id]);
  useEffect(() => { load(); }, [load]);

  const existingKeys = useMemo(
    () => (list || []).map((m) => granteeKey({ kind: m.principal_kind, id: m.principal_id })),
    [list],
  );

  const add = async () => {
    if (picked.length === 0 || adding) return;
    setAdding(true);
    let added = 0;
    for (const g of picked) {
      if (g.kind === 'group') continue; // groups don't nest
      try {
        await workspaceApi.addGroupMember(group.id, g.kind, g.id);
        added += 1;
      } catch {
        toast.error(t('groups.addFailed', { name: granteeChipLabel(g) }));
      }
    }
    setAdding(false);
    setPicked([]);
    if (added > 0) {
      toast.success(t('groups.memberAdded', { count: added }));
      invalidateGranteeCandidates();
      await load();
      await onChanged();
    }
  };

  const remove = async (m: GroupMember) => {
    const label = granteeChipLabel(granteeFromMember(m));
    setList((prev) => prev?.filter((x) => !(x.principal_kind === m.principal_kind && x.principal_id === m.principal_id)) ?? prev);
    try {
      await workspaceApi.removeGroupMember(group.id, m.principal_kind, m.principal_id);
      toast.success(t('groups.memberRemoved', { name: label }));
      invalidateGranteeCandidates();
      await onChanged();
    } catch {
      toast.error(t('groups.removeFailed', { name: label }));
      await load();
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {derived && <p className="mt-0.5 text-xs text-muted-foreground">{t('groups.derivedMembership')}</p>}
      </div>

      {list === null ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">{t('groups.membersLoadFailed')}</p>
      ) : list.length === 0 ? (
        !derived && <p className="text-sm text-muted-foreground">{t('groups.noMembers')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.map((m) => {
            const isAgent = m.principal_kind === 'agent';
            const name = m.display_name || (isAgent ? m.principal_id : memberName(m.principal_id));
            return (
              <li key={`${m.principal_kind}:${m.principal_id}`} className="flex items-center gap-2 px-3 py-1.5">
                {isAgent ? (
                  <AgentAvatar name={m.principal_id} size={24} />
                ) : (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                    {name[0]?.toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm">
                    <span className="truncate">{name}</span>
                    <Badge variant="outline" size="xs" className="shrink-0">
                      {isAgent ? t('collab.kindAgent') : t('collab.kindPerson')}
                    </Badge>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {isAgent ? m.principal_id : m.principal_id}
                    {m.added_by && ` · ${t('groups.addedBy', { name: displayNameFromEmail(m.added_by) })}`}
                  </p>
                </div>
                {editable && (
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(m)} title={t('common.remove')}>
                    <X className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <div className="space-y-2">
          <GranteePicker
            value={picked}
            onChange={setPicked}
            kinds={GROUP_MEMBER_KINDS}
            exclude={existingKeys}
            placeholder={t('groups.addPlaceholder')}
          />
          {picked.length > 0 && (
            <Button size="sm" onClick={add} disabled={adding}>
              {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {t('groups.addMembers')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
