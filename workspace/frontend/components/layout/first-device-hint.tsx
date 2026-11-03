'use client';

import { ArrowDown } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SetupStep } from '@/hooks/use-first-device-guide';

/** An in-flow pointer keeps the connection button and footer controls usable. */
export function FirstDeviceHint({ step, compact = false }: { step: Exclude<SetupStep, null>; compact?: boolean }) {
  const t = useT();
  const title = step === 'device' ? t('nav.firstDeviceTitle') : t('nav.firstAgentTitle');
  const hint = step === 'device' ? t('nav.firstDeviceHint') : t('nav.firstAgentHint');
  return (
    <div className={cn('text-brand', compact ? 'flex justify-center py-1' : 'mx-1 mb-2 rounded-lg border border-brand/20 bg-brand/10 px-3 pt-3 pb-2')}>
      {!compact && <>
        <p className="text-xs font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-relaxed">{hint}</p>
      </>}
      <ArrowDown aria-hidden="true" className={cn('size-5', !compact && 'mx-auto mt-2')} />
      {compact && <span className="sr-only">{hint}</span>}
    </div>
  );
}
