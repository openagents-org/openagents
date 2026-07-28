'use client';

import { useState } from 'react';
import { MoreHorizontal, Crown, UserMinus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/helpers';
import { AgentAvatar } from '@/components/agents/agent-avatar';
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
  const [busy, setBusy] = useState(false);

  const handlePromote = async (agentName: string) => {
    setBusy(true);
    try {
      await workspaceApi.updateAgentRole(agentName, 'master');
      toast.success(`${agentName} promoted to master`);
      await refreshAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (agentName: string) => {
    const ok = await confirm({
      title: 'Remove agent?',
      description: `${agentName} will be removed from this workspace.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await workspaceApi.removeAgent(agentName);
      toast.success(`${agentName} removed`);
      await refreshAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove agent');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <SectionHeader label="Agents" />
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
                <p className="text-sm font-medium truncate">{agent.agentName}</p>
                <p className="text-xs text-muted-foreground">
                  {agent.agentType && <span className="capitalize">{agent.agentType} · </span>}
                  {isOnline
                    ? 'Online'
                    : agent.lastHeartbeatAt
                      ? `Last seen ${timeAgo(agent.lastHeartbeatAt)}`
                      : 'Offline'}
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
                        Set as Master
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleRemove(agent.agentName)}
                    >
                      <UserMinus className="size-4" />
                      Remove
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
