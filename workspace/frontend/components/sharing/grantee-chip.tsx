'use client';

import { Bot, Users, UsersRound, X } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { granteeChipLabel } from '@/lib/access-ui';
import { useT } from '@/lib/i18n';
import type { Grantee, GranteeKind } from '@/lib/types';
import { cn } from '@/lib/utils';

export function KindIcon({ kind, className }: { kind: GranteeKind; className?: string }) {
  if (kind === 'agent') return <Bot className={className} />;
  if (kind === 'group') return <UsersRound className={className} />;
  return <Users className={className} />;
}

export function CandidateAvatar({ c }: { c: Grantee }) {
  if (c.kind === 'agent') return <AgentAvatar name={c.id} size={20} />;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
      {c.kind === 'group' ? <UsersRound className="size-3" /> : (c.label || c.id)[0]?.toUpperCase()}
    </span>
  );
}

/** A selected (or granted) principal as a removable chip. */
export function GranteeChip({
  grantee,
  onRemove,
  muted,
  className,
}: {
  grantee: Grantee;
  onRemove?: () => void;
  /** Struck-through look for an expired grant. */
  muted?: boolean;
  className?: string;
}) {
  const t = useT();
  return (
    <Badge
      variant="outline"
      className={cn('max-w-full bg-muted/50 pl-1 font-normal', onRemove && 'pr-0.5', muted && 'line-through opacity-60', className)}
      title={grantee.id}
    >
      {grantee.kind === 'agent'
        ? <AgentAvatar name={grantee.id} size={16} />
        : <KindIcon kind={grantee.kind} className="text-muted-foreground" />}
      <span className="truncate">{granteeChipLabel(grantee)}</span>
      {onRemove && (
        <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label={t('common.remove')} className="size-4 rounded-full text-muted-foreground">
          <X />
        </Button>
      )}
    </Badge>
  );
}
