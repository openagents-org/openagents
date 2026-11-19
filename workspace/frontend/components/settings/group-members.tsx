'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { GranteePicker, invalidateGranteeCandidates } from '@/components/sharing/grantee-picker';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { IconAction } from '@/components/settings/icon-action';
import { ListEmpty, ListError, ListLoading, SettingsList } from '@/components/settings/settings-list';
import { GROUP_MEMBER_KINDS, granteeChipLabel, granteeFromMember, granteeKey } from '@/lib/access-ui';
import { workspaceApi } from '@/lib/api';
import { displayNameFromEmail } from '@/lib/collab';
import { useT } from '@/lib/i18n';
import type { Grantee, GroupMember, SecurityGroup } from '@/lib/types';

/** Who is in one security group, with add/remove for custom groups. */
export function GroupMembers({
  group,
  editable,
  derived,
  memberName,
  onChanged,
}: {
  group: SecurityGroup;
  editable: boolean;
  /** Membership follows from roles (builtin groups), so an empty list says nothing. */
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
    <div className="flex flex-col gap-3">
      {list === null ? (
        <ListLoading />
      ) : failed ? (
        <ListError>{t('groups.membersLoadFailed')}</ListError>
      ) : list.length === 0 ? (
        !derived && <ListEmpty>{t('groups.noMembers')}</ListEmpty>
      ) : (
        <SettingsList>
          {list.map((m) => {
            const isAgent = m.principal_kind === 'agent';
            const name = m.display_name || (isAgent ? m.principal_id : memberName(m.principal_id));
            return (
              <Item key={`${m.principal_kind}:${m.principal_id}`} size="xs">
                <ItemMedia>
                  {isAgent ? (
                    <AgentAvatar name={m.principal_id} size={24} />
                  ) : (
                    <Avatar size="sm">
                      <AvatarFallback className="font-semibold">{name[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )}
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="font-normal">
                    <span className="truncate">{name}</span>
                    <Badge variant="outline">
                      {isAgent ? t('collab.kindAgent') : t('collab.kindPerson')}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-1">
                    {m.principal_id}
                    {m.added_by && ` · ${t('groups.addedBy', { name: displayNameFromEmail(m.added_by) })}`}
                  </ItemDescription>
                </ItemContent>
                {editable && (
                  <ItemActions>
                    <IconAction label={t('common.remove')} destructive onClick={() => remove(m)}>
                      <X />
                    </IconAction>
                  </ItemActions>
                )}
              </Item>
            );
          })}
        </SettingsList>
      )}

      {editable && (
        <div className="flex flex-col gap-2">
          <GranteePicker
            value={picked}
            onChange={setPicked}
            kinds={GROUP_MEMBER_KINDS}
            exclude={existingKeys}
            placeholder={t('groups.addPlaceholder')}
          />
          {picked.length > 0 && (
            <Button size="sm" onClick={add} disabled={adding}>
              {adding ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {t('groups.addMembers')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
