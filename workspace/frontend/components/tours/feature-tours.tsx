'use client';

// Feature tours: a slim per-view banner ("Meet Routines — … ▶ Watch the 20s
// tour") that opens a full-screen tour in the welcome-deck visual language —
// big title over a framed animation that plays once and freezes on its
// closing illustration. The banner lives in feature-tour-banner.tsx.

import { useState } from 'react';
import { Globe, CalendarClock, SquareKanban, Workflow, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { BLUE, INK, BORDER, TOUR_CSS, FONT, EASE, Stamp, useClock } from './tour-scene-parts';
import { BrowserScene, RoutinesScene } from './tour-scenes';
import { TasksScene, WorkflowsScene } from './tour-scenes-board';

export type TourFeature = 'browser' | 'routines' | 'tasks' | 'workflows';

export const TOUR_META: Record<TourFeature, { icon: React.ComponentType<{ className?: string }>; dur: number; Scene: React.ComponentType<{ ms: number }> }> = {
  browser: { icon: Globe, dur: 5_200, Scene: BrowserScene },
  routines: { icon: CalendarClock, dur: 5_000, Scene: RoutinesScene },
  tasks: { icon: SquareKanban, dur: 5_000, Scene: TasksScene },
  workflows: { icon: Workflow, dur: 5_200, Scene: WorkflowsScene },
};

export function FeatureTourOverlay({ feature, onClose }: { feature: TourFeature; onClose: () => void }) {
  const t = useT();
  const [playKey, setPlayKey] = useState(0);
  const meta = TOUR_META[feature];
  const ms = useClock(meta.dur, `${feature}-${playKey}`);
  return (
    <div className="oa-tour fixed inset-0 z-100 bg-(--tour-page)" style={{ fontFamily: FONT }}>
      <div className="flex h-full flex-col items-center overflow-hidden pt-12">
        <Stamp show={ms >= 80}>
          <span className="inline-block rounded-full px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider"
            style={{ background: BLUE, color: '#fff', border: `2px solid ${INK}`, boxShadow: `3px 3px 0 0 ${INK}` }}>
            {t('featureTours.kicker')}
          </span>
        </Stamp>
        <Stamp show={ms >= 250}>
          <h1 className="mt-4 text-5xl leading-none font-black tracking-tight" style={{ color: INK }}>
            {t(`featureTours.${feature}Title`)}
          </h1>
        </Stamp>
        <div className="mt-7 overflow-hidden rounded-2xl"
          style={{
            width: 'min(900px, 94vw)', height: 'min(520px, 56vh)',
            border: `1px solid ${BORDER}`, boxShadow: '0 18px 50px rgba(11,17,33,0.14)',
            visibility: ms >= 450 ? undefined : 'hidden',
            animation: ms >= 450 ? `tour-card-up 0.5s ${EASE} backwards` : undefined,
          }}>
          <meta.Scene ms={Math.max(0, ms - 450)} />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-4 sm:px-6 sm:pb-5">
        <Button variant="ghost" size="lg" onClick={() => setPlayKey((k) => k + 1)} className="rounded-full text-muted-foreground">
          <RotateCcw data-icon="inline-start" />{t('featureTours.replay')}
        </Button>
        <Button size="lg" onClick={onClose} className="rounded-full px-6">
          {t('featureTours.done')}
        </Button>
      </div>

      <style>{`${TOUR_CSS}
        @keyframes tour-in { 0% { opacity: 0; transform: translateY(10px) scale(0.98); } 100% { opacity: 1; transform: none; } }
        @keyframes tour-card-up { 0% { opacity: 0; transform: translateY(36px) scale(0.97); } 100% { opacity: 1; transform: none; } }
        @keyframes tour-blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}
