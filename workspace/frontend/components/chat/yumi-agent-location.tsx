'use client';

import { ArrowRight, Laptop, Server } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';

export function YumiAgentLocation() {
  const t = useT();
  const { openConnectSetup } = useLayout();
  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium">{t('yumiOnboarding.question')}</h3>
      <div role="group" aria-label={t('yumiOnboarding.question')} className="mt-2 grid gap-2 sm:grid-cols-2">
        {([
          { method: 'terminal', icon: Server, title: 'yumiOnboarding.remote', hint: 'yumiOnboarding.remoteHint' },
          { method: 'desktop', icon: Laptop, title: 'yumiOnboarding.computer', hint: 'yumiOnboarding.computerHint' },
        ] as const).map(({ method, icon: Icon, title, hint }) => (
          <button key={method} type="button" onClick={() => openConnectSetup(method)}
            className="group flex items-start gap-2.5 rounded-lg border bg-background p-3 text-left transition-colors hover:border-brand/35 hover:bg-brand/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{t(title)}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(hint)}</span>
            </span>
            <ArrowRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-brand" />
          </button>
        ))}
      </div>
    </div>
  );
}
