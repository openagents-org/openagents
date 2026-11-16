'use client';

import { Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
    <div className="flex items-center gap-3 px-4 py-3">
      <Avatar>
        {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {(m.displayName || m.email)[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {m.displayName || m.email}
          {isSelf && <span className="ms-1.5 text-xs font-normal text-muted-foreground">({t('admin.you')})</span>}
        </p>
        {m.displayName && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
      </div>
      {editable ? (
        <>
          <Select value={m.role} onValueChange={(v) => onChangeRole(v as WorkspaceRole)}>
            <SelectTrigger className="w-28 shrink-0">
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
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            title={t('admin.removeMember')}
            aria-label={t('admin.removeMember')}
            className="text-muted-foreground"
          >
            <Trash2 />
          </Button>
        </>
      ) : (
        <Badge variant="secondary">{roleLabel(t, m.role)}</Badge>
      )}
    </div>
  );
}
