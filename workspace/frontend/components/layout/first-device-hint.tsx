'use client';

import { ArrowDown } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SetupStep } from '@/hooks/use-first-device-guide';

/** Green emphasis shared by the connect button while a setup step is pending. */
export const SETUP_STEP_BUTTON = 'ring-1 ring-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-300';

/** An in-flow pointer keeps the connection button and footer controls usable. */
export function FirstDeviceHint({ step, compact = false }: { step: Exclude<SetupStep, null>; compact?: boolean }) {
  const t = useT();
  const title = step === 'device' ? t('nav.firstDeviceTitle') : t('nav.firstAgentTitle');
  const hint = step === 'device' ? t('nav.firstDeviceHint') : t('nav.firstAgentHint');
  return (
    <div className={cn('text-emerald-700 dark:text-emerald-300', compact ? 'flex justify-center py-1' : 'mx-1 mb-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 pt-3 pb-2')}>
      {!compact && <>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-relaxed">{hint}</p>
      </>}
      <ArrowDown aria-hidden="true" className={cn('size-5', !compact && 'mx-auto mt-2')} />
      {compact && <span className="sr-only">{hint}</span>}
    </div>
  );
}
