'use client';

import { ArrowRight, Laptop, Server } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { Item } from '@/components/ui/item';

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
          <Item key={method} asChild variant="outline" className="items-start text-left hover:border-foreground/20 hover:bg-muted/50">
            <button type="button" onClick={() => openConnectSetup(method)}>
              {/* Item parts render block elements; spans keep the button's content valid. */}
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-medium">{t(title)}</span>
                <span className="text-xs leading-5 text-muted-foreground">{t(hint)}</span>
              </span>
              <ArrowRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover/item:text-foreground" />
            </button>
          </Item>
        ))}
      </div>
    </div>
  );
}
