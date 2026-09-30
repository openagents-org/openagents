'use client';

// ── v1.1 M1 — roster hints shared by the rail, drawer, status card, profile ──
// A "Personal" badge (with the owner) on personal agents, and a "device
// offline" marker when the node the agent runs on is down — which is a
// different problem from the agent itself being offline, so it gets its own
// word rather than the grey dot.

import { MonitorOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { displayNameFromEmail } from '@/lib/collab';
import type { WorkspaceAgent } from '@/lib/types';

type HintAgent = Pick<WorkspaceAgent, 'visibility' | 'ownerEmail' | 'runtimeStatus' | 'runtimeName' | 'status'>;

export function isPersonalAgent(agent: HintAgent): boolean {
  return agent.visibility === 'personal';
}

export function isDeviceOffline(agent: HintAgent): boolean {
  return agent.runtimeStatus === 'offline';
}

/** Owner's name for labels: display name when the caller has one, else the
 * email's local part. */
export function agentOwnerLabel(agent: Pick<WorkspaceAgent, 'ownerEmail'>, ownerDisplay?: string | null): string {
  return ownerDisplay?.trim() || displayNameFromEmail(agent.ownerEmail);
}

export function PersonalBadge({ agent, ownerDisplay, className }: { agent: HintAgent; ownerDisplay?: string | null; className?: string }) {
  const t = useT();
  if (!isPersonalAgent(agent)) return null;
  const owner = agentOwnerLabel(agent, ownerDisplay);
  return (
    <Badge
      variant="info"
      appearance="light"
      size="xs"
      className={cn('shrink-0 font-medium', className)}
      title={owner ? t('collab.personalOwnedBy', { owner }) : t('collab.personal')}
    >
      {t('collab.personal')}
    </Badge>
  );
}

/** Icon-only marker (rail, tight rows) or with a label (cards, panels). */
export function DeviceOfflineHint({ agent, withLabel = false, className }: { agent: HintAgent; withLabel?: boolean; className?: string }) {
  const t = useT();
  if (!isDeviceOffline(agent)) return null;
  const label = agent.runtimeName
    ? t('collab.deviceOfflineNamed', { device: agent.runtimeName })
    : t('collab.deviceOffline');
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 text-rose-500/80 dark:text-rose-400/80', className)}
      title={`${label} — ${t('collab.deviceOfflineHint')}`}
      aria-label={label}
    >
      <MonitorOff className="size-3" />
      {withLabel && <span className="text-[11px]">{label}</span>}
    </span>
  );
}

/** Badge + marker together, for a row that has room for both. */
export function AgentRosterHints({ agent, ownerDisplay, className }: { agent: HintAgent; ownerDisplay?: string | null; className?: string }) {
  if (!isPersonalAgent(agent) && !isDeviceOffline(agent)) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      <PersonalBadge agent={agent} ownerDisplay={ownerDisplay} />
      <DeviceOfflineHint agent={agent} />
    </span>
  );
}
