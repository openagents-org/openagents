'use client';

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { capture } from '@/lib/analytics';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { FeatureTourOverlay, TOUR_BLUE, TOUR_META, type TourFeature } from './feature-tours';
import { TourDismissButton, type TourDismissScope } from './tour-dismiss-button';

// Light keeps the soft brand wash; dark sits on the app's own neutral surface
// instead of a navy band.
const SURFACE = 'bg-linear-to-r from-blue-50 to-sky-50 dark:bg-none dark:bg-muted/50';

const bannerKey = (feature: TourFeature) => `oa:tourBanner:${feature}`;

// Banners hidden "for now". Module state on purpose: it outlives switching
// between views, and resets whenever the workspace is loaded again — which is
// exactly when a hidden-for-now banner should come back.
const hiddenThisSession = new Set<TourFeature>();

/**
 * Drop-in banner for a feature view's top edge. Self-contained: manages its
 * own dismissal flag and renders the tour overlay itself. `compact` stacks
 * the layout for narrow list panels (e.g. the routines rail).
 */
export function FeatureTourBanner({ feature, compact = false }: { feature: TourFeature; compact?: boolean }) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [open, setOpen] = useState(false);
  const meta = TOUR_META[feature];

  useEffect(() => {
    let forever = false;
    try { forever = localStorage.getItem(bannerKey(feature)) === '1'; } catch {}
    setDismissed(forever || hiddenThisSession.has(feature));
    setMounted(true);
  }, [feature]);

  const dismiss = (scope: TourDismissScope) => {
    if (scope === 'forever') {
      try { localStorage.setItem(bannerKey(feature), '1'); } catch {}
    } else {
      hiddenThisSession.add(feature);
    }
    capture('feature_tour_banner_dismissed', { feature, scope });
    setDismissed(true);
  };
  const watch = () => {
    capture('feature_tour_opened', { feature });
    setOpen(true);
  };

  if (!mounted || dismissed) {
    return open ? <FeatureTourOverlay feature={feature} onClose={() => setOpen(false)} /> : null;
  }

  const icon = (
    <span className={cn(
      'flex shrink-0 items-center justify-center rounded-md border bg-white dark:bg-background',
      compact ? 'size-6' : 'size-7',
    )} style={{ color: TOUR_BLUE }}>
      <meta.icon className={compact ? 'size-3.5' : 'size-4'} />
    </span>
  );
  const watchButton = (
    <button onClick={watch}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90',
        compact ? 'h-6 rounded-md px-2' : 'ml-1 rounded-full px-3 py-1',
      )}
      style={{ background: TOUR_BLUE }}>
      <Play className="size-3 fill-current" />{t('featureTours.watch')}
    </button>
  );

  return (
    <>
      {compact ? (
        // Narrow rails: an inset card, X in its corner, the action under the copy.
        <div className="shrink-0 border-b p-2">
          <div className={cn('relative flex gap-2.5 rounded-lg border p-2.5 pr-8', SURFACE)}>
            {icon}
            <div className="min-w-0 space-y-2">
              <p className="text-xs leading-relaxed text-foreground/80">{t(`featureTours.${feature}Banner`)}</p>
              {watchButton}
            </div>
            <TourDismissButton onDismiss={dismiss} className="absolute right-1.5 top-1.5 size-6" iconClassName="size-3.5" />
          </div>
        </div>
      ) : (
        // The X sits outside the flow so the copy centres on the full width;
        // px-12 keeps long copy clear of it.
        <div className={cn('relative flex shrink-0 items-center justify-center gap-2.5 border-b px-12 py-2 text-sm', SURFACE)}>
          {icon}
          <span className="min-w-0 truncate text-foreground">{t(`featureTours.${feature}Banner`)}</span>
          {watchButton}
          <TourDismissButton onDismiss={dismiss} className="absolute right-3 size-7" iconClassName="size-4" />
        </div>
      )}
      {open && <FeatureTourOverlay feature={feature} onClose={() => setOpen(false)} />}
    </>
  );
}
