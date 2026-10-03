'use client';

/**
 * Permission model v1.1 — the two little facts an owned artifact (file,
 * knowledge entry) carries everywhere it is listed: who owns it and whether
 * it is Private / Public / Inherits thread. Pure display; the share surface
 * lives in ./artifact-share.tsx.
 */

import { Globe, Lock, MessagesSquare } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { useT } from '@/lib/i18n';
import type { ArtifactVisibility } from '@/lib/types';
import {
  ownerDisplay,
  visibilityBadgeFor,
  visibilityBadgeLabel,
  type ArtifactKind,
  type VisibilityBadge,
} from '@/lib/artifact-access';
import { cn } from '@/lib/utils';

export function VisibilityIcon({ badge, className }: { badge: VisibilityBadge; className?: string }) {
  const Icon = badge === 'public' ? Globe : badge === 'private' ? Lock : MessagesSquare;
  return <Icon className={cn('size-3', className)} />;
}

export interface ArtifactVisibilityBadgeProps {
  kind: ArtifactKind;
  visibility: ArtifactVisibility | null | undefined;
  effectiveVisibility?: ArtifactVisibility | null;
  size?: 'xs' | 'sm';
  className?: string;
}

/** "Private" / "Public" / "Inherits thread · Public" chip with a tooltip hint. */
export function ArtifactVisibilityBadge({ kind, visibility, effectiveVisibility, size = 'xs', className }: ArtifactVisibilityBadgeProps) {
  const t = useT();
  const badge = visibilityBadgeFor(kind, visibility, effectiveVisibility);
  const hint =
    badge === 'private' ? t('artifactAccess.privateHint')
    : badge === 'public' ? t('artifactAccess.publicHint')
    : t('artifactAccess.inheritsHint');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={badge === 'private' ? 'warning' : badge === 'public' ? 'success' : 'secondary'}
          appearance="light"
          size={size}
          className={cn('shrink-0 gap-1 font-normal', className)}
        >
          <VisibilityIcon badge={badge} />
          {visibilityBadgeLabel(t, badge, badge === 'inherit' ? effectiveVisibility : undefined)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  );
}

export interface ArtifactOwnerProps {
  owner: string | null | undefined;
  ownerLabel?: string | null;
  /** Avatar only (tight list rows) or avatar + name. */
  compact?: boolean;
  size?: number;
  className?: string;
}

/** Owner avatar (agent artwork or a human initial) with an optional label. */
export function ArtifactOwner({ owner, ownerLabel, compact = false, size = 16, className }: ArtifactOwnerProps) {
  const t = useT();
  const display = ownerDisplay(owner, ownerLabel);
  if (!display.kind && !display.label) return null;
  const title = t('artifactAccess.ownedBy', { owner: display.label });
  const avatar =
    display.kind === 'agent' && display.id ? (
      <AgentAvatar name={display.id} size={size} />
    ) : (
      <Avatar className="shrink-0" style={{ width: size, height: size }}>
        <AvatarFallback className="text-[9px] uppercase">{display.label.charAt(0) || '?'}</AvatarFallback>
      </Avatar>
    );
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex shrink-0 items-center', className)} aria-label={title}>{avatar}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{title}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)} title={title}>
      {avatar}
      <span className="truncate">{display.label}</span>
    </span>
  );
}
