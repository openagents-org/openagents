'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, MessageSquare, Globe, Folder, Monitor, UserRoundCog, Cloud, Trash2 } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { AgentSharingButton } from '@/components/sharing/agent-sharing-button';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { isOwnedAgent } from '@/lib/sidebar-agents';
import { dmSessionId, myAddress } from '@/lib/dm';
import { toast } from 'sonner';
import type { CloudAgentConfig } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { AgentProfileHeader } from './agent-profile-header';
import { AgentDescriptionCard } from './agent-profile-description';
import { ModelCard, ReadOnlyModelCard } from './agent-profile-model-card';
import { InstalledSkillsCard } from './agent-profile-skills';
import { CloudConfigCard, ConnectionDetailsCard, DangerZoneCard, type InfoItem } from './agent-profile-sections';
import { useAgentModelOptions } from './use-agent-model-options';

export function AgentProfilePanel({ docked = false }: { docked?: boolean } = {}) {
  const {
    selectedAgentName, setSelectedAgentName, isMobile, setViewMode, openMobileDetail,
  } = useLayout();
  const { agents, refreshWorkspace, setCurrentSessionId, currentUser } = useWorkspace();
  const confirm = useConfirm();
  const t = useT();

  const agent = agents.find((a) => a.agentName === selectedAgentName);

  const isCloud = agent?.agentType?.startsWith('cloud:') ?? false;

  // Cloud agent config
  const [cloudConfig, setCloudConfig] = useState<CloudAgentConfig | null>(null);
  const loadCloudConfig = useCallback(() => {
    if (!agent) return;
    workspaceApi.listCloudAgents().then((configs) => {
      setCloudConfig(configs.find((c) => c.agentName === agent.agentName) || null);
    }).catch(() => {});
  }, [agent?.agentName]);
  useEffect(() => {
    if (!isCloud || !agent) { setCloudConfig(null); return; }
    loadCloudConfig();
  }, [isCloud, agent?.agentName]);

  // The built-in assistant (Yumi) is server-managed: its model and
  // credentials are fixed by the server and the API rejects changes, so
  // the model picker and key editor below render read-only for it.
  const isManaged = Boolean(agent?.builtin) || Boolean(cloudConfig?.managed);
  // Using an agent someone shared does not make its settings yours: the server
  // refuses changes from anyone but the owner, so they render read-only here
  // rather than failing on save. An agent with no recorded owner predates
  // ownership and stays editable, as the server allows.
  const canManage = !agent?.ownerEmail || isOwnedAgent(agent, currentUser.id);
  const modelReadOnly = isManaged || !canManage;
  const models = useAgentModelOptions({ agent, isCloud, cloudConfig, setCloudConfig, refreshWorkspace });

  const handleRemoveCloudAgent = useCallback(async () => {
    if (!agent) return;
    try {
      await workspaceApi.removeCloudAgent(agent.agentName);
      toast.success(t('agents.removedCloud', { agent: agent.agentName }));
      setSelectedAgentName(null);
      refreshWorkspace();
    } catch {
      toast.error(t('agents.removeCloudFailed'));
    }
  }, [agent, setSelectedAgentName, refreshWorkspace]);

  // Remove a node/local agent from the workspace (works online or offline).
  const handleRemoveAgent = useCallback(async () => {
    if (!agent) return;
    const ok = await confirm({
      title: t('agents.removeAgentTitle', { agent: agent.agentName }),
      description: t('agents.removeAgentBody'),
      confirmText: t('agents.remove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.removeMember(agent.agentName);
      toast.success(t('agents.removed', { agent: agent.agentName }));
      setSelectedAgentName(null);
      refreshWorkspace();
    } catch {
      toast.error(t('agents.removeFailed'));
    }
  }, [agent, confirm, t, setSelectedAgentName, refreshWorkspace]);

  const handleDirectMessage = useCallback(() => {
    if (!agent) return;
    setCurrentSessionId(dmSessionId(myAddress(currentUser), `openagents:${agent.agentName}`));
    setSelectedAgentName(null);
    setViewMode('threads');
    // On mobile the panel can be opened from either pane, so send the user to
    // the detail pane explicitly so the direct message is visible.
    if (isMobile) openMobileDetail();
  }, [agent, currentUser, setCurrentSessionId, setSelectedAgentName, setViewMode, isMobile, openMobileDetail]);

  if (!agent) return null;

  // Capitalize agent type for display (e.g. "claude" → "Claude", "cloud:openai" → "Cloud: OpenAI")
  const cloudType = (agent.agentType || '').replace('cloud:', '');
  const displayType = isCloud
    ? `Cloud: ${cloudType.charAt(0).toUpperCase()}${cloudType.slice(1)}`
    : agent.agentType
      ? agent.agentType.charAt(0).toUpperCase() + agent.agentType.slice(1)
      : t('common.unknown');

  const agentId: InfoItem = { icon: <UserRoundCog className="size-3.5" />, label: t('agents.fieldAgentId'), value: `openagents:${agent.agentName}`, copyable: true };
  const infoItems: InfoItem[] = isCloud
    ? [
        { icon: <Cloud className="size-3.5" />, label: t('agents.fieldType'), value: displayType },
        { icon: <Globe className="size-3.5" />, label: t('agents.fieldApiKey'), value: cloudConfig?.apiKeyMasked || '—' },
        agentId,
      ]
    : [
        { icon: <Monitor className="size-3.5" />, label: t('agents.fieldType'), value: displayType },
        { icon: <Globe className="size-3.5" />, label: t('agents.fieldServer'), value: agent.serverHost || '—' },
        { icon: <Folder className="size-3.5" />, label: t('agents.fieldFolder'), value: agent.workingDir || '—' },
        agentId,
      ];

  return (
    <>
      {/* Backdrop — only for the slide-over form; a docked panel sits beside
          the content (e.g. next to the agent's DM) and must not block it. */}
      {!docked && (
        <div
          className="absolute inset-0 z-10 bg-black/10"
          onClick={() => setSelectedAgentName(null)}
        />
      )}

      {/* Panel — docked 20rem column beside the thread, or a slide-over
          (full-width on mobile, 20rem on desktop). */}
      <div className={cn(
        'flex flex-col border-l bg-background animate-in slide-in-from-right duration-200',
        docked
          ? 'relative h-full w-90 shrink-0 xl:w-96'
          : cn('absolute top-0 right-0 bottom-0 z-20 shadow-xl', isMobile ? 'left-0 w-full' : 'w-90 max-w-full xl:w-96'),
      )}>
        {/* Close button */}
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">{t('agents.panelTitle')}</h2>
          <Button
            onClick={() => setSelectedAgentName(null)}
            variant="ghost" size="icon-sm" className="text-muted-foreground"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X />
          </Button>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 [&>[data-slot=card]]:shrink-0">
          <div className="border-b py-5">
            <AgentProfileHeader agent={agent} canManage={canManage} refreshWorkspace={refreshWorkspace} />
            <div className="mt-4 flex empty:hidden [&>button]:flex-1"><AgentSharingButton agentName={agent.agentName} /></div>
          </div>
          <AgentDescriptionCard agent={agent} canManage={canManage} refreshWorkspace={refreshWorkspace} />

          {/* The built-in assistant shows its server-set model read-only. */}
          {modelReadOnly
            ? <ReadOnlyModelCard model={models.currentModel} managed={isManaged} />
            : <ModelCard m={models} />}

          {/* Cloud config management — hidden for the built-in: nothing is
              user-configurable there (key and prompt are server-owned). */}
          {isCloud && cloudConfig && !isManaged && canManage && (
            <CloudConfigCard agentName={agent.agentName} config={cloudConfig} onUpdated={loadCloudConfig} />
          )}

          <InstalledSkillsCard agent={agent} />

          <ConnectionDetailsCard items={infoItems} />

          {!isCloud && canManage && <DangerZoneCard onRemove={handleRemoveAgent} />}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 border-t bg-background px-5 py-4">
          <div className="flex gap-2">
            <Button className="h-9 flex-1" onClick={handleDirectMessage}>
              <MessageSquare data-icon="inline-start" />
              {t('agents.directMessage')}
            </Button>
            {isCloud && canManage && (
              <Button variant="destructive" onClick={handleRemoveCloudAgent} title={t('agents.removeCloud')}>
                <Trash2 data-icon="inline-start" />
                {t('agents.remove')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
