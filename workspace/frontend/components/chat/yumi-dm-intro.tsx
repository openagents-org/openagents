'use client';

import { KeyRound, MessageSquare } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * Empty-state for a DM with the built-in Yumi assistant: instead of a blank
 * thread, Yumi "opens" with what she can do and the two connect steps, plus
 * quick actions that send a real message (so her tool loop answers — e.g.
 * minting a pairing code via `create_pairing_code`).
 */
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
            <div className="mt-1.5 space-y-3 text-sm leading-relaxed">
              <p>{t('yumiDmIntro.greeting')}</p>
              <div>
                <p className="font-medium">{t('yumiDmIntro.stepsTitle')}</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
                  <li>{t('yumiDmIntro.step1')}</li>
                  <li>{t('yumiDmIntro.step2')}</li>
                </ol>
              </div>
              <p className="text-muted-foreground">{t('yumiDmIntro.hint')}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                onClick={() => onQuick(t('yumiDmIntro.quickPairing'))}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <KeyRound className="size-3.5" />{t('yumiDmIntro.quickPairing')}
              </button>
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
