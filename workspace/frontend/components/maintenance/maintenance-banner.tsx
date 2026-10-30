'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Wrench, X } from 'lucide-react';
import { useI18n, useT } from '@/lib/i18n';
import { MAINTENANCE_WINDOW, maintenancePhase, type MaintenancePhase } from '@/lib/maintenance';

const PT = 'America/Los_Angeles';
const BANNER_VAR = '--oa-banner-h';

function viewerTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** "Oct 15, 3:00 – 4:00 AM GMT+8" in the viewer's own zone and language. */
function localRange(locale: string, start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const f = fmt as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
  return typeof f.formatRange === 'function' ? f.formatRange(start, end) : `${fmt.format(start)} – ${fmt.format(end)}`;
}

function localTime(locale: string, at: Date): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at);
}

/**
 * Site-wide notice for a scheduled maintenance window (see lib/maintenance).
 * Sits in normal flow above the app and publishes its height as
 * `--oa-banner-h`, which the full-height app shells subtract — so nothing is
 * covered and nothing overflows. Dismissible for the session while upcoming;
 * pinned while the upgrade is running (the frontend stays up on Vercel even
 * while the backend is down, so this is what users see during the hour).
 */
export function MaintenanceBanner() {
  const t = useT();
  const { locale } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<MaintenancePhase | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const w = MAINTENANCE_WINDOW;
  const storageKey = w ? `oa:maintenance-dismissed:${w.id}` : '';

  useEffect(() => {
    // `?oaMaintenance=upcoming|active` forces a phase for QA screenshots.
    let forced: MaintenancePhase | null = null;
    try {
      const q = new URLSearchParams(window.location.search).get('oaMaintenance');
      if (q === 'upcoming' || q === 'active') forced = q;
    } catch {}
    const tick = () => setPhase(forced ?? maintenancePhase(Date.now()));
    tick();
    const id = window.setInterval(tick, 30_000);
    try {
      setDismissed(sessionStorage.getItem(storageKey) === '1');
    } catch {}
    return () => window.clearInterval(id);
  }, [storageKey]);

  const visible = !!w && (phase === 'active' || (phase === 'upcoming' && !dismissed));

  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.setProperty(BANNER_VAR, '0px');
      return;
    }
    const publish = () => root.style.setProperty(BANNER_VAR, `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty(BANNER_VAR, '0px');
    };
  }, [visible]);

  if (!w || !visible) return null;

  const start = new Date(w.start);
  const end = new Date(w.end);
  const showLocal = viewerTimeZone() !== PT;
  const local = showLocal ? localRange(locale, start, end) : '';
  const localEnd = localTime(locale, end);

  let text: string;
  if (phase === 'active') {
    text = t('maintenance.active', { end: localEnd });
  } else {
    text = showLocal ? t('maintenance.upcomingWithLocal', { local }) : t('maintenance.upcoming');
  }

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(storageKey, '1');
    } catch {}
  };

  return (
    <div
      ref={ref}
      role="status"
      className="relative z-50 flex w-full items-start gap-2.5 border-b border-amber-300 bg-amber-50 px-4 py-2 text-[13px] leading-snug text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-100 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:items-center"
    >
      <Wrench className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{t(phase === 'active' ? 'maintenance.activeTitle' : 'maintenance.upcomingTitle')}</span>{' '}
        {text}
      </p>
      {phase === 'upcoming' && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('maintenance.dismiss')}
          className="-m-1 shrink-0 rounded p-1 text-amber-900/70 hover:bg-amber-100 hover:text-amber-950 dark:text-amber-100/70 dark:hover:bg-amber-900/50"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
