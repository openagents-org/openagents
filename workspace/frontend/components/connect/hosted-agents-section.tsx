'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { capture } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/dialogs-provider';
import type { AcentaAccount, AcentaAgent, HostedAgent, HostedAgentProvider } from '@/lib/types';

const STARTUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Acenta cloud agents. A signed-in member sees their own Acenta agents — any
 * of them can join this workspace — and can create one; someone without an
 * Acenta account sets one up, which creates the account on Acenta's sign-in.
 * Runtimes join as normal agents, so presence is their real heartbeat.
 */
export function HostedAgentsSection({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const confirm = useConfirm();
  const [provider, setProvider] = useState<HostedAgentProvider | null>(null);
  const [hosted, setHosted] = useState<HostedAgent[]>([]);
  // null: unknown (not signed in, or Acenta unreachable) — fall back to the workspace list.
  const [account, setAccount] = useState<AcentaAccount | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [name, setName] = useState('');
  const [launching, setLaunching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(() => {
    workspaceApi.listHostedAgents().then(setHosted).catch(() => {});
    workspaceApi.listMyAcentaAgents().then(setAccount).catch(() => setAccount(null));
  }, []);

  useEffect(() => {
    workspaceApi.getHostedProviders()
      .then((list) => setProvider(list.find((p) => p.name === 'acenta') ?? null))
      .catch(() => {});
    load();
  }, [load]);

  // A freshly launched or added agent takes a while to come online; poll until it has.
  const waiting = hosted.some((a) => a.presence !== 'online');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  if (!provider) return null;

  const mine = account?.agents ?? [];
  const myNames = new Set(mine.map((a) => a.agentName));
  const others = hosted.filter((h) => !myNames.has(h.agentName));
  const atLimit = !!account?.hasAccount && account.agentLimit > 0 && mine.length >= account.agentLimit;

  const handleLaunch = async () => {
    const label = name.trim();
    if (!label || launching) return;
    setLaunching(true);
    try {
      const launched = await workspaceApi.launchHostedAgent(label);
      capture('hosted_agent_launched', { provider: 'acenta', setup: !!launched.setupUrl, has_account: !!account?.hasAccount });
      if (launched.setupUrl) {
        // Sign-in and payment finish on Acenta, which sends the user back here.
        window.location.assign(launched.setupUrl);
        return;
      }
      toast.success(t('connect.acentaLaunched', { name: label }));
      setName('');
      setSetupOpen(false);
      load();
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('connect.acentaLaunchFailed'));
    } finally {
      setLaunching(false);
    }
  };

  const handleAdd = async (agent: AcentaAgent) => {
    setAdding(agent.id);
    try {
      await workspaceApi.connectAcentaAgent(agent.id);
      capture('hosted_agent_added', { provider: 'acenta' });
      toast.success(t('connect.acentaAdded', { name: agent.name }));
      load();
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('connect.acentaAddFailed'));
    } finally {
      setAdding(null);
    }
  };

  // Removing an agent from this workspace only disconnects it while it works in
  // other workspaces too; it is ended only when this is its last one.
  const handleRemove = async (agent: HostedAgent, elsewhere = !!agent.linked) => {
    const ok = await confirm({
      title: t('connect.remove'),
      description: elsewhere
        ? t('connect.acentaDisconnectConfirm', { name: agent.displayName })
        : t('connect.acentaRemoveConfirm', { name: agent.displayName }),
      confirmText: t('connect.remove'),
      destructive: !elsewhere,
    });
    if (!ok) return;
    try {
      await workspaceApi.removeHostedAgent(agent.agentName);
      toast.success(t('connect.acentaRemoved', { name: agent.displayName }));
      load();
      onChanged();
    } catch {
      toast.error(t('connect.cloudAgentRemoveFailed'));
    }
  };

  const presence = (agent: HostedAgent) => {
    const online = agent.presence === 'online';
    if (agent.status === 'setup' && agent.setupUrl) {
      return (
        <a href={agent.setupUrl} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {t('connect.acentaFinishSetup')}
          <ArrowUpRight className="size-3" />
        </a>
      );
    }
    // Offline soon after launch means the box is still being prepared.
    const starting = !online && !!agent.createdAt && Date.now() - Date.parse(agent.createdAt) < STARTUP_WINDOW_MS;
    return (
      <span className={cn('flex items-center gap-1.5 text-xs', online ? 'text-emerald-600' : 'text-muted-foreground')}>
        {starting && <Loader2 className="size-3 animate-spin" />}
        {online ? t('connect.acentaOnline') : starting ? t('connect.acentaStarting') : t('connect.acentaOffline')}
      </span>
    );
  };

  const removeButton = (agent: HostedAgent, elsewhere?: boolean) => (
    <button
      onClick={() => handleRemove(agent, elsewhere ?? !!agent.linked)}
      className="size-6 flex items-center justify-center rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
      title={t('connect.remove')}
    >
      <Trash2 className="size-3" />
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-orange-200/70 bg-gradient-to-br from-orange-50/80 via-background to-background dark:border-orange-900/50 dark:from-orange-950/20">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <img src="/providers/acenta.svg" alt="" className="size-14 shrink-0 rounded-xl" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-lg font-semibold tracking-tight">Acenta</h3>
              <span className="rounded-full border border-orange-200/70 bg-orange-100/60 px-2 py-0.5 text-xs font-medium text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200">{t('connect.acentaHostedBadge')}</span>
            </div>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{t('connect.acentaMarketplaceDescription')}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {account && !account.hasAccount ? t('connect.acentaNoAccount')
                : account?.hasAccount && mine.length === 0 ? t('connect.acentaNoAgents')
                : atLimit ? t('connect.acentaAgentLimit', { limit: account!.agentLimit })
                : t('connect.acentaMarketplaceSetup')}
            </p>
          </div>
          <div className="shrink-0 sm:ml-2">
            <Button onClick={() => setSetupOpen(true)} disabled={!provider.available || atLimit} className="w-full sm:w-auto">
              {account?.hasAccount ? <><Plus className="size-3.5 mr-1.5" />{t('connect.acentaNewAgent')}</> : <>{t('connect.acentaGetStarted')} <ArrowUpRight className="size-3.5 ml-1.5" /></>}
            </Button>
            {!provider.available && <p className="mt-2 max-w-48 text-xs text-muted-foreground">{t('connect.acentaUnavailable')}</p>}
          </div>
        </div>
      </div>
      <Dialog open={setupOpen} onOpenChange={(open) => { if (!launching) setSetupOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3"><img src="/providers/acenta.svg" alt="" className="size-9 rounded-lg" />{t('connect.acentaTitle')}</DialogTitle>
            <DialogDescription>{t('connect.acentaSetupHint')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="acenta-agent-name">{t('connect.agentName')}</Label>
            <Input id="acenta-agent-name" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); handleLaunch(); } }}
              placeholder={t('connect.acentaNamePlaceholder')} maxLength={60} disabled={launching} className="mt-2" />
          </DialogBody>
          <DialogFooter>
            <Button onClick={handleLaunch} disabled={launching || !name.trim()}>
              {launching && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
              {t('connect.acentaContinue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {mine.length > 0 && <div className="pt-2 text-xs font-medium text-muted-foreground">{t('connect.acentaYourAgents')}</div>}
      {mine.map((agent) => {
        const here = hosted.find((h) => h.agentName === agent.agentName);
        const full = agent.workspaces >= agent.workspaceLimit;
        return (
          <div key={agent.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border bg-background">
            <img src="/providers/acenta.svg" alt="Acenta" className="size-7 shrink-0 rounded-md object-contain" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{agent.name}</div>
              <div className="text-xs text-muted-foreground truncate">
                {agent.inThisWorkspace ? t('connect.acentaInThisWorkspace') : t('connect.acentaWorkspaceCount', { count: agent.workspaces, limit: agent.workspaceLimit })}
                {' · '}<a href={agent.url} target="_blank" rel="noreferrer" className="hover:underline">{t('connect.acentaManage')}</a>
              </div>
            </div>
            {agent.inThisWorkspace ? (
              <>{here ? presence(here) : agent.launchUrl ? <a href={agent.launchUrl} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">{t('connect.acentaFinishSetup')}<ArrowUpRight className="size-3" /></a> : null}{here && removeButton(here, agent.workspaces > 1)}</>
            ) : agent.launchUrl ? (
              <a href={agent.launchUrl} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">{t('connect.acentaFinishSetup')}<ArrowUpRight className="size-3" /></a>
            ) : (
              <Button size="sm" variant="outline" disabled={full || adding !== null} title={full ? t('connect.acentaWorkspaceFull') : undefined} onClick={() => handleAdd(agent)}>
                {adding === agent.id ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Plus className="size-3.5 mr-1.5" />}
                {t('connect.acentaAddHere')}
              </Button>
            )}
          </div>
        );
      })}

      {account && others.length > 0 && <div className="pt-2 text-xs font-medium text-muted-foreground">{t('connect.acentaOthersAgents')}</div>}
      {(account ? others : hosted).map((agent) => (
        <div key={agent.agentName} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border bg-background">
          <img src="/providers/acenta.svg" alt="Acenta" className="size-7 shrink-0 rounded-md object-contain" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{agent.displayName}</div>
            <div className="text-xs text-muted-foreground font-mono truncate">@{agent.agentName}</div>
          </div>
          {presence(agent)}
          {removeButton(agent)}
        </div>
      ))}
    </div>
  );
}
