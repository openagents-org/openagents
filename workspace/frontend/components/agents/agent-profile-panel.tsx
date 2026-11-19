'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { X, MessageSquare, Globe, Monitor, UserRoundCog, Cloud, Trash2 } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { AgentSharingButton } from '@/components/sharing/agent-sharing-button';
import { workspaceApi } from '@/lib/api';
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
import { WorkdirCard } from './agent-profile-workdir-card';

export function AgentProfilePanel({ docked = false }: { docked?: boolean } = {}) {
  const {
    selectedAgentName, setSelectedAgentName, isMobile, setViewMode, openMobileDetail,
  } = useLayout();
  const close = useCallback(() => setSelectedAgentName(null), [setSelectedAgentName]);
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
    const ok = await confirm({
      title: t('agents.removeAgentTitle', { agent: agent.agentName }),
      description: t('agents.removeCloudBody'),
      confirmText: t('agents.remove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await workspaceApi.removeCloudAgent(agent.agentName);
      toast.success(t('agents.removedCloud', { agent: agent.agentName }));
      setSelectedAgentName(null);
      refreshWorkspace();
    } catch {
      toast.error(t('agents.removeCloudFailed'));
    }
  }, [agent, confirm, setSelectedAgentName, refreshWorkspace]);

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
        agentId,
      ];

  const body = (
    <div className="flex flex-col divide-y">
      <div className="py-5">
        <AgentProfileHeader agent={agent} canManage={canManage} refreshWorkspace={refreshWorkspace} />
        <div className="mt-4 flex empty:hidden [&>button]:flex-1"><AgentSharingButton agentName={agent.agentName} /></div>
      </div>

      {/* The settings people come here to change, first: the name is
          edited in the header above, then the model and the folder. The
          built-in assistant shows its server-set model read-only. */}
      {modelReadOnly
        ? <ReadOnlyModelCard model={models.currentModel} managed={isManaged} />
        : <ModelCard m={models} />}
      {!isCloud && <WorkdirCard agent={agent} canManage={canManage} />}

      <AgentDescriptionCard agent={agent} canManage={canManage} refreshWorkspace={refreshWorkspace} />

      {/* Cloud config management — hidden for the built-in: nothing is
          user-configurable there (key and prompt are server-owned). */}
      {isCloud && cloudConfig && !isManaged && canManage && (
        <CloudConfigCard agentName={agent.agentName} config={cloudConfig} onUpdated={loadCloudConfig} />
      )}

      <InstalledSkillsCard agent={agent} />

      <ConnectionDetailsCard items={infoItems} />

      {!isCloud && canManage && <DangerZoneCard onRemove={handleRemoveAgent} />}
    </div>
  );

  const actions = (
    <>
      <Button className="flex-1" onClick={handleDirectMessage}>
        <MessageSquare data-icon="inline-start" />
        {t('agents.directMessage')}
      </Button>
      {isCloud && canManage && (
        <Button variant="destructive" onClick={handleRemoveCloudAgent}>
          <Trash2 data-icon="inline-start" />
          {t('agents.remove')}
        </Button>
      )}
    </>
  );

  const closeButton = (
    <WithTooltip label={t('common.close')}><Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t('common.close')} onClick={close}>
          <X />
        </Button></WithTooltip>
  );

  // Docked beside the agent's DM: a plain column that must not block the
  // thread next to it.
  if (docked) {
    return (
      <aside aria-label={t('agents.panelTitle')} className="flex h-full w-90 shrink-0 flex-col border-l bg-background xl:w-96">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b py-3 pr-4 pl-6">
          <h2 className="font-heading text-base font-medium">{t('agents.panelTitle')}</h2>
          {closeButton}
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-6">{body}</div>
        <div className="flex shrink-0 gap-2 border-t px-6 py-4">{actions}</div>
      </aside>
    );
  }

  // Everywhere else the profile slides over the view as a sheet, full width
  // on phones. Non-modal, like the slide-over it replaced: no page-wide
  // overlay or focus trap, so the sidebar stays usable (picking another agent
  // switches the profile) and a click outside still closes it.
  return (
    <Sheet open modal={false} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        // Focus the sheet itself: landing on the close button would open its
        // tooltip the moment the profile appears.
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).focus(); }}
        // Clicking another agent in the sidebar switches the profile in
        // place, and a toast is not "outside" in any useful sense: neither
        // should close the sheet first (that remounted it and replayed its
        // entry animation). Any other outside click still closes it.
        onInteractOutside={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('[data-slot="sidebar"], [data-sonner-toaster]')) event.preventDefault();
        }}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:w-90 data-[side=right]:xl:w-96"
      >
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b py-3 pr-4 pl-6">
          <SheetTitle>{t('agents.panelTitle')}</SheetTitle>
          {closeButton}
        </SheetHeader>
        <SheetBody className="overscroll-contain">{body}</SheetBody>
        <SheetFooter className="flex-row border-t px-6 py-4">{actions}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
