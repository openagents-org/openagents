'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Loader2, Trash2 } from 'lucide-react';
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
import type { HostedAgent, HostedAgentProvider } from '@/lib/types';

const STARTUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Acenta-hosted cloud agents: launch one into this workspace and list the
 * ones already running. The runtime joins as a normal agent, so presence is
 * its real heartbeat — not the always-online of API-key cloud agents.
 */
export function HostedAgentsSection({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const confirm = useConfirm();
  const [provider, setProvider] = useState<HostedAgentProvider | null>(null);
  const [hosted, setHosted] = useState<HostedAgent[]>([]);
  const [setupOpen, setSetupOpen] = useState(false);
  const [name, setName] = useState('');
  const [launching, setLaunching] = useState(false);

  const load = useCallback(() => {
    workspaceApi.listHostedAgents().then(setHosted).catch(() => {});
  }, []);

  useEffect(() => {
    workspaceApi.getHostedProviders()
      .then((list) => setProvider(list.find((p) => p.name === 'acenta') ?? null))
      .catch(() => {});
    load();
  }, [load]);

  // A freshly launched agent takes minutes to come online; poll until it has.
  const waiting = hosted.some((a) => a.presence !== 'online');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  if (!provider) return null;

  const handleLaunch = async () => {
    const label = name.trim();
    if (!label || launching) return;
    setLaunching(true);
    try {
      const launched = await workspaceApi.launchHostedAgent(label);
      capture('hosted_agent_launched', { provider: 'acenta', setup: !!launched.setupUrl });
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

  const handleRemove = async (agent: HostedAgent) => {
    const ok = await confirm({
      title: t('connect.remove'),
      description: t('connect.acentaRemoveConfirm', { name: agent.displayName }),
      confirmText: t('connect.remove'),
      destructive: true,
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
            <p className="mt-2 text-xs text-muted-foreground">{t('connect.acentaMarketplaceSetup')}</p>
          </div>
          <div className="shrink-0 sm:ml-2">
            <Button onClick={() => setSetupOpen(true)} disabled={!provider.available} className="w-full sm:w-auto">
              {t('connect.acentaGetStarted')} <ArrowUpRight className="size-3.5 ml-1.5" />
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

      {hosted.map((agent) => {
        const online = agent.presence === 'online';
        const setup = agent.status === 'setup' && !!agent.setupUrl;
        // Offline soon after launch means the box is still being prepared.
        const starting = !online && !!agent.createdAt && Date.now() - Date.parse(agent.createdAt) < STARTUP_WINDOW_MS;
        return (
          <div key={agent.agentName} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border bg-background">
            <img src="/providers/acenta.svg" alt="Acenta" className="size-7 shrink-0 rounded-md object-contain" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{agent.displayName}</div>
              <div className="text-xs text-muted-foreground font-mono truncate">@{agent.agentName}</div>
            </div>
            {setup ? (
              <a href={agent.setupUrl!} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                {t('connect.acentaFinishSetup')}
                <ArrowUpRight className="size-3" />
              </a>
            ) : (
              <span className={cn('flex items-center gap-1.5 text-xs', online ? 'text-emerald-600' : 'text-muted-foreground')}>
                {starting && <Loader2 className="size-3 animate-spin" />}
                {online ? t('connect.acentaOnline') : starting ? t('connect.acentaStarting') : t('connect.acentaOffline')}
              </span>
            )}
            <button
              onClick={() => handleRemove(agent)}
              className="size-6 flex items-center justify-center rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
              title={t('connect.remove')}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
