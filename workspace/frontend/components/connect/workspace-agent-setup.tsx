'use client';
import { useMemo } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { AgentSetup } from '@/components/agents/agent-setup';
import { useLocalNodeId } from './use-local-node-id';
import type { CloudAgentProvider } from '@/lib/types';
import { AddModelAccessDialog } from '@/components/settings/model-access-dialog';

export function WorkspaceAgentSetup({ cloudProviders, ...props }: Omit<React.ComponentProps<typeof AgentSetup>, 'api' | 'extensions'> & { cloudProviders: CloudAgentProvider[] }) {
  const { workspace, agents, refreshWorkspace } = useWorkspace();
  const t = useT();
  const takenNames = useMemo(() => agents.map((agent) => agent.agentName), [agents]);
  const localNodeId = useLocalNodeId(workspace?.workspaceId);
  return <AgentSetup {...props} api={workspaceApi}
    contextLabel={<>{workspace?.name} · {t('connect.agentRunsOn', { device: localNodeId === props.node.nodeId ? t('nav.thisComputer') : props.node.name })}</>}
    extensions={{
      guided: true,
      takenNames,
      renameAgent: async (name, displayName) => {
        await workspaceApi.updateMember(name, { display_name: displayName });
        await refreshWorkspace();
      },
      modelAccessDialog: (dialog) => <AddModelAccessDialog providers={cloudProviders} {...dialog} />,
    }} />;
}
