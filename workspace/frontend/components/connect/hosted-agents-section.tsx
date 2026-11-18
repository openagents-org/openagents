'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Plus, Trash2, Wallet } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/dialogs-provider';
import type { AcentaAccount, AcentaAgent, AcentaAgentUsage, AcentaUsage, HostedAgent, HostedAgentProvider } from '@/lib/types';

const STARTUP_WINDOW_MS = 30 * 60 * 1000;

/** Acenta's own low-balance line (it emails the owner below this). */
const LOW_BALANCE_CENTS = 200;

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Acenta cloud agents. A signed-in member sees their own Acenta agents — any
 * of them can join this workspace — and can create one; someone without an
 * Acenta account sets one up, which creates the account on Acenta's sign-in.
 * Runtimes join as normal agents, so presence is their real heartbeat.
 */
export function HostedAgentsSection({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const { formatDate } = useFormatters();
  const confirm = useConfirm();
  const [provider, setProvider] = useState<HostedAgentProvider | null>(null);
  const [hosted, setHosted] = useState<HostedAgent[]>([]);
  // null: unknown (not signed in, or Acenta unreachable) — fall back to the workspace list.
  const [account, setAccount] = useState<AcentaAccount | null>(null);
  // null until loaded, or when Acenta can't say; the page works without it.
  const [usage, setUsage] = useState<AcentaUsage | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [name, setName] = useState('');
  const [launching, setLaunching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(() => {
    workspaceApi.listHostedAgents().then(setHosted).catch(() => {});
    workspaceApi.listMyAcentaAgents().then(setAccount).catch(() => setAccount(null));
    workspaceApi.getMyAcentaUsage().then(setUsage).catch(() => setUsage(null));
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

  const showUsage = !!usage?.hasAccount && usage.billingEnabled;
  const usageById = new Map((usage?.agents ?? []).map((u) => [u.id, u]));
  const lowBalance = showUsage && usage!.balanceEnabled && !usage!.autoTopup
    && usage!.balanceCents < LOW_BALANCE_CENTS && usage!.agents.some((u) => u.mode === 'usage');

  // null: no plan running yet (created but never paid for); the row already says Finish setup.
  const planLabel = (u: AcentaAgentUsage): string | null => {
    if (u.status === 'awaiting_payment') return null;
    if (u.status === 'balance_empty') return t('connect.acentaPlanBalanceEmpty');
    if (u.mode === 'included') return t('connect.acentaPlanIncluded');
    if (u.mode === 'usage') return t('connect.acentaPlanUsage', { amount: formatUsd(u.spentThisMonthCents) });
    if (u.mode === 'pass') {
      return u.renewalAt
        ? t('connect.acentaPlanPassUntil', { date: formatDate(u.renewalAt, { month: 'short', day: 'numeric' }) })
        : t('connect.acentaPlanPass');
    }
    if (u.status === 'trialing') return t('connect.acentaPlanTrial');
    if (u.status === 'canceled' || u.status === 'ended') return t('connect.acentaPlanEnded');
    return t('connect.acentaPlanMonthly');
  };

  const handleLaunch = async () => {
    const label = name.trim();
    if (!label || launching) return;
    setLaunching(true);
    try {
      const launched = await workspaceApi.launchHostedAgent(label);
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
      <span className={cn('flex items-center gap-1.5 text-xs', online ? 'text-success' : 'text-muted-foreground')}>
        {starting && <Spinner className="size-3" />}
        {online ? t('connect.acentaOnline') : starting ? t('connect.acentaStarting') : t('connect.acentaOffline')}
      </span>
    );
  };

  const removeButton = (agent: HostedAgent, elsewhere?: boolean) => (
    <button
      onClick={() => handleRemove(agent, elsewhere ?? !!agent.linked)}
      className="size-6 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
      title={t('connect.remove')}
    >
      <Trash2 className="size-3" />
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <img src="/providers/acenta.svg" alt="" className="size-12 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="text-lg font-semibold tracking-tight">Acenta</h3>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t('connect.acentaHostedBadge')}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t('connect.acentaMarketplaceDescription')}</p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {account && !account.hasAccount ? t('connect.acentaNoAccount')
                : account?.hasAccount && mine.length === 0 ? t('connect.acentaNoAgents')
                : atLimit ? t('connect.acentaAgentLimit', { limit: account!.agentLimit })
                : t('connect.acentaMarketplaceSetup')}
            </p>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <Button onClick={() => setSetupOpen(true)} disabled={!provider.available || atLimit} className="w-full">
              {account?.hasAccount ? <><Plus className="size-3.5 mr-1.5" />{t('connect.acentaNewAgent')}</> : <>{t('connect.acentaGetStarted')} <ArrowUpRight className="size-3.5 ml-1.5" /></>}
            </Button>
            {!provider.available && <p className="mt-2 text-center text-xs text-muted-foreground">{t('connect.acentaUnavailable')}</p>}
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
              {launching && <Spinner data-icon="inline-start" />}
              {t('connect.acentaContinue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showUsage && (
        <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2.5 text-xs',
          lowBalance ? 'border-warning/30 bg-warning/10' : 'bg-background')}>
          <Wallet className="size-3.5 shrink-0 text-muted-foreground" />
          {usage!.balanceEnabled && (
            <span>{t('connect.acentaBalance')} <span className="font-semibold tabular-nums">{formatUsd(usage!.balanceCents)}</span></span>
          )}
          <span>{t('connect.acentaSpentThisMonth')} <span className="font-semibold tabular-nums">{formatUsd(usage!.spentThisMonthCents)}</span></span>
          {usage!.autoTopup && <span className="text-muted-foreground">{t('connect.acentaAutoTopupOn')}</span>}
          {lowBalance && <span className="font-medium text-warning">{t('connect.acentaLowBalance')}</span>}
          {usage!.manageUrl && (
            <a href={usage!.manageUrl} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1 font-medium text-primary hover:underline">
              {usage!.balanceEnabled ? t('connect.acentaTopUp') : t('connect.acentaBilling')}
              <ArrowUpRight className="size-3" />
            </a>
          )}
        </div>
      )}

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
                {(() => {
                  const plan = showUsage && usageById.has(agent.id) ? planLabel(usageById.get(agent.id)!) : null;
                  return plan && <>{' · '}{plan}</>;
                })()}
                {' · '}<a href={agent.url} target="_blank" rel="noreferrer" className="hover:underline">{t('connect.acentaManage')}</a>
              </div>
            </div>
            {agent.inThisWorkspace ? (
              <>{here ? presence(here) : agent.launchUrl ? <a href={agent.launchUrl} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">{t('connect.acentaFinishSetup')}<ArrowUpRight className="size-3" /></a> : null}{here && removeButton(here, agent.workspaces > 1)}</>
            ) : agent.launchUrl ? (
              <a href={agent.launchUrl} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">{t('connect.acentaFinishSetup')}<ArrowUpRight className="size-3" /></a>
            ) : (
              <Button size="sm" variant="outline" disabled={full || adding !== null} title={full ? t('connect.acentaWorkspaceFull') : undefined} onClick={() => handleAdd(agent)}>
                {adding === agent.id ? <Spinner data-icon="inline-start" /> : <Plus className="size-3.5 mr-1.5" />}
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
