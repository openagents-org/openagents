import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { MessageKey } from '@/lib/i18n';

/** Room left around the picture when it's fitted to the pane. */
const CANVAS_PADDING = 48;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 0.25;

/**
 * How the picture is sized against the pane.
 *
 * `custom` isn't in the cycle — it's where the zoom buttons leave you, and
 * naming it is what keeps the button from claiming "Fit" while you're at 250%.
 */
export type FitMode = 'fit' | 'fill' | 'original' | 'custom';

const MODE_CYCLE: FitMode[] = ['fit', 'fill', 'original'];
export const MODE_LABEL_KEYS: Record<FitMode, MessageKey> = {
  fit: 'media.fit',
  fill: 'media.fill',
  original: 'media.originalSize',
  custom: 'media.customZoom',
};

/**
 * How big the picture is drawn: a zoom, and the sizing mode that produced it.
 * Fit and fill are recomputed against the pane on load, on rotation and as the
 * pane is resized; the zoom buttons leave the cycle for `custom`.
 */
export function useImageFit(
  canvasRef: RefObject<HTMLDivElement | null>,
  natural: { width: number; height: number } | null,
  rotation: number,
) {
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<FitMode>('fit');

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

  return { zoom, mode, changeZoom, cycleMode };
}
