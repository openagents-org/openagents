'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Laptop, Loader2, Monitor, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { workspaceApi } from '@/lib/api';
import { capture } from '@/lib/analytics';
import { useT } from '@/lib/i18n';
import type { DesktopComputer, DesktopHost } from '@/lib/desktop-host';

/** Only the device connection is desktop-specific. Agent setup stays shared. */
export function DesktopComputerStep({ host, workspaceId, workspaceName, onConnected, onOtherDevice }: {
  host: DesktopHost;
  workspaceId: string;
  workspaceName: string;
  onConnected: (nodeId: string) => void;
  onOtherDevice: () => void;
}) {
  const t = useT();
  const [computer, setComputer] = useState<DesktopComputer | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'connecting' | 'waiting' | 'error'>('loading');
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState<'load' | 'connect' | 'offline' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      cancelled = true;
      setError('load');
      setPhase('error');
    }, 20_000);
    setPhase('loading');
    setError(null);
    Promise.all([host.getComputerStatus(workspaceId), workspaceApi.getMe()])
      .then(([status, me]) => {
        if (cancelled) return;
        clearTimeout(timeout);
        const canConnect = me.effectiveRole === 'owner' || me.effectiveRole === 'admin';
        setComputer(status);
        setEditable(canConnect);
        setPhase(status.nodeId && canConnect ? 'waiting' : 'ready');
      })
      .catch(() => { if (!cancelled) { clearTimeout(timeout); setError('load'); setPhase('error'); } });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [host, workspaceId, attempt]);

  // A successful pairing does not mean the daemon is online yet. Wait for this
  // exact node, never a different device that happens to report in first.
  useEffect(() => {
    if (phase !== 'waiting' || !computer?.nodeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => {
      cancelled = true;
      setError('offline');
      setPhase('error');
    }, 30_000);
    const check = async () => {
      try {
        const nodes = await workspaceApi.listNodes();
        if (cancelled) return;
        if (nodes.some((node) => node.nodeId === computer.nodeId && node.status === 'online')) {
          clearTimeout(timeout);
          capture('node_connected', { source: 'desktop_onboarding' });
          onConnected(computer.nodeId!);
          return;
        }
      } catch { /* A transient failure can recover on the next check. */ }
      if (cancelled) return;
      timer = setTimeout(check, 1500);
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); clearTimeout(timeout); };
  }, [phase, computer?.nodeId, onConnected]);

  const connect = useCallback(async () => {
    if (busy.current || !editable) return;
    busy.current = true;
    setError(null);
    setPhase('connecting');
    try {
      const result = await host.connectComputer(workspaceId);
      if (!mounted.current) return;
      setComputer(result);
      if (!result.nodeId) throw new Error('No device registration returned');
      if (result.warning) { setError('offline'); setPhase('error'); }
      else setPhase('waiting');
    } catch {
      if (mounted.current) { setError('connect'); setPhase('error'); }
    } finally { busy.current = false; }
  }, [editable, host, workspaceId]);

  const working = phase === 'connecting' || phase === 'waiting';
  return (
    <div className="@container space-y-8" data-testid="desktop-computer-onboarding">
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Laptop className="size-7" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{t('onboarding.thisComputerTitle')}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {t('onboarding.thisComputerBody', { workspace: workspaceName })}
        </p>
      </div>

      <div className="grid gap-5 @2xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5 rounded-2xl border bg-card p-6">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted"><Monitor className="size-6" /></div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{t('onboarding.thisComputer')}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={computer?.hostname}>{computer?.hostname || t('onboarding.appReady')}</p>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />{t('onboarding.appReady')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('onboarding.computerPermission')}</p>

          {error && <p role="alert" className="text-sm text-destructive">{t(`onboarding.computerError.${error}`)}</p>}
          {!editable && phase === 'ready' && <p className="text-sm text-muted-foreground">{t('onboarding.computerAdminRequired')}</p>}

          <div className="mt-auto pt-1">
            {phase === 'loading' ? (
              <div role="status" className="flex h-11 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('onboarding.checkingComputer')}</div>
            ) : error === 'load' || error === 'offline' ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => setAttempt((value) => value + 1)}>{t('onboarding.checkAgain')}</Button>
                {error === 'offline' && <Button variant="outline" onClick={() => host.openComputer()}>{t('onboarding.openComputer')}</Button>}
              </div>
            ) : (
              <Button variant="primary" className="min-h-11 w-full whitespace-normal" onClick={connect} disabled={!editable || working}>
                {working ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Laptop className="size-4 shrink-0" />}
                {t(phase === 'connecting' ? 'onboarding.connectingComputer' : phase === 'waiting' ? 'onboarding.waitingComputer' : 'onboarding.connectThisComputer')}
                {!working && <ArrowRight className="size-4 shrink-0" />}
              </Button>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-5 rounded-2xl border bg-card p-6">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted"><Server className="size-6" /></div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{t('onboarding.otherDevice')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('onboarding.otherDeviceTypes')}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('onboarding.otherDeviceSetup')}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('onboarding.otherDeviceBody')}</p>
          <Button variant="primary" className="mt-auto min-h-11 w-full whitespace-normal" onClick={onOtherDevice} disabled={working}>
            <Server className="size-4 shrink-0" />{t('onboarding.connectOtherDevice')}<ArrowRight className="size-4 shrink-0" />
          </Button>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">{t('onboarding.computerNext')}</p>
    </div>
  );
}
