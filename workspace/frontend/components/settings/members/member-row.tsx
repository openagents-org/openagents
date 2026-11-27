'use client';

import { Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IconAction } from '@/components/settings/icon-action';
import { useT } from '@/lib/i18n';
import { roleLabel } from '@/lib/roles';
import type { TeamMember, WorkspaceRole } from '@/lib/types';

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];

/** One person in the workspace: who they are, and their role (editable by admins). */
export function MemberRow({
  member: m,
  isSelf,
  editable,
  onChangeRole,
  onRemove,
}: {
  member: TeamMember;
  isSelf: boolean;
  editable: boolean;
  onChangeRole: (role: WorkspaceRole) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <Item size="sm">
      <ItemMedia>
        <Avatar>
          {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
          <AvatarFallback className="text-xs font-semibold">
            {(m.displayName || m.email)[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>
          <span className="truncate">{m.displayName || m.email}</span>
          {isSelf && <span className="text-xs font-normal text-muted-foreground">({t('admin.you')})</span>}
        </ItemTitle>
        {m.displayName && <ItemDescription className="line-clamp-1 text-xs">{m.email}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        {editable ? (
          <>
            <Select value={m.role} onValueChange={(v) => onChangeRole(v as WorkspaceRole)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{roleLabel(t, r)}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <IconAction size="icon" label={t('admin.removeMember')} destructive onClick={onRemove}>
              <Trash2 />
            </IconAction>
          </>
        ) : (
          <Badge variant="secondary">{roleLabel(t, m.role)}</Badge>
        )}
      </ItemActions>
    </Item>
  );
}
