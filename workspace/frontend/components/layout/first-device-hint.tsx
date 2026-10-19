'use client';

import { ArrowDown } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** An in-flow pointer keeps the connection button and footer controls usable. */
export function FirstDeviceHint({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return (
    <div className={cn('text-emerald-700 dark:text-emerald-300', compact ? 'flex justify-center py-1' : 'mx-1 mb-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 pt-3 pb-2')}>
      {!compact && <>
        <p className="text-xs font-semibold">{t('nav.firstDeviceTitle')}</p>
        <p className="mt-1 text-xs leading-relaxed">{t('nav.firstDeviceHint')}</p>
      </>}
      <ArrowDown aria-hidden="true" className={cn('size-5', !compact && 'mx-auto mt-2')} />
      {compact && <span className="sr-only">{t('nav.firstDeviceHint')}</span>}
    </div>
  );
}
