'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';

export function ArtifactSplitView({ conversation, preview, width, onResize }: { conversation: ReactNode; preview: ReactNode; width: number; onResize: (value: number) => void }) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [minWidth, setMinWidth] = useState(25);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setMinWidth(Math.max(25, Math.min(45, 280 / element.getBoundingClientRect().width * 100)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const visibleWidth = Math.max(minWidth, Math.min(100 - minWidth, width));
  const resize = (value: number) => {
    const next = Math.max(minWidth, Math.min(100 - minWidth, value));
    onResize(next);
  };

  return (
    <div ref={container} className="relative flex min-w-0 flex-1">
      <div className="relative min-w-0 overflow-hidden bg-background" style={{ flex: `0 0 ${visibleWidth}%` }}>
        {conversation}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={t('artifactPanel.resize')}
        aria-orientation="vertical"
        aria-valuemin={Math.ceil(minWidth)}
        aria-valuemax={Math.floor(100 - minWidth)}
        aria-valuenow={Math.round(visibleWidth)}
        title={t('artifactPanel.resizeHint')}
        className="group relative z-50 w-px shrink-0 touch-none cursor-col-resize bg-border outline-none before:absolute before:inset-y-0 before:-inset-x-1 after:absolute after:inset-y-0 after:-inset-x-px after:bg-primary after:opacity-0 hover:after:opacity-60 focus-visible:after:opacity-100 data-[dragging=true]:after:opacity-100"
        data-dragging={dragging}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={event => {
          if (!dragging || !container.current) return;
          const rect = container.current.getBoundingClientRect();
          const rtl = getComputedStyle(container.current).direction === 'rtl';
          resize((rtl ? rect.right - event.clientX : event.clientX - rect.left) / rect.width * 100);
        }}
        onPointerUp={event => {
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
        onDoubleClick={() => resize(50)}
        onKeyDown={event => {
          const rtl = container.current && getComputedStyle(container.current).direction === 'rtl';
          const step = event.shiftKey ? 10 : 2;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            resize(visibleWidth + (event.key === 'ArrowLeft' ? -step : step) * (rtl ? -1 : 1));
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            resize(event.key === 'Home' ? minWidth : 100 - minWidth);
          }
        }}
      />
      <div className="relative min-w-0 flex-1 overflow-hidden bg-background">{preview}</div>
      {/* Keep embedded pages from swallowing pointer events during a drag. */}
      {dragging && <div className="absolute inset-0 z-40 cursor-col-resize select-none" />}
    </div>
  );
}
