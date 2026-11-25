'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Plus } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import { capture } from '@/lib/analytics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ItemGroup } from '@/components/ui/item';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/responsive-dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/dialogs-provider';
import type { AcentaAccount, AcentaAgent, AcentaAgentUsage, AcentaUsage, HostedAgent, HostedAgentProvider } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { dmSessionId, myAddress } from '@/lib/dm';
import { useLayout } from '@/components/layout/layout-context';
import { FinishSetupLink, formatUsd, HostedAgentRow, HostedOfferBar, HostedPresence, HostedUsageBar, RemoveHostedButton } from './hosted-agent-parts';

export { formatUsd };

/** Acenta's own low-balance line (it emails the owner below this). */
const LOW_BALANCE_CENTS = 200;

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
  const { currentUser, setCurrentSessionId } = useWorkspace();
  const { openView, setSelectedAgentName, setThreadFilter, openMobileDetail } = useLayout();
  // A new agent opens straight into its DM, where its welcome (with things to try) arrives,
  // instead of leaving people to find it in the sidebar. Same as clicking it there.
  const openAgentDm = (agentName: string) => {
    setCurrentSessionId(dmSessionId(myAddress(currentUser), `openagents:${agentName}`));
    setSelectedAgentName(null);
    openView('threads');
    setThreadFilter('all');
    openMobileDetail();
  };
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
      if (launched.agentName) openAgentDm(launched.agentName);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('connect.acentaLaunchFailed'));
    } finally {
      setLaunching(false);
    }
  };

  const handleAdd = async (agent: AcentaAgent) => {
    setAdding(agent.id);
    try {
      const added = await workspaceApi.connectAcentaAgent(agent.id);
      capture('hosted_agent_added', { provider: 'acenta' });
      toast.success(t('connect.acentaAdded', { name: agent.name }));
      load();
      onChanged();
      openAgentDm(added?.agentName || agent.agentName);
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

  const removeButton = (agent: HostedAgent, elsewhere?: boolean) => (
    <RemoveHostedButton onRemove={() => handleRemove(agent, elsewhere ?? !!agent.linked)} />
  );

  const addButton = (agent: AcentaAgent, full: boolean) => {
    const button = (
      <Button size="sm" variant="outline" disabled={full || adding !== null} onClick={() => handleAdd(agent)}>
        {adding === agent.id ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
        {t('connect.acentaAddHere')}
      </Button>
    );
    if (!full) return button;
    // A disabled button fires no pointer events, so the reason hangs off a wrapper.
    return (
      <WithTooltip label={t('connect.acentaWorkspaceFull')}><span tabIndex={0}>{button}</span></WithTooltip>
    );
  };

  const statusLine = account && !account.hasAccount ? t('connect.acentaNoAccount')
    : account?.hasAccount && mine.length === 0 ? t('connect.acentaNoAgents')
    : atLimit ? t('connect.acentaAgentLimit', { limit: account!.agentLimit })
    : t('connect.acentaMarketplaceSetup');
  const listed = account ? others : hosted;

  return (
    <div className="flex flex-col gap-3">
      {usage?.offer && <HostedOfferBar offer={usage.offer} />}
      <Card>
        <CardHeader className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/providers/acenta.svg" alt="" className="size-12 shrink-0 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2.5 text-lg">
              Acenta
              <Badge variant="outline">{t('connect.acentaHostedBadge')}</Badge>
            </CardTitle>
            <CardDescription className="leading-relaxed">{t('connect.acentaMarketplaceDescription')}</CardDescription>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{statusLine}</p>
          </div>
        </CardHeader>
        <CardFooter className="flex-col gap-2">
          <Button onClick={() => setSetupOpen(true)} disabled={!provider.available || atLimit} className="w-full">
            {account?.hasAccount
              ? <><Plus data-icon="inline-start" />{t('connect.acentaNewAgent')}</>
              : <>{t('connect.acentaGetStarted')}<ArrowUpRight data-icon="inline-end" /></>}
          </Button>
          {!provider.available && <p className="text-center text-xs text-muted-foreground">{t('connect.acentaUnavailable')}</p>}
        </CardFooter>
      </Card>
      <Dialog open={setupOpen} onOpenChange={(open) => { if (!launching) setSetupOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3"><img src="/providers/acenta.svg" alt="" className="size-9 rounded-lg" />{t('connect.acentaTitle')}</DialogTitle>
            <DialogDescription>{t('connect.acentaSetupHint')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="acenta-agent-name">{t('connect.agentName')}</FieldLabel>
              <Input id="acenta-agent-name" value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); handleLaunch(); } }}
                placeholder={t('connect.acentaNamePlaceholder')} maxLength={60} disabled={launching} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button onClick={handleLaunch} disabled={launching || !name.trim()}>
              {launching && <Spinner data-icon="inline-start" />}
              {t('connect.acentaContinue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showUsage && <HostedUsageBar usage={usage!} lowBalance={lowBalance} />}

      {mine.length > 0 && (
        <section className="flex flex-col gap-2 pt-2">
          <h4 className="text-sm font-medium">{t('connect.acentaYourAgents')}</h4>
          <ItemGroup className="gap-2">
            {mine.map((agent) => {
              const here = hosted.find((h) => h.agentName === agent.agentName);
              const full = agent.workspaces >= agent.workspaceLimit;
              const plan = showUsage && usageById.has(agent.id) ? planLabel(usageById.get(agent.id)!) : null;
              return (
                <HostedAgentRow
                  key={agent.id}
                  title={agent.name}
                  description={<>
                    {agent.inThisWorkspace ? t('connect.acentaInThisWorkspace') : t('connect.acentaWorkspaceCount', { count: agent.workspaces, limit: agent.workspaceLimit })}
                    {plan && <>{' · '}{plan}</>}
                    {' · '}<a href={agent.url} target="_blank" rel="noreferrer" className="hover:underline">{t('connect.acentaManage')}</a>
                  </>}
                  actions={agent.inThisWorkspace ? (
                    <>{here ? <HostedPresence agent={here} /> : agent.launchUrl ? <FinishSetupLink href={agent.launchUrl} /> : null}{here && removeButton(here, agent.workspaces > 1)}</>
                  ) : agent.launchUrl ? <FinishSetupLink href={agent.launchUrl} /> : addButton(agent, full)}
                />
              );
            })}
          </ItemGroup>
        </section>
      )}

      {listed.length > 0 && (
        <section className="flex flex-col gap-2 pt-2">
          {account && <h4 className="text-sm font-medium">{t('connect.acentaOthersAgents')}</h4>}
          <ItemGroup className="gap-2">
            {listed.map((agent) => (
              <HostedAgentRow
                key={agent.agentName}
                title={agent.displayName}
                description={`@${agent.agentName}`}
                mono
                actions={<><HostedPresence agent={agent} />{removeButton(agent)}</>}
              />
            ))}
          </ItemGroup>
        </section>
      )}
    </div>
  );
}
