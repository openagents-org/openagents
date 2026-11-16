'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { SKIP_SECONDS } from './media-player';

/* ── Waveform ────────────────────────────────────────────────────────────── */

/** Bars in the waveform — enough to read a shape, few enough to stay cheap. */
const WAVEFORM_BARS = 96;
/** Past this, drawing the shape costs more than it's worth: see the hook. */
const MAX_WAVEFORM_BYTES = 15 * 1024 * 1024;

/**
 * The track's actual loudness over time, or null when we won't compute it.
 *
 * Measured off the real samples — a waveform is a claim about the audio, and a
 * decorative one made of random numbers says "quiet here, loud there" about a
 * recording it has never heard. Two costs keep it from being unconditional: the
 * bytes come down a second time (the <audio> element streams its own copy so
 * playback can start immediately), and decoding holds the whole track as PCM
 * for a moment. Past `MAX_WAVEFORM_BYTES` neither is worth a picture, and the
 * plain scrubber carries on alone.
 */
export function useAudioPeaks(
  src: string,
  size: number,
): {
  peaks: number[] | null;
  /** `skipped` covers both "too big to bother" and "couldn't decode it" — in
   *  both cases there is nothing to wait for, so nothing should say otherwise. */
  status: 'analysing' | 'ready' | 'skipped';
} {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [status, setStatus] = useState<'analysing' | 'ready' | 'skipped'>('analysing');

  useEffect(() => {
    setPeaks(null);
    if (size > MAX_WAVEFORM_BYTES) {
      setStatus('skipped');
      return;
    }
    setStatus('analysing');

    let cancelled = false;
    let ctx: AudioContext | null = null;

    void (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok || cancelled) return;
        const bytes = await response.arrayBuffer();
        if (cancelled) return;

        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          setStatus('skipped');
          return;
        }
        ctx = new Ctor();
        const decoded = await ctx.decodeAudioData(bytes);
        if (cancelled) return;

        const samples = decoded.getChannelData(0);
        const perBar = Math.floor(samples.length / WAVEFORM_BARS) || 1;
        const next: number[] = [];
        let loudest = 0;

        for (let bar = 0; bar < WAVEFORM_BARS; bar++) {
          const start = bar * perBar;
          const end = Math.min(start + perBar, samples.length);
          let peak = 0;
          for (let i = start; i < end; i++) {
            const level = Math.abs(samples[i]);
            if (level > peak) peak = level;
          }
          if (peak > loudest) loudest = peak;
          next.push(peak);
        }

        // Normalised against the track's own loudest moment, so a quietly
        // recorded interview isn't drawn as a flat line.
        if (loudest > 0) {
          setPeaks(next.map((peak) => peak / loudest));
          setStatus('ready');
        } else {
          setStatus('skipped');
        }
      } catch {
        // Undecodable, or the fetch failed — the scrubber stands in.
        if (!cancelled) setStatus('skipped');
      } finally {
        void ctx?.close().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, size]);

  return { peaks, status };
}

/**
 * Loudness over time, bars rising from a baseline, played part in the accent.
 *
 * Clicking anywhere in it seeks — it's the biggest target on the page, and the
 * one where you can aim at a passage rather than at a timestamp.
 */
export function Waveform({
  peaks,
  value,
  max,
  accent,
  onSeek,
  disabled = false,
}: {
  peaks: number[];
  value: number;
  max: number;
  accent: string;
  onSeek: (value: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
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
      aria-label={t("media.seek")}
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      onPointerDown={(e) => {
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
          onSeek(Math.max(0, value - SKIP_SECONDS));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onSeek(Math.min(max, value + SKIP_SECONDS));
        }
      }}
      className={cn(
        'flex h-20 w-full touch-none items-end gap-0.5 text-muted-foreground outline-none',
        disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
      )}
    >
      {peaks.map((peak, i) => {
        const played = (i + 0.5) / peaks.length <= fraction;
        return (
          <span
            key={i}
            className={cn(
              'flex-1 rounded-full transition-colors',
              !played && 'bg-current opacity-25',
            )}
            // A floor on the height so silence is still a line you can aim at.
            style={{
              height: `${Math.max(4, peak * 100)}%`,
              background: played ? accent : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The waveform's slot while it's being computed.
 *
 * Flat bars, not a fake shape: the whole point of the waveform is that it
 * describes this recording, and something that looks like a shape before we've
 * read one would be describing nothing. Pulsing is what says "not yet".
 */
export function WaveformPlaceholder() {
  return (
    <div
      aria-hidden
      className="flex h-20 w-full animate-pulse items-end gap-0.5 text-muted-foreground"
    >
      {Array.from({ length: WAVEFORM_BARS }, (_, i) => (
        <span key={i} className="h-2 flex-1 rounded-full bg-current opacity-20" />
      ))}
    </div>
  );
}
