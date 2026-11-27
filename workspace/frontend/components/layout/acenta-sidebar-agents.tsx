'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Cloud } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { AcentaAgent, WorkspaceAgent } from '@/lib/types';
import { isOwnedAgent } from '@/lib/sidebar-agents';
import { useWorkspace } from '@/lib/workspace-context';

/** A box awaiting setup or its first join may be owned on Acenta before
 * Workspace discovery includes it. Only show boxes the owner can manage. */
export function useAcentaSidebarAgents(roster: WorkspaceAgent[]) {
  const { workspace, currentUser } = useWorkspace();
  const workspaceId = workspace?.workspaceId;
  const owner = currentUser.isAuthenticated ? currentUser.id : undefined;
  const key = workspaceId && owner ? `${workspaceId}:${owner}` : null;
  const [snapshot, setSnapshot] = useState<{ key: string; agents: AcentaAgent[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    const currentKey = key;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const { agents } = await workspaceApi.listMyAcentaAgents();
        if (active) setSnapshot({ key: currentKey, agents });
      } catch {
        if (active) setSnapshot(null);
      } finally {
        if (active) timer = setTimeout(load, 15_000);
      }
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [key]);
  const owned = snapshot?.key === key ? snapshot.agents.filter(agent => agent.inThisWorkspace) : [];
  const discovered = new Set(roster.filter(agent => owner && isOwnedAgent(agent, owner)).map(agent => agent.agentName));
  const pending = owned.filter(agent => !discovered.has(agent.agentName));
  const pendingNames = new Set(pending.map(agent => agent.agentName));
  const labels = new Map(owned.map(agent => [agent.agentName, agent.name]));
  const visibleRoster = roster.filter(agent => !pendingNames.has(agent.agentName)).map(agent => {
    const label = labels.get(agent.agentName);
    return label ? { ...agent, displayName: label } : agent;
  });
  return { pending, roster: visibleRoster };
}

export function AcentaSidebarRows({ agents, onNavigate }: { agents: AcentaAgent[]; onNavigate?: () => void }) {
  const t = useT();
  return agents.map(agent => {
    const label = agent.launchUrl ? t('connect.acentaFinishSetup') : t('connect.acentaManage');
    return (
      <SidebarMenuItem key={agent.id}>
        <SidebarMenuButton asChild tooltip={{ children: `${agent.name} · ${label}` }}>
          <a href={agent.launchUrl || agent.url} onClick={onNavigate}>
            <Cloud aria-hidden />
            <span className="min-w-0 truncate">{agent.name}</span>
            <ArrowUpRight className="ml-auto size-3! text-muted-foreground" aria-label={label} />
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}
