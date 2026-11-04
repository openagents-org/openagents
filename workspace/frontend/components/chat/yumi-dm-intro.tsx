'use client';

import { MessageSquare } from 'lucide-react';
import { YumiAgentLocation } from './yumi-agent-location';
import { useT } from '@/lib/i18n';

/** First-contact DM welcome shares the same location choices as the seeded thread. */
export function YumiDmIntro({ agentLabel, onQuick }: {
  agentLabel: string;
  onQuick: (text: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6">
      <div className="mx-auto w-full max-w-3xl xl:max-w-4xl 2xl:max-w-6xl">
        <div className="flex items-start gap-3">
          <img src="/yumi-avatar.png" alt="" className="size-8 shrink-0 rounded-full object-cover mt-0.5" draggable={false} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-tight">{agentLabel}</div>
            <p className="mt-1.5 text-sm leading-relaxed">{t('yumiOnboarding.greeting')}</p>
            <YumiAgentLocation />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                onClick={() => onQuick(t('yumiDmIntro.quickWhat'))}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <MessageSquare className="size-3.5" />{t('yumiDmIntro.quickWhat')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
