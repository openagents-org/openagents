'use client';
import { ChevronRight, HardDrive, Laptop, Monitor, Server, Trash2 } from 'lucide-react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFormatters, useT } from '@/lib/i18n';
import type { NodeAgent, WorkspaceNode } from '@/lib/types';
import { cn } from '@/lib/utils';

function DeviceIcon({ deviceType }: { deviceType: string }) {
  switch (deviceType) {
    case 'server': return <Server />;
    case 'laptop': return <Laptop />;
    case 'desktop': return <Monitor />;
    default: return <HardDrive />;
  }
}

function deviceLabel(t: ReturnType<typeof useT>, deviceType: string) {
  switch (deviceType) {
    case 'server': return t('connect.nodeDeviceServer');
    case 'laptop': return t('connect.nodeDeviceLaptop');
    case 'desktop': return t('connect.nodeDeviceDesktop');
    default: return t('connect.nodeDeviceUnknown');
  }
}

/** Agent marks shown on the collapsed row before the rest fold into "+N". */
const PREVIEW_AGENTS = 5;

/**
 * A device's summary row: what it is, what runs on it at a glance, whether it
 * is online — and the two things to do with the device itself, remove it or
 * open its agents.
 */
export function NodeSummary({
  node,
  agents,
  isThisComputer,
  expanded,
  busy,
  agentStatusLabel,
  onExpand,
  onRemove,
}: {
  node: WorkspaceNode;
  agents: NodeAgent[];
  isThisComputer: boolean;
  expanded: boolean;
  busy: boolean;
  agentStatusLabel: (status: string) => string;
  onExpand: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const online = node.status === 'online';
  const previewAgents = agents.slice(0, PREVIEW_AGENTS);
  const extraAgents = agents.length - previewAgents.length;
  const runningCount = agents.filter((a) => a.status === 'running').length;
  const controls = `device-agents-${node.nodeId}`;

  return (
    <div className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50">
      <button
        onClick={onExpand}
        aria-expanded={expanded}
        aria-controls={controls}
        className="flex min-w-0 flex-1 items-center gap-3.5 text-left"
      >
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-5">
          <DeviceIcon deviceType={node.deviceType} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{node.name}</span>
            <Badge variant="secondary">{deviceLabel(t, node.deviceType)}</Badge>
            {isThisComputer && (
              <Badge variant="outline" data-testid="node-this-computer">{t('nav.thisComputer')}</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{t('connect.nodePrivateConnection')}</div>
          {agents.length > 0 ? (
            // What runs here at a glance: overlapping type marks and a count.
            <div className="flex items-center gap-2">
              <div className="flex *:not-first:-ml-1.5">
                {previewAgents.map((a) => (
                  <div key={a.name} className="relative flex" title={`${a.displayName ? `${a.displayName} (@${a.name})` : `@${a.name}`} · ${a.type} · ${agentStatusLabel(a.status)}`}>
                    <AgentIcon name={a.type} size={20} chip className="outline-2 outline-background" />
                    <span className={cn(
                      'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-background',
                      online && a.status === 'running' ? 'bg-success' : 'bg-muted-foreground/60',
                    )} />
                  </div>
                ))}
                {extraAgents > 0 && (
                  <div className="flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1 text-xs font-medium text-muted-foreground outline-2 outline-background">
                    +{extraAgents}
                  </div>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {!online
                  ? t('connect.nodeLastReportedAgentCount', { count: agents.length })
                  : runningCount > 0
                    ? t('connect.nodeCountRunning', { count: runningCount })
                    : `${agents.length} ${t('connect.nodeAgents').toLowerCase()}`}
              </span>
            </div>
          ) : (node.os || node.launcherVersion) && (
            <div className="flex items-center gap-1.5">
              {node.os && <Badge variant="outline" className="font-normal text-muted-foreground">{node.os}</Badge>}
              {node.launcherVersion && <Badge variant="outline" className="font-normal text-muted-foreground">v{node.launcherVersion}</Badge>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={online ? 'success' : 'secondary'}>
            <span className={cn('size-1.5 rounded-full', online ? 'animate-pulse bg-success' : 'bg-muted-foreground/60')} />
            {online ? t('connect.nodeStatusOnline') : t('connect.nodeStatusOffline')}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {node.lastHeartbeatAt
              ? t('connect.nodeLastSeen', { time: timeAgo(node.lastHeartbeatAt) })
              : t('connect.nodeNeverSeen')}
          </span>
        </div>
      </button>
      {/* Remove the device — always on offer, offline devices included. */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        disabled={busy}
        title={t('connect.nodeRemove')}
        aria-label={t('connect.nodeRemove')}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onExpand}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-label={t('connect.nodeToggleDetails')}
        className="text-muted-foreground"
      >
        <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} />
      </Button>
    </div>
  );
}
