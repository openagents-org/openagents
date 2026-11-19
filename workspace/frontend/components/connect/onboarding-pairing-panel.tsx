'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Laptop, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { AgentJoinInstruction } from '@/components/connect/agent-join-instruction';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useIsMobileDevice } from '@/hooks/use-mobile-device';
import { desktopDownloads } from '@/lib/desktop-downloads';
import { useT } from '@/lib/i18n';
import type { PairingCode } from '@/lib/types';
import { cn } from '@/lib/utils';

function SetupCommand({ command, disabled = false }: { command: string; disabled?: boolean }) {
  const t = useT();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-[#101828] p-2.5 text-slate-100">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 text-sm leading-6">{command}</code>
      <button type="button" disabled={disabled} onClick={() => copyToClipboard(command)}
        aria-label={t('connect.nodeCopyCommand')} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
        {isCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        <span>{t(isCopied ? 'onboarding.codeCopied' : 'onboarding.copyCommand')}</span>
      </button>
    </div>
  );
}

/** Guided setup: one installation path at a time, followed by a clear next step. */
export function OnboardingPairingPanel({ pairing, onDismiss, onRegenerate, regenerating = false, methodRequest, stepLabel }: {
  pairing: PairingCode;
  onDismiss?: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  methodRequest?: { method: 'desktop' | 'terminal' } | null;
  /** Small label above the title; defaults to the first-run "Step 1 of 2" label. */
  stepLabel?: string;
}) {
  const t = useT();
  const isMobile = useIsMobileDevice();
  const [method, setMethod] = useState<'desktop' | 'terminal' | 'agent'>(methodRequest?.method ?? 'terminal');
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
    <span className={cn('rounded-full px-2 py-1 text-xs font-medium', expired ? 'bg-destructive/10 text-destructive' : remaining < 300000 ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground')} role="timer">
      {expired ? t('connect.nodePairingExpired') : t('connect.nodePairingExpires', { minutes: Math.max(1, Math.ceil(remaining / 60000)) })}
    </span>
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
        <div className="mt-5 grid gap-2" role="group" aria-label={t('onboarding.setupMethod')}>
          {([
            { id: 'terminal', icon: Terminal, label: 'onboarding.terminalServer', hint: 'onboarding.commandLineTarget', platforms: [{ icon: 'windows', label: 'Windows' }, { icon: 'apple', label: 'macOS' }, { icon: 'linux', label: 'Linux' }] },
            { id: 'desktop', icon: Laptop, label: 'onboarding.desktopApp', hint: 'onboarding.desktopAppTarget', platforms: [{ icon: 'windows', label: 'Windows' }, { icon: 'apple', label: 'macOS' }] },
            { id: 'agent', icon: Bot, label: 'connect.agentJoinTitle', hint: 'connect.agentJoinTarget', platforms: [{ icon: 'agents/claude', label: 'Claude Code' }, { icon: 'agents/codex', label: 'Codex' }, { icon: 'agents/opencode', label: 'OpenCode' }] },
          ] as const).map(({ id, icon: Icon, label, hint, platforms }) => {
            const active = method === id;
            return (
              <button type="button" key={id} aria-pressed={active} onClick={() => setMethod(id)}
                className={cn('flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors', active ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/15' : 'border-border hover:border-foreground/25 hover:bg-muted/30')}>
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  <Icon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-3">
                  <span className="block min-w-0">
                    <span className="block text-sm font-semibold">{t(label)}</span>
                    <span className="block text-xs leading-5 text-muted-foreground">{t(hint)}</span>
                  </span>
                  <span className="mt-1.5 flex shrink-0 items-center gap-2.5 sm:mt-0" aria-hidden="true">
                    {platforms.map((platform) => (
                      <img key={platform.icon} src={platform.icon.startsWith('agents/') ? `/icons/${platform.icon}.svg` : `/icons/platforms/${platform.icon}.svg`}
                        alt="" title={platform.label} width={14} height={14}
                        className="size-3.5 object-contain opacity-60 dark:invert" />
                    ))}
                  </span>
                </span>
                <span aria-hidden="true" className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                  {active && <Check className="size-2.5" />}
                </span>
              </button>
            );
          })}
        </div>
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
                <div className="flex gap-2" role="group" aria-label={t('onboarding.setupOs')}>
                  {(['unix', 'windows'] as const).map((value) => (
                    <button type="button" key={value} aria-pressed={os === value} onClick={() => setOs(value)}
                      className={cn('rounded-md border px-3 py-1.5 text-xs', os === value ? 'border-foreground/30 bg-muted font-medium text-foreground' : 'text-muted-foreground')}>
                      {t(value === 'unix' ? 'connect.nodeOsUnix' : 'connect.nodeOsWindows')}
                    </button>
                  ))}
                </div>
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
              <details className="rounded-lg bg-muted/35 px-3 py-2.5">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">{t('onboarding.cliPairingFallback')}</summary>
                <div className="mt-3"><SetupCommand command={`agn device connect ${pairing.code}`} disabled={expired} /></div>
              </details>
            )}
          </div>
        </div>
      </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/25 px-5 py-3 sm:px-6">
        <div className="flex min-w-44 flex-1 items-start gap-3" role="status">
          {!expired && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />}
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
          {onDismiss && <button type="button" onClick={onDismiss} className="text-xs text-muted-foreground hover:text-foreground">{t('connect.nodeCancel')}</button>}
        </div>
      </div>
    </section>
  );
}
