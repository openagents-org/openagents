'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Laptop, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useIsMobile } from '@/hooks/use-mobile';
import { desktopDownloads } from '@/lib/desktop-downloads';
import { useT } from '@/lib/i18n';
import type { PairingCode } from '@/lib/types';
import { cn } from '@/lib/utils';

function SetupCommand({ command, disabled = false }: { command: string; disabled?: boolean }) {
  const t = useT();
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-[#101828] p-2.5 text-slate-100">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 text-[13px] leading-6">{command}</code>
      <button type="button" disabled={disabled} onClick={() => copyToClipboard(command)}
        aria-label={t('connect.nodeCopyCommand')} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
        {isCopied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
        <span>{t(isCopied ? 'onboarding.codeCopied' : 'onboarding.copyCommand')}</span>
      </button>
    </div>
  );
}

/** Guided setup: one installation path at a time, followed by a clear next step. */
export function OnboardingPairingPanel({ pairing, onDismiss, onRegenerate, regenerating = false, methodRequest }: {
  pairing: PairingCode;
  onDismiss?: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  methodRequest?: { method: 'desktop' | 'terminal' } | null;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const [method, setMethod] = useState<'desktop' | 'terminal'>(methodRequest?.method ?? 'terminal');
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
  const install = os === 'windows'
    ? 'irm https://openagents.org/install.ps1 | iex'
    : 'curl -fsSL https://openagents.org/install.sh | bash';

  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-background shadow-[0_4px_24px_-12px_#17255426]" aria-label={t('onboarding.setupComputer')}>
      <div className="border-b border-border/70 px-5 py-5 sm:px-6">
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">{t('onboarding.deviceStepLabel')}</p>
        <h2 className="text-lg font-semibold tracking-tight">{t('onboarding.setupComputer')}</h2>
        <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{t('onboarding.setupComputerHint')}</p>
        <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label={t('onboarding.setupMethod')}>
          {([
            { id: 'terminal', icon: Terminal, label: 'onboarding.terminalServer', hint: 'onboarding.commandLineTarget', platforms: [{ icon: 'windows', label: 'Windows' }, { icon: 'apple', label: 'macOS' }, { icon: 'linux', label: 'Linux' }] },
            { id: 'desktop', icon: Laptop, label: 'onboarding.desktopApp', hint: 'onboarding.desktopAppTarget', platforms: [{ icon: 'windows', label: 'Windows' }, { icon: 'apple', label: 'macOS' }] },
          ] as const).map(({ id, icon: Icon, label, hint, platforms }) => {
            const active = method === id;
            return (
              <button type="button" key={id} aria-pressed={active} onClick={() => setMethod(id)}
                className={cn('relative flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors sm:px-4', active ? 'border-[#2f6bff]/60 bg-[#2f6bff]/[0.04]' : 'border-border hover:border-[#2f6bff]/35 hover:bg-muted/30')}>
                <Icon className={cn('mt-0.5 hidden size-5 shrink-0 sm:block', active ? 'text-[#2f6bff]' : 'text-muted-foreground')} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block pr-3 text-sm font-semibold', active && 'text-[#2f6bff]')}>{t(label)}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(hint)}</span>
                  <span className="mt-1.5 flex items-center gap-2.5">
                    {platforms.map((platform) => (
                      <img key={platform.icon} src={`/icons/platforms/${platform.icon}.svg`}
                        alt={platform.label} title={platform.label} width={14} height={14}
                        className="size-3.5 object-contain opacity-60 dark:invert" />
                    ))}
                  </span>
                </span>
                <span aria-hidden="true" className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-[#2f6bff] bg-[#2f6bff] text-white' : 'border-border')}>
                  {active && <Check className="size-2.5" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2f6bff]/[0.07] text-xs font-semibold text-[#2f6bff]">1</span>
          <div className="min-w-0 flex-1 space-y-2.5">
            <h3 className="text-sm font-semibold leading-7">{t(terminal ? 'onboarding.installCliTitle' : 'onboarding.installAppTitle')}</h3>
            {terminal ? (
              <>
                <div className="flex gap-2" role="group" aria-label={t('onboarding.setupOs')}>
                  {(['unix', 'windows'] as const).map((value) => (
                    <button type="button" key={value} aria-pressed={os === value} onClick={() => setOs(value)}
                      className={cn('rounded-md border px-3 py-1.5 text-xs', os === value ? 'border-[#2f6bff]/30 bg-[#2f6bff]/[0.04] font-medium text-[#2f6bff]' : 'text-muted-foreground')}>
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
            <p className="text-[13px] leading-6 text-muted-foreground">{t(terminal ? 'onboarding.installCliHint' : 'onboarding.installAppHint')}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2f6bff]/[0.07] text-xs font-semibold text-[#2f6bff]">2</span>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold leading-7">{t(terminal ? 'onboarding.connectCliTitle' : 'onboarding.enterAppCode')}</h3>
              <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium', expired ? 'bg-destructive/5 text-destructive' : remaining < 300000 ? 'bg-amber-50 text-amber-700' : 'bg-muted/70 text-muted-foreground')} role="timer">
                {expired ? t('connect.nodePairingExpired') : t('connect.nodePairingExpires', { minutes: Math.max(1, Math.ceil(remaining / 60000)) })}
              </span>
            </div>
            <button type="button" onClick={() => copyToClipboard(pairing.code)} disabled={expired} aria-label={t('connect.nodeCopyCode')}
                className="group flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-[#2f6bff]/20 bg-[#2f6bff]/[0.025] px-3 py-4 transition-colors hover:border-[#2f6bff]/40 hover:bg-[#2f6bff]/[0.05] disabled:opacity-40">
                <span className="font-mono text-2xl font-semibold tracking-[0.12em] tabular-nums sm:text-3xl">{pairing.code}</span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-[#2f6bff]">
                  {isCopied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  {t(isCopied ? 'onboarding.codeCopied' : 'onboarding.copyCode')}
                </span>
            </button>
            <p className="text-[13px] leading-6 text-muted-foreground">{t(terminal ? 'onboarding.connectCliHint' : 'onboarding.enterAppCodeHint')}</p>
            {terminal && (
              <details className="rounded-lg bg-muted/35 px-3 py-2.5">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">{t('onboarding.cliPairingFallback')}</summary>
                <div className="mt-3"><SetupCommand command={`agn device connect ${pairing.code}`} disabled={expired} /></div>
              </details>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/25 px-5 py-3 sm:px-6">
        <div className="flex min-w-[180px] flex-1 items-start gap-3" role="status">
          {!expired && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-[#2f6bff]" />}
          <div>
            <p className="text-[13px] font-medium">{t(expired ? 'connect.nodePairingExpired' : 'onboarding.waitingComputerHint')}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t(expired ? (onRegenerate ? 'onboarding.renewCodeHint' : 'onboarding.expiredHint') : 'onboarding.nextAgentBody')}</p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {expired && onRegenerate && (
            <button type="button" onClick={onRegenerate} disabled={regenerating} aria-busy={regenerating}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand/20 bg-brand/10 px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/15 disabled:opacity-60">
              <RefreshCw aria-hidden="true" className={cn('size-3.5', regenerating && 'animate-spin')} />
              {t(regenerating ? 'connect.nodeGenerating' : 'onboarding.newPairingCode')}
            </button>
          )}
          {onDismiss && <button type="button" onClick={onDismiss} className="text-xs text-muted-foreground hover:text-foreground">{t('connect.nodeCancel')}</button>}
        </div>
      </div>
    </section>
  );
}
