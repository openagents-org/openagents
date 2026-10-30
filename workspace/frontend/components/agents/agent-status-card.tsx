'use client';

import { useState } from 'react';
import { MoreHorizontal, Crown, UserMinus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormatters, useT } from '@/lib/i18n';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { DeviceOfflineHint, PersonalBadge } from '@/components/agents/agent-roster-hints'; // v1.1 M1
import { agentLabel } from '@/lib/helpers';
import { agentAvailability, availabilityDotClass, availabilityLabel } from '@/lib/collab'; // v1.1 M3
import { SectionHeader } from '@/components/sessions/section-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { toast } from 'sonner';
import type { WorkspaceAgent } from '@/lib/types';

interface AgentStatusCardProps {
  agents: WorkspaceAgent[];
}

export function AgentStatusCard({ agents }: AgentStatusCardProps) {
  const { refreshAgents, sessions, pendingApprovalsByAgent } = useWorkspace();
  const confirm = useConfirm();
  const t = useT();
  const { timeAgo } = useFormatters();
  const [busy, setBusy] = useState(false);

  // v1.1 M3: busy channels arrive as channel ids; show the thread's title
  // when we know it so "working in #…" reads like the thread list.
  const threadName = (channel: string) => {
    const title = sessions.find((s) => s.sessionId === channel)?.title?.trim();
    return `#${title || channel}`;
  };

  const handlePromote = async (agentName: string) => {
    setBusy(true);
    try {
      await workspaceApi.updateAgentRole(agentName, 'master');
      toast.success(t('agents.promoted', { agent: agentName }));
      await refreshAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('agents.roleFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (agentName: string) => {
    const ok = await confirm({
      title: t('agents.removeTitle'),
      description: t('agents.removeDescription', { agent: agentName }),
      confirmText: t('agents.remove'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await workspaceApi.removeAgent(agentName);
      toast.success(t('agents.removed', { agent: agentName }));
      await refreshAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('agents.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <SectionHeader label={t('agents.label')} />
      <div className="space-y-1.5">
        {agents.map((agent) => {
          const isMaster = agent.role === 'master';
          // v1.1 M3: the same availability vocabulary as the roster/directory
          // instead of a binary online/offline.
          const availability = agentAvailability(agent, pendingApprovalsByAgent[agent.agentName] ?? 0);
          const busyChannels = agent.busyChannels ?? [];
          const queueDepth = agent.queueDepth ?? 0;

          return (
            <div
              key={agent.agentName}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md group"
            >
              <AgentAvatar name={agent.agentName} size={28} status={agent.status} showStatus />
              <div className="flex-1 min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium truncate">
                  <span className="truncate">{agentLabel(agent)}</span>
                  {/* v1.1 M1: personal agents carry their owner */}
                  <PersonalBadge agent={agent} />
                </p>
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  {agent.agentType && <span className="capitalize">{agent.agentType} · </span>}
                  {availability === 'device_offline' ? (
                    // v1.1 M1: the device is down — not the same as a quiet agent
                    <DeviceOfflineHint agent={agent} withLabel />
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <span className={cn('size-1.5 rounded-full', availabilityDotClass(availability))} />
                      {availabilityLabel(t, availability, queueDepth)}
                    </span>
                  )}
                  {availability === 'offline' && agent.lastHeartbeatAt && (
                    <span>· {t('agents.lastSeen', { time: timeAgo(agent.lastHeartbeatAt) })}</span>
                  )}
                </p>
                {busyChannels.length > 0 && (
                  <p className="truncate text-[11px] text-muted-foreground" title={busyChannels.map(threadName).join(', ')}>
                    {t('collab.presence.workingIn', { threads: busyChannels.map(threadName).join(', ') })}
                  </p>
                )}
              </div>
              <span className={cn(
                'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-medium',
                isMaster
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'text-muted-foreground'
              )}>
                {agent.role}
              </span>

              {/* Management dropdown — only show when multiple agents */}
              {agents.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      disabled={busy}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!isMaster && (
                      <DropdownMenuItem onClick={() => handlePromote(agent.agentName)}>
                        <Crown className="size-4 text-amber-500" />
                        {t('agents.setAsMaster')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleRemove(agent.agentName)}
                    >
                      <UserMinus className="size-4" />
                      {t('agents.remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
