'use client';

import { useRef, type HTMLAttributes } from 'react';

/** Drag a card row without activating the card at the end of the gesture. */
export function useDragScroll(): HTMLAttributes<HTMLUListElement> {
  const gesture = useRef<{ pointerId: number; x: number; scrollLeft: number; dragged: boolean; snap: string } | null>(null);
  const suppressClick = useRef(false);
  const finish = (row: HTMLUListElement, pointerId: number) => {
    const current = gesture.current;
    if (!current || current.pointerId !== pointerId) return;
    gesture.current = null;
    if (current.dragged) {
      row.style.scrollSnapType = current.snap;
      delete row.dataset.dragging;
    }
    if (row.hasPointerCapture(pointerId)) row.releasePointerCapture(pointerId);
  };
  return {
    onPointerDown(event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: event.currentTarget.scrollLeft, dragged: false, snap: event.currentTarget.style.scrollSnapType };
    },
    onPointerMove(event) {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const row = event.currentTarget;
      if (!(event.buttons & 1)) { finish(row, event.pointerId); return; }
      const distance = event.clientX - current.x;
      if (!current.dragged) {
        if (Math.abs(distance) < 5) return;
        current.dragged = true;
        suppressClick.current = true;
        row.setPointerCapture(event.pointerId);
        row.style.scrollSnapType = 'none';
        row.dataset.dragging = 'true';
      }
      event.preventDefault();
      row.scrollLeft = current.scrollLeft - distance;
    },
    onPointerUp: event => finish(event.currentTarget, event.pointerId),
    onPointerCancel: event => finish(event.currentTarget, event.pointerId),
    onLostPointerCapture: event => finish(event.currentTarget, event.pointerId),
    onClickCapture(event) {
      // Keyboard activation remains available after a drag.
      if (suppressClick.current && event.detail > 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onDragStart: event => event.preventDefault(),
  };
}
