'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Download, Laptop, Loader2, Terminal } from 'lucide-react';
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
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-zinc-950 p-3 text-zinc-100">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 text-xs leading-5">{command}</code>
      <button type="button" disabled={disabled} onClick={() => copyToClipboard(command)}
        aria-label={t('connect.nodeCopyCommand')} className="shrink-0 rounded-md p-2 text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40">
        {isCopied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/** Guided setup: one installation path at a time, followed by a clear next step. */
export function OnboardingPairingPanel({ pairing, onDismiss }: { pairing: PairingCode; onDismiss?: () => void }) {
  const t = useT();
  const isMobile = useIsMobile();
  const [method, setMethod] = useState<'desktop' | 'terminal'>('terminal');
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
    <section className="overflow-hidden rounded-2xl border bg-background shadow-sm" aria-label={t('onboarding.setupComputer')}>
      <div className="border-b px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold">{t('onboarding.setupComputer')}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('onboarding.setupComputerHint')}</p>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1" role="group" aria-label={t('onboarding.setupMethod')}>
          <button type="button" aria-pressed={terminal} onClick={() => setMethod('terminal')}
            className={cn('flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-3 text-xs font-medium transition-colors', terminal ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <span className="flex items-center justify-center gap-2"><Terminal className="size-4 shrink-0" />{t('onboarding.terminalServer')}</span>
            <span className="text-[11px] font-normal leading-4 text-muted-foreground">{t('onboarding.commandLineTarget')}</span>
          </button>
          <button type="button" aria-pressed={!terminal} onClick={() => setMethod('desktop')}
            className={cn('flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-3 text-xs font-medium transition-colors', !terminal ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            <span className="flex items-center justify-center gap-2"><Laptop className="size-4 shrink-0" />{t('onboarding.desktopApp')}</span>
            <span className="text-[11px] font-normal leading-4 text-muted-foreground">{t('onboarding.desktopAppTarget')}</span>
          </button>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">1</span>
          <div className="min-w-0 flex-1 space-y-3">
            <h3 className="text-sm font-semibold leading-6">{t(terminal ? 'onboarding.installCliTitle' : 'onboarding.installAppTitle')}</h3>
            {terminal ? (
              <>
                <div className="flex gap-2" role="group" aria-label={t('onboarding.setupOs')}>
                  {(['unix', 'windows'] as const).map((value) => (
                    <button type="button" key={value} aria-pressed={os === value} onClick={() => setOs(value)}
                      className={cn('rounded-md border px-3 py-1.5 text-xs', os === value ? 'border-primary/30 bg-primary/5 font-medium' : 'text-muted-foreground')}>
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
                    <Download className="size-4 shrink-0" />{d.os}
                  </a>
                ))}
              </div>
            )}
            <p className="text-xs leading-5 text-muted-foreground">{t(terminal ? 'onboarding.installCliHint' : 'onboarding.installAppHint')}</p>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">2</span>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold leading-6">{t(terminal ? 'onboarding.connectCliTitle' : 'onboarding.enterAppCode')}</h3>
              <span className={cn('text-[11px]', expired ? 'text-destructive' : 'text-muted-foreground')} role="timer">
                {expired ? t('connect.nodePairingExpired') : t('connect.nodePairingExpires', { minutes: Math.max(1, Math.ceil(remaining / 60000)) })}
              </span>
            </div>
            <button type="button" onClick={() => copyToClipboard(pairing.code)} disabled={expired} aria-label={t('connect.nodeCopyCode')}
                className="group flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-primary/20 bg-primary/[0.03] px-3 py-5 transition-colors hover:bg-primary/[0.06] disabled:opacity-40">
                <span className="font-mono text-2xl font-semibold tracking-[0.12em] tabular-nums sm:text-3xl">{pairing.code}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {isCopied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  {t(isCopied ? 'onboarding.codeCopied' : 'onboarding.copyCode')}
                </span>
            </button>
            <p className="text-xs leading-5 text-muted-foreground">{t(terminal ? 'onboarding.connectCliHint' : 'onboarding.enterAppCodeHint')}</p>
            {terminal && (
              <details className="rounded-lg border px-3 py-2.5">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">{t('onboarding.cliPairingFallback')}</summary>
                <div className="mt-3"><SetupCommand command={`agn device connect ${pairing.code}`} disabled={expired} /></div>
              </details>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground" role="status">
          {!expired && <Loader2 className="size-4 shrink-0 animate-spin" />}
          <span>{t(expired ? 'onboarding.expiredHint' : 'onboarding.waitingComputerHint')}</span>
        </div>
        {onDismiss && <button type="button" onClick={onDismiss} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">{t('connect.nodeCancel')}</button>}
      </div>
      <div className="flex items-start gap-3 border-t px-5 py-4 sm:px-6">
        <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <p className="text-xs font-medium">{t('onboarding.nextAgentTitle')}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('onboarding.nextAgentBody')}</p>
        </div>
      </div>
    </section>
  );
}
