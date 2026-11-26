'use client';

import type { DeviceSetupMethod } from '@/components/layout/layout-context';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, RefreshCw } from 'lucide-react';
import { AgentJoinInstruction } from '@/components/connect/agent-join-instruction';
import { OnboardingSetupMethod } from '@/components/connect/onboarding-setup-method';
import { TerminalCopyButton } from '@/components/connect/terminal-copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useIsMobileDevice } from '@/hooks/use-mobile-device';
import { desktopDownloads } from '@/lib/desktop-downloads';
import { useT } from '@/lib/i18n';
import type { PairingCode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

function SetupCommand({ command, disabled = false }: { command: string; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-[#101828] p-2.5 text-slate-100">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 text-sm leading-6">{command}</code>
      <TerminalCopyButton text={command} label="onboarding.copyCommand" ariaLabel={t('connect.nodeCopyCommand')} disabled={disabled} />
    </div>
  );
}

/** Guided setup: one installation path at a time, followed by a clear next step. */
export function OnboardingPairingPanel({ pairing, onDismiss, onRegenerate, regenerating = false, methodRequest, stepLabel, onMethodChange }: {
  pairing: PairingCode;
  onDismiss?: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  methodRequest?: { method: DeviceSetupMethod } | null;
  onMethodChange?: (method: DeviceSetupMethod) => void;
  /** Small label above the title; defaults to the first-run "Step 1 of 2" label. */
  stepLabel?: string;
}) {
  const t = useT();
  const isMobile = useIsMobileDevice();
  const [method, setMethod] = useState<DeviceSetupMethod>(methodRequest?.method ?? 'terminal');
  const appliedMethodRequest = useRef(methodRequest);
  useEffect(() => {
    if (methodRequest && methodRequest !== appliedMethodRequest.current) {
      appliedMethodRequest.current = methodRequest;
      setMethod(methodRequest.method);
    }
  }, [methodRequest]);
  const [os, setOs] = useState<'unix' | 'windows'>(() =>
    typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'windows' : 'unix');
  const [now, setNow] = useState(Date.now);
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = new Date(pairing.expiresAt).getTime() - now;
  const expired = remaining <= 0;
  const terminal = method === 'terminal';
  const fromAgent = method === 'agent';
  const expiryBadge = (
    <Badge variant={expired ? 'destructive' : remaining < 300000 ? 'warning' : 'secondary'} role="timer">
      {expired ? t('connect.nodePairingExpired') : t('connect.nodePairingExpires', { minutes: Math.max(1, Math.ceil(remaining / 60000)) })}
    </Badge>
  );
  const install = os === 'windows'
    ? 'irm https://openagents.org/install.ps1 | iex'
    : 'curl -fsSL https://openagents.org/install.sh | bash';

  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-background shadow-sm" aria-label={t('onboarding.setupComputer')}>
      <div className="border-b border-border/70 px-5 py-5 sm:px-6">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{stepLabel ?? t('onboarding.deviceStepLabel')}</p>
        <h2 className="text-lg font-semibold tracking-tight">{t('onboarding.setupComputer')}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('onboarding.setupComputerHint')}</p>
        <OnboardingSetupMethod value={method} onChange={(next) => { setMethod(next); onMethodChange?.(next); }} />
      </div>

      {fromAgent ? (
      <div className="p-5 sm:p-6">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold leading-7">{t('connect.agentJoinStepTitle')}</h3>
            {expiryBadge}
          </div>
          <AgentJoinInstruction code={pairing.code} disabled={expired} />
          <p className="text-sm leading-6 text-muted-foreground">{t('connect.agentJoinHint')}</p>
        </div>
      </div>
      ) : (
      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">1</span>
          <div className="min-w-0 flex-1 space-y-2.5">
            <h3 className="text-sm font-semibold leading-7">{t(terminal ? 'onboarding.installCliTitle' : 'onboarding.installAppTitle')}</h3>
            {terminal ? (
              <>
                <ToggleGroup type="single" variant="outline" size="sm" value={os} aria-label={t('onboarding.setupOs')}
                  // Pressing the picked system again would clear it; one is always picked.
                  onValueChange={(next) => { if (next) setOs(next as typeof os); }}>
                  {(['unix', 'windows'] as const).map((value) => (
                    <ToggleGroupItem key={value} value={value} className="text-xs">
                      {t(value === 'unix' ? 'connect.nodeOsUnix' : 'connect.nodeOsWindows')}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <SetupCommand command={install} />
              </>
            ) : isMobile ? (
              <p className="rounded-xl bg-muted/50 p-3 text-sm leading-6 text-muted-foreground">{t('onboarding.useComputerHint')}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {desktopDownloads(t).map((d) => (
                  <a key={d.os} href={d.href} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-primary/5">
                    <img src={`/icons/platforms/${d.platform === 'macos' ? 'apple' : 'windows'}.svg`}
                      alt="" aria-hidden="true" width={14} height={14}
                      className="size-3.5 shrink-0 object-contain opacity-70 dark:invert" />{d.os}
                  </a>
                ))}
              </div>
            )}
            <p className="text-sm leading-6 text-muted-foreground">{t(terminal ? 'onboarding.installCliHint' : 'onboarding.installAppHint')}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">2</span>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold leading-7">{t(terminal ? 'onboarding.connectCliTitle' : 'onboarding.enterAppCode')}</h3>
              {expiryBadge}
            </div>
            <button type="button" onClick={() => copyToClipboard(pairing.code)} disabled={expired} aria-label={t('connect.nodeCopyCode')}
                className="group flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border bg-muted/30 px-3 py-4 transition-colors hover:border-foreground/30 hover:bg-muted/60 disabled:opacity-40">
                <span className="font-mono text-2xl font-semibold tracking-[0.12em] tabular-nums sm:text-3xl">{pairing.code}</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                  {isCopied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                  {t(isCopied ? 'onboarding.codeCopied' : 'onboarding.copyCode')}
                </span>
            </button>
            <p className="text-sm leading-6 text-muted-foreground">{t(terminal ? 'onboarding.connectCliHint' : 'onboarding.enterAppCodeHint')}</p>
            {terminal && (
              <Collapsible className="group/cli rounded-lg bg-muted/35 px-3 py-2.5">
                <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-sm text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]/cli:rotate-90" />{t('onboarding.cliPairingFallback')}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3"><SetupCommand command={`agn device connect ${pairing.code}`} disabled={expired} /></CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
      </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/25 px-5 py-3 sm:px-6">
        <div className="flex min-w-44 flex-1 items-start gap-3" role="status">
          {!expired && <Spinner aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <div>
            <p className="text-sm font-medium">{t(expired ? 'connect.nodePairingExpired' : fromAgent ? 'connect.agentJoinWaiting' : 'onboarding.waitingComputerHint')}</p>
            {(expired || fromAgent) && (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t(expired ? (onRegenerate ? 'onboarding.renewCodeHint' : 'onboarding.expiredHint') : 'connect.agentJoinNext')}
              </p>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {expired && onRegenerate && (
            <Button size="sm" onClick={onRegenerate} disabled={regenerating} aria-busy={regenerating}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" className={cn(regenerating && 'animate-spin')} />
              {t(regenerating ? 'connect.nodeGenerating' : 'onboarding.newPairingCode')}
            </Button>
          )}
          {onDismiss && <Button type="button" variant="ghost" size="xs" onClick={onDismiss} className="text-muted-foreground">{t('connect.nodeCancel')}</Button>}
        </div>
      </div>
    </section>
  );
}
