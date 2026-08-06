'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FlipHorizontal,
  ImageOff,
  Loader2,
  Maximize2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { basename, getFileTypeMeta } from './file-utils';
import { useT, type MessageKey } from '@/lib/i18n';
import { ViewerFooter, ViewerToolbar } from './viewer-chrome';

/** Room left around the picture when it's fitted to the pane. */
const CANVAS_PADDING = 48;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

/**
 * How the picture is sized against the pane.
 *
 * `custom` isn't in the cycle — it's where the zoom buttons leave you, and
 * naming it is what keeps the button from claiming "Fit" while you're at 250%.
 */
type FitMode = 'fit' | 'fill' | 'original' | 'custom';

const MODE_CYCLE: FitMode[] = ['fit', 'fill', 'original'];
const MODE_LABEL_KEYS: Record<FitMode, MessageKey> = {
  fit: 'media.fit',
  fill: 'media.fill',
  original: 'media.originalSize',
  custom: 'media.customZoom',
};

/** The other images in this folder, so a preview isn't a dead end. */
export interface ImageSiblings {
  /** 1-based, for display. */
  position: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * The image stage: a toolbar, a canvas that scrolls, and a status line.
 *
 * No metadata column — a picture wants the width, and everything a column
 * would hold about it (its pixel size, the zoom, the rotation) is a short
 * enough phrase to live in the footer.
 *
 * Zoom is a percentage of the image's own pixels — 100% means one image pixel
 * per screen pixel, the way every other image viewer means it. The fit modes
 * are then zoom values rather than separate rendering modes, which is what lets
 * the canvas scroll correctly: the picture's laid-out width really is its
 * zoomed width, so overflow is reachable instead of clipped.
 */
export function ImageStage({
  src,
  filename,
  contentType,
  siblings,
}: {
  src: string;
  filename: string;
  contentType: string;
  siblings?: ImageSiblings;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<FitMode>('fit');
  /**
   * Total degrees turned, not the angle it lands on.
   *
   * Wrapping to 0 at the fourth press told CSS to animate from 270° back to 0,
   * so the picture spun three quarters of the way backwards to reach the place
   * one more quarter-turn forwards would have put it. Counting up keeps every
   * press the same short turn in the same direction; only the readout wraps.
   */
  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = useT();
  const { labelKey } = getFileTypeMeta(contentType, filename);

  const loaded = natural !== null;
  const heading = rotation % 360;

  /** The zoom a sizing mode works out to, given the pane and a quarter turn. */
  const zoomForMode = useCallback(
    (target: FitMode) => {
      const canvas = canvasRef.current;
      if (!canvas || !natural || target === 'original' || target === 'custom') return 1;
      const turned = rotation % 180 !== 0;
      const width = turned ? natural.height : natural.width;
      const height = turned ? natural.width : natural.height;
      const across = Math.max(1, canvas.clientWidth - CANVAS_PADDING) / width;
      const down = Math.max(1, canvas.clientHeight - CANVAS_PADDING) / height;
      // Fit is bounded at 1 — blowing a small image up to fill the pane isn't
      // "fit", it's a decision the user didn't make. Fill is the opposite by
      // definition: cover the pane and let the overflow be scrolled to.
      return target === 'fill' ? Math.max(across, down) : Math.min(1, across, down);
    },
    [natural, rotation],
  );

  // Re-apply the sizing on load, on rotation, and as the pane is resized —
  // dragging the seam between panes is a resize, and a picture that stops
  // fitting halfway through the drag looks like it broke.
  useEffect(() => {
    if (!natural || mode === 'custom' || mode === 'original') return;
    const apply = () => setZoom(zoomForMode(mode));
    apply();
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mode, natural, zoomForMode]);

  const changeZoom = (delta: number) => {
    setMode('custom');
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(current + delta).toFixed(2))));
  };

  const cycleMode = () => {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length];
    setMode(next);
    if (next === 'original') setZoom(1);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewerToolbar
          left={
            <>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                onClick={() => changeZoom(-ZOOM_STEP)}
                disabled={!loaded || zoom <= MIN_ZOOM}
                aria-label={t("media.zoomOut")}
                className="text-muted-foreground"
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                {loaded ? `${Math.round(zoom * 100)}%` : '—'}
              </span>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                onClick={() => changeZoom(ZOOM_STEP)}
                disabled={!loaded || zoom >= MAX_ZOOM}
                aria-label={t("media.zoomIn")}
                className="text-muted-foreground"
              >
                <ZoomIn className="size-4" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={cycleMode}
                disabled={!loaded}
                aria-label={t("media.sizingMode", { mode: t(MODE_LABEL_KEYS[mode]) })}
                className="ml-1 gap-1.5 text-muted-foreground"
              >
                <Maximize2 className="size-3.5" />
                {t(MODE_LABEL_KEYS[mode])}
              </Button>
            </>
          }
          right={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    onClick={() => setRotation((r) => r + 90)}
                    disabled={!loaded}
                    aria-label={t("media.rotate")}
                    className="text-muted-foreground"
                  >
                    <RotateCw className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("media.rotate90")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    onClick={() => setFlipped((f) => !f)}
                    disabled={!loaded}
                    aria-label={t("media.flipHorizontally")}
                    aria-pressed={flipped}
                    className={cn('text-muted-foreground', flipped && 'text-foreground')}
                  >
                    <FlipHorizontal className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("media.flipHorizontally")}</TooltipContent>
              </Tooltip>
            </>
          }
        />

        <div ref={canvasRef} className="relative flex-1 overflow-auto bg-muted/30">
          {/* `w-max min-w-full` is what makes a zoomed-in picture reachable:
                the wrapper grows to the image rather than centring it inside a
                box the image is already wider than. */}
          <div className="flex h-max min-h-full w-max min-w-full items-center justify-center p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={basename(filename)}
              onLoad={(e) =>
                setNatural({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
              style={{
                width: natural ? `${Math.round(natural.width * zoom)}px` : undefined,
                transform: `rotate(${rotation}deg) scaleX(${flipped ? -1 : 1})`,
              }}
              className={cn(
                'max-w-none rounded shadow-sm transition-transform duration-150',
                !loaded && 'invisible',
              )}
            />
          </div>

          {!loaded && !failed && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {failed && (
            <div className="absolute inset-0 grid place-items-center text-center">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <ImageOff className="size-8 opacity-40" />
                <p className="text-sm">This image couldn&apos;t be loaded.</p>
              </div>
            </div>
          )}
        </div>

        {/* The folder is the album: stepping between its pictures without
              going back to the grid is the reason to open one full-size. */}
        {siblings && siblings.total > 1 && (
          <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-border">
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={siblings.onPrevious}
              aria-label={t("media.previousImage")}
              className="text-muted-foreground"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
              {siblings.position} / {siblings.total}
            </span>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={siblings.onNext}
              aria-label={t("media.nextImage")}
              className="text-muted-foreground"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <ViewerFooter
        left={t(labelKey)}
        center={
          failed
            ? t('media.unavailable')
            : loaded
              ? t('media.imageStatus', {
                  zoom: Math.round(zoom * 100),
                  heading,
                  mode: t(MODE_LABEL_KEYS[mode]),
                })
              : t('media.loading')
        }
        right={natural ? `${natural.width} × ${natural.height} px` : undefined}
      />
    </div>
  );
}
