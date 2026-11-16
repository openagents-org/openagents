'use client';
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
 // v1.1 M1
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import {
useLayout,
RAIL_WIDTH_COLLAPSED,
RAIL_WIDTH_EXPANDED
} from './layout-context';

export const RAIL_SNAP_POINT = (RAIL_WIDTH_COLLAPSED + RAIL_WIDTH_EXPANDED) / 2;

function clampRailWidth(width: number) {
  return Math.min(RAIL_WIDTH_EXPANDED, Math.max(RAIL_WIDTH_COLLAPSED, width));
}

/**
 * The rail's trailing seam: a drag strip riding the border line, with a round
 * toggle button floating over it at mid-height — the DingTalk treatment. Both
 * gestures land on the same two states.
 *
 * Dragging is Lark-style: the rail follows the pointer, then snaps to whichever
 * state the release landed nearest; a drag that never really moved counts as a
 * click and just toggles. The strip is `fixed` rather than absolute because the
 * sidebar shell clips its overflow, and the control straddles the seam.
 */
export function RailResizeHandle() {
  const {
    isRailExpanded, toggleRail, setRailExpanded, railDragWidth, setRailDragWidth,
  } = useLayout();
  const t = useT();
  const dragRef = React.useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null);
  const isDragging = railDragWidth !== null;
  const toggleLabel = isRailExpanded ? t('nav.collapseSidebar') : t('nav.expandSidebar');

  // While dragging, the resize cursor has to win everywhere — the pointer
  // leaves the handle long before the rail stops following it.
  React.useEffect(() => {
    if (!isDragging) return;
    const { style } = document.body;
    const prevCursor = style.cursor;
    const prevSelect = style.userSelect;
    style.cursor = 'col-resize';
    style.userSelect = 'none';
    return () => {
      style.cursor = prevCursor;
      style.userSelect = prevSelect;
    };
  }, [isDragging]);

  const startWidth = () => (isRailExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: startWidth(), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setRailDragWidth(startWidth());
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 3) drag.moved = true;
    setRailDragWidth(clampRailWidth(drag.startWidth + dx));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setRailDragWidth(null);
    if (!drag.moved) {
      toggleRail();
      return;
    }
    setRailExpanded(clampRailWidth(drag.startWidth + (e.clientX - drag.startX)) >= RAIL_SNAP_POINT);
  };

  const handlePointerCancel = () => {
    dragRef.current = null;
    setRailDragWidth(null);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={isRailExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED}
      aria-valuemin={RAIL_WIDTH_COLLAPSED}
      aria-valuemax={RAIL_WIDTH_EXPANDED}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={toggleRail}
      // Centred on the inset card's leading border (one pixel past the rail)
      // and only as tall as the card, so it never reaches into the gaps above
      // and below it (the maintenance banner, when shown, sits above the card).
      style={{
        left: 'calc(var(--sidebar-width-icon) + 1.5px)',
        top: 'calc(var(--oa-banner-h, 0px) + 0.5rem)',
      }}
      className={cn(
        'group/seam fixed bottom-2 z-30 w-3 -translate-x-1/2 cursor-col-resize touch-none select-none',
        railDragWidth === null && 'transition-[left] duration-200 ease-linear',
      )}
    >
      {/* Hovered or dragged, the card's own border darkens: the line sits
          exactly on it and stops short of the rounded corners. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-ring opacity-0 transition-opacity',
          'group-hover/seam:opacity-100',
          isDragging && 'opacity-100',
        )}
      />

      {/* Mid-height toggle, floating over the border line */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={toggleLabel}
            aria-expanded={isRailExpanded}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={toggleRail}
            className={cn(
              'absolute top-1/2 left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center',
              'rounded-full border border-border bg-background text-muted-foreground shadow-xs',
              'opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              'group-hover/seam:opacity-100',
              isDragging && 'opacity-0',
            )}
          >
            {isRailExpanded ? (
              <ChevronLeft className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{toggleLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
