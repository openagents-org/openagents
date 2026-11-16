'use client';

import { useRef, type ReactNode } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/* ── Scrubber ────────────────────────────────────────────────────────────── */

/**
 * A track you can click, drag and arrow-key.
 *
 * Pointer capture rather than window listeners: the drag keeps following the
 * pointer past the edge of the bar, which is where it always ends up, without
 * leaking a listener if the pane closes mid-drag.
 */
export function Scrubber({
  value,
  max,
  onSeek,
  accent,
  label,
  step = 5,
  disabled = false,
  className,
}: {
  value: number;
  max: number;
  onSeek: (value: number) => void;
  accent: string;
  label: string;
  /** How far one arrow-key press moves. */
  step?: number;
  /** Nothing to seek within yet — inert rather than hidden, so the layout
   *  doesn't jump the moment metadata lands. */
  disabled?: boolean;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  const seekToPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el || max <= 0) return;
    const { left, width } = el.getBoundingClientRect();
    if (width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (clientX - left) / width)) * max);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekToPointer(e.clientX);
      }}
      onPointerMove={(e) => {
        if (disabled) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekToPointer(e.clientX);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onSeek(Math.max(0, value - step));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onSeek(Math.min(max, value + step));
        }
      }}
      className={cn(
        'group/scrubber relative flex h-4 touch-none items-center outline-none',
        disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-current/20">
        <div
          className="h-full rounded-full"
          style={{ width: `${fraction * 100}%`, background: accent }}
        />
      </div>
      {/* The handle stays put rather than appearing on hover: it's the marker
          for where you are, and half of what makes the bar look draggable. */}
      <span
        aria-hidden
        className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full shadow-sm ring-2 ring-current/10 transition-transform group-hover/scrubber:scale-125"
        style={{ left: `${fraction * 100}%`, background: accent }}
      />
    </div>
  );
}

/* ── Transport pieces ────────────────────────────────────────────────────── */

export function VolumeControl({
  volume,
  muted,
  onToggleMute,
  onChange,
  accent,
  tone = 'default',
  disabled = false,
  className,
}: {
  volume: number;
  muted: boolean;
  onToggleMute: () => void;
  onChange: (value: number) => void;
  accent: string;
  /** `over-media` sits on top of video, where the surface is always dark. */
  tone?: 'default' | 'over-media';
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  const effective = muted ? 0 : volume;
  const overMedia = tone === 'over-media';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleMute}
        disabled={disabled}
        aria-label={muted ? t("media.unmute") : t("media.mute")}
        className={
          overMedia ? 'text-white hover:bg-white/15 hover:text-white' : 'text-muted-foreground'
        }
      >
        {effective === 0 ? <VolumeX /> : <Volume2 />}
      </Button>
      <Scrubber
        value={effective}
        max={1}
        step={0.1}
        onSeek={onChange}
        accent={accent}
        label={t("media.volume")}
        disabled={disabled}
        className={cn('w-24', overMedia && 'text-white')}
      />
      {/* The number is the point of a volume slider you can't hear yourself
          set — it's the only way to come back to the level you had. */}
      <span
        className={cn(
          'w-9 shrink-0 text-xs tabular-nums',
          overMedia ? 'text-white/70' : 'text-muted-foreground',
        )}
      >
        {Math.round(effective * 100)}%
      </span>
    </div>
  );
}

/** Transport button — same shape either side of a light or dark surface. */
export function TransportButton({
  onClick,
  disabled,
  label,
  active,
  tone = 'default',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  active?: boolean;
  tone?: 'default' | 'over-media';
  children: ReactNode;
}) {
  const overMedia = tone === 'over-media';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            overMedia ? 'text-white hover:bg-white/15 hover:text-white' : 'text-muted-foreground',
            active && !overMedia && 'text-foreground',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
