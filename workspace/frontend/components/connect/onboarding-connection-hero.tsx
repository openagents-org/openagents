'use client';

import { ArrowDown, ArrowRight, FileText, Laptop, MessageSquare, PlusSquare, Server, Users } from 'lucide-react';
import { AgentIcon } from '@/components/icons/agent-icons';
import { useT } from '@/lib/i18n';

/** A schematic of the connection being set up, rather than a connected-state claim. */
export function OnboardingConnectionHero({ workspaceName }: { workspaceName: string }) {
  const t = useT();
  return (
    <section className="space-y-6" aria-labelledby="onboarding-connection-title">
      <div className="text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-600/5 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <PlusSquare className="size-3.5" />{t('nav.connectAgent')}
        </div>
        <h1 id="onboarding-connection-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('onboarding.connectionTitle')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{t('onboarding.nodeStepBody')}</p>
      </div>

      <div className="relative overflow-hidden rounded-3xl border bg-muted/20 px-5 py-6 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:16px_16px]" aria-hidden="true" />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-4 sm:flex-row sm:gap-0">
          <div className="w-full min-w-0 flex-1 rounded-2xl border bg-background p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Laptop className="size-6" />
                <Server className="absolute -bottom-1 -right-1 size-5 rounded bg-background p-0.5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">{t('onboarding.diagramDevice')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('onboarding.diagramRunsHere')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[['claude', 'Claude Code'], ['codex', 'Codex']].map(([name, label]) => (
                <div key={name} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-2 text-[11px] font-medium">
                  <AgentIcon name={name} size={18} /><span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-2 px-4 sm:w-28" aria-hidden="true">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">{t('onboarding.diagramConnect')}</span>
            <div className="hidden w-full items-center sm:flex"><span className="h-px flex-1 border-t border-dashed border-emerald-600/50" /><ArrowRight className="size-5 text-emerald-600" /></div>
            <ArrowDown className="size-5 text-emerald-600 sm:hidden" />
          </div>

          <div className="w-full min-w-0 flex-1 rounded-2xl border border-emerald-600/25 bg-background p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"><Users className="size-6" /></div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={workspaceName}>{workspaceName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('onboarding.diagramWorkspace')}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[11px]"><MessageSquare className="size-3.5" />{t('views.threads')}</span>
              <span className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[11px]"><FileText className="size-3.5" />{t('views.files')}</span>
            </div>
          </div>
        </div>
        <p className="relative mt-5 text-center text-xs leading-5 text-muted-foreground">{t('onboarding.diagramCaption')}</p>
      </div>
    </section>
  );
}
