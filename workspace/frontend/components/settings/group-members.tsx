'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { GranteePicker, invalidateGranteeCandidates } from '@/components/sharing/grantee-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { GROUP_MEMBER_KINDS, granteeChipLabel, granteeFromMember, granteeKey } from '@/lib/access-ui';
import { workspaceApi } from '@/lib/api';
import { displayNameFromEmail } from '@/lib/collab';
import { useT } from '@/lib/i18n';
import type { Grantee, GroupMember, SecurityGroup } from '@/lib/types';

/** Who is in one security group, with add/remove for custom groups. */
export function GroupMembers({
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{title}</p>
        {derived && <p className="text-xs text-muted-foreground">{t('groups.derivedMembership')}</p>}
      </div>

      {list === null ? (
        <div className="flex items-center justify-center py-6">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : failed ? (
        <p className="text-sm text-destructive">{t('groups.membersLoadFailed')}</p>
      ) : list.length === 0 ? (
        !derived && <p className="text-sm text-muted-foreground">{t('groups.noMembers')}</p>
      ) : (
        <Card className="gap-0 divide-y py-0" role="list">
          {list.map((m) => {
            const isAgent = m.principal_kind === 'agent';
            const name = m.display_name || (isAgent ? m.principal_id : memberName(m.principal_id));
            return (
              <div role="listitem" key={`${m.principal_kind}:${m.principal_id}`} className="flex items-center gap-2 px-3 py-1.5">
                {isAgent ? (
                  <AgentAvatar name={m.principal_id} size={24} />
                ) : (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {name[0]?.toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm">
                    <span className="truncate">{name}</span>
                    <Badge variant="outline" className="shrink-0">
                      {isAgent ? t('collab.kindAgent') : t('collab.kindPerson')}
                    </Badge>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.principal_id}
                    {m.added_by && ` · ${t('groups.addedBy', { name: displayNameFromEmail(m.added_by) })}`}
                  </p>
                </div>
                {editable && (
                  <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={() => remove(m)} title={t('common.remove')} aria-label={t('common.remove')}>
                    <X />
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
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
