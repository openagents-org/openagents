'use client';

import { useState } from 'react';
import { MoreHorizontal, Crown, UserMinus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormatters, useT } from '@/lib/i18n';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
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
  const { refreshAgents } = useWorkspace();
  const confirm = useConfirm();
  const t = useT();
  const { timeAgo } = useFormatters();
  const [busy, setBusy] = useState(false);

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
          const isOnline = agent.status === 'online';
          const isMaster = agent.role === 'master';

          return (
            <div
              key={agent.agentName}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md group"
            >
              <AgentAvatar name={agent.agentName} size={28} status={agent.status} showStatus />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{agentLabel(agent)}</p>
                <p className="text-xs text-muted-foreground">
                  {agent.agentType && <span className="capitalize">{agent.agentType} · </span>}
                  {isOnline
                    ? t('agents.online')
                    : agent.lastHeartbeatAt
                      ? t('agents.lastSeen', { time: timeAgo(agent.lastHeartbeatAt) })
                      : t('agents.offline')}
                </p>
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
