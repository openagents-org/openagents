'use client';

// ── v1.1 M1 — roster hints shared by the rail, drawer and profile ──
// A "device offline" marker when the node the agent runs on is down — which
// is a different problem from the agent itself being offline, so it gets its
// own word rather than the grey dot.

import { MonitorOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type { WorkspaceAgent } from '@/lib/types';

type HintAgent = Pick<WorkspaceAgent, 'isShared' | 'runtimeStatus' | 'runtimeName'>;

export function isDeviceOffline(agent: HintAgent): boolean {
  return agent.runtimeStatus === 'offline';
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
      className={cn('inline-flex shrink-0 items-center gap-1 text-destructive/80', className)}
      title={`${label} — ${t('collab.deviceOfflineHint')}`}
      aria-label={label}
    >
      <MonitorOff className="size-3" />
      {withLabel && <span className="text-xs">{label}</span>}
    </span>
  );
}

/** Badge + marker together, for a row that has room for both. */
export function AgentRosterHints({ agent, className, showShared = true }: { agent: HintAgent; className?: string; showShared?: boolean }) {
  const t = useT();
  if (!(showShared && agent.isShared) && !isDeviceOffline(agent)) return null;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {showShared && agent.isShared && <Badge variant="secondary" className="shrink-0 font-medium">{t('collab.shared')}</Badge>}
      <DeviceOfflineHint agent={agent} />
    </span>
  );
}
