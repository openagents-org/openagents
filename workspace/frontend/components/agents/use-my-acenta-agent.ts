'use client';

import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { AcentaAgent } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';

/** Acenta independently verifies this viewer as the owner of the box. */
export function useMyAcentaAgent(agentName: string | undefined) {
  const { workspace, currentUser } = useWorkspace();
  const workspaceId = workspace?.workspaceId;
  const userId = currentUser?.isAuthenticated ? currentUser.id : undefined;
  const key = workspaceId && userId && agentName && /^acenta-[a-f0-9]{8}$/i.test(agentName)
    ? `${workspaceId}:${userId}:${agentName}` : null;
  const [result, setResult] = useState<{ key: string; agent: AcentaAgent | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let current = true;
    workspaceApi.listMyAcentaAgents().then(({ agents }) => {
      if (current) setResult({ key, agent: agents.find(item => item.agentName === agentName && item.inThisWorkspace) ?? null });
    }).catch(() => {});
    return () => { current = false; };
  }, [agentName, key]);
  return result?.key === key ? result.agent : null;
}
