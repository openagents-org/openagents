'use client';

import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { FeatureTourOverlay, TOUR_META, type TourFeature } from './feature-tours';
import { TourDismissButton, type TourDismissScope } from './tour-dismiss-button';

// A neutral wash, the same surface as the thread banners.
const SURFACE = 'bg-muted/50';

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
    setDismissed(true);
  };
  const watch = () => {
    setOpen(true);
  };

  if (!mounted || dismissed) {
    return open ? <FeatureTourOverlay feature={feature} onClose={() => setOpen(false)} /> : null;
  }

  const icon = (
    <span className={cn(
      'flex shrink-0 items-center justify-center rounded-md border bg-background text-foreground',
      compact ? 'size-6' : 'size-7',
    )}>
      <meta.icon className={compact ? 'size-3.5' : 'size-4'} />
    </span>
  );
  const watchButton = (
    <Button size="xs" onClick={watch} className={cn('shrink-0', compact ? 'self-start' : 'ml-1 rounded-full')}>
      <Play data-icon="inline-start" className="fill-current" />{t('featureTours.watch')}
    </Button>
  );

  return (
    <>
      {compact ? (
        // Narrow rails: an inset card, X in its corner, the action under the copy.
        <div className="shrink-0 border-b p-2">
          <div className={cn('relative flex gap-2.5 rounded-lg border p-2.5 pr-8', SURFACE)}>
            {icon}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs leading-relaxed text-foreground/80">{t(`featureTours.${feature}Banner`)}</p>
              {watchButton}
            </div>
            <TourDismissButton onDismiss={dismiss} size="icon-xs" className="absolute top-1.5 right-1.5" />
          </div>
        </div>
      ) : (
        // The X sits outside the flow so the copy centres on the full width;
        // px-12 keeps long copy clear of it.
        <div className={cn('relative flex shrink-0 items-center justify-center gap-2.5 border-b px-12 py-2 text-sm', SURFACE)}>
          {icon}
          <span className="min-w-0 truncate text-foreground">{t(`featureTours.${feature}Banner`)}</span>
          {watchButton}
          <TourDismissButton onDismiss={dismiss} className="absolute right-3" />
        </div>
      )}
      {open && <FeatureTourOverlay feature={feature} onClose={() => setOpen(false)} />}
    </>
  );
}
