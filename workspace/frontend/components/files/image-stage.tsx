'use client';

import { useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FlipHorizontal,
  ImageOff,
  Maximize2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { basename, getFileTypeMeta } from './file-utils';
import { useT } from '@/lib/i18n';
import { MAX_ZOOM, MIN_ZOOM, MODE_LABEL_KEYS, ZOOM_STEP, useImageFit } from './image-fit';
import { ViewerFooter, ViewerToolbar } from './viewer-chrome';

/** The other images in this folder, so a preview isn't a dead end. */
export interface ImageSiblings {
  /** 1-based, for display. */
  position: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

/** Previous / next through the folder's pictures, with where you are in it. */
function ImageSiblingNav({ siblings }: { siblings: ImageSiblings }) {
  const t = useT();
  return (
    <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-t">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={siblings.onPrevious}
        aria-label={t("media.previousImage")}
        className="text-muted-foreground"
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-16 text-center text-xs text-muted-foreground tabular-nums">
        {siblings.position} / {siblings.total}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={siblings.onNext}
        aria-label={t("media.nextImage")}
        className="text-muted-foreground"
      >
        <ChevronRight />
      </Button>
    </div>
  );
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
  const { zoom, mode, changeZoom, cycleMode } = useImageFit(canvasRef, natural, rotation);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewerToolbar
          left={
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => changeZoom(-ZOOM_STEP)}
                disabled={!loaded || zoom <= MIN_ZOOM}
                aria-label={t("media.zoomOut")}
                className="text-muted-foreground"
              >
                <ZoomOut />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                {loaded ? `${Math.round(zoom * 100)}%` : '—'}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => changeZoom(ZOOM_STEP)}
                disabled={!loaded || zoom >= MAX_ZOOM}
                aria-label={t("media.zoomIn")}
                className="text-muted-foreground"
              >
                <ZoomIn />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={cycleMode}
                disabled={!loaded}
                aria-label={t("media.sizingMode", { mode: t(MODE_LABEL_KEYS[mode]) })}
                className="ms-1 text-muted-foreground"
              >
                <Maximize2 data-icon="inline-start" />
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
                    size="icon-sm"
                    onClick={() => setRotation((r) => r + 90)}
                    disabled={!loaded}
                    aria-label={t("media.rotate")}
                    className="text-muted-foreground"
                  >
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("media.rotate90")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setFlipped((f) => !f)}
                    disabled={!loaded}
                    aria-label={t("media.flipHorizontally")}
                    aria-pressed={flipped}
                    className={cn('text-muted-foreground', flipped && 'text-foreground')}
                  >
                    <FlipHorizontal />
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
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          )}

          {failed && (
            <Empty className="absolute inset-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageOff />
                </EmptyMedia>
                <EmptyDescription>This image couldn&apos;t be loaded.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        {/* The folder is the album: stepping between its pictures without
            going back to the grid is the reason to open one full-size. */}
        {siblings && siblings.total > 1 && <ImageSiblingNav siblings={siblings} />}
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
