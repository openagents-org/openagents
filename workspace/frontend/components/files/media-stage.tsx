'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  basename,
  getFileExtensionLabel,
  getFileIconLarge,
  getFileTypeMeta,
} from './file-utils';
import { InfoPanel, InfoSection, PendingValue, ViewerFooter } from './viewer-chrome';

/* ────────────────────────────────────────────────────────────────────────────
 * Media stages
 *
 * Audio and video get players of their own rather than the browser's default
 * controls: those are a grey bar with no room for the things you actually reach
 * for on a recording — skipping back ten seconds, slowing a demo down, seeing
 * how long is left without hovering.
 *
 * Everything here is driven by a real <audio>/<video> element. The element is
 * the state; this component reflects it. Nothing is simulated on a timer —
 * a fake clock and a real decoder disagree the moment either one stalls.
 * ──────────────────────────────────────────────────────────────────────────── */

/** How far the skip buttons jump — the length of a sentence you missed. */
const SKIP_SECONDS = 10;

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** m:ss, or h:mm:ss once there's an hour to show. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Average bitrate, derived rather than read.
 *
 * There's no container parser here, so this is the whole file over its whole
 * duration — cover art and tags included. Close enough to tell 128 from 320,
 * which is what the number is for, and it's marked approximate for the rest.
 */
function approximateBitrate(size: number, duration: number): string | null {
  if (!duration || !Number.isFinite(duration)) return null;
  return `≈${Math.round((size * 8) / duration / 1000)} kbps`;
}

/** What the footer says the player is doing right now. */
function transportStatus(player: {
  failed: boolean;
  ready: boolean;
  buffering: boolean;
  playing: boolean;
}): string {
  if (player.failed) return 'Unavailable';
  if (!player.ready) return 'Loading';
  if (player.buffering) return 'Buffering';
  return player.playing ? 'Playing' : 'Paused';
}

/* ── Player state ────────────────────────────────────────────────────────── */

interface MediaPlayer<T extends HTMLMediaElement> {
  ref: React.RefObject<T | null>;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  rate: number;
  loop: boolean;
  /** Metadata is in, so there's a duration to seek within. Until then the
   *  transport would be aiming at a track of unknown length. */
  ready: boolean;
  /** Playing, but out of buffered data — the wait is the network's, not ours. */
  buffering: boolean;
  /** The element gave up on the source. Nothing here will start working. */
  failed: boolean;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  changeVolume: (value: number) => void;
  toggleMute: () => void;
  changeRate: (value: number) => void;
  toggleLoop: () => void;
}

/**
 * Mirror a media element's state into React.
 *
 * Reads follow the element's own events, so the UI stays right when something
 * moves the playhead without going through us — the keyboard, picture-in-
 * picture, the OS media keys, a seek that lands short of where it was asked to.
 */
function useMediaPlayer<T extends HTMLMediaElement>(): MediaPlayer<T> {
  const ref = useRef<T>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const syncTime = () => setTime(el.currentTime);
    const syncDuration = () => {
      const known = Number.isFinite(el.duration) && el.duration > 0;
      setDuration(known ? el.duration : 0);
      // A live or fragmented source reports Infinity: it plays, but there's no
      // length to scrub inside, so it never counts as ready.
      if (known) setReady(true);
    };
    const syncVolume = () => {
      setVolume(el.volume);
      setMuted(el.muted);
    };
    const syncRate = () => setRate(el.playbackRate);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onResume = () => setBuffering(false);
    const onError = () => {
      setFailed(true);
      setReady(false);
      setBuffering(false);
    };

    el.addEventListener('timeupdate', syncTime);
    el.addEventListener('seeked', syncTime);
    el.addEventListener('loadedmetadata', syncDuration);
    el.addEventListener('durationchange', syncDuration);
    el.addEventListener('volumechange', syncVolume);
    el.addEventListener('ratechange', syncRate);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onResume);
    el.addEventListener('canplay', onResume);
    el.addEventListener('error', onError);

    // The element may already be past these events by the time the listeners
    // land — a cached file can have its metadata before React commits.
    if (el.readyState >= 1) syncDuration();

    return () => {
      el.removeEventListener('timeupdate', syncTime);
      el.removeEventListener('seeked', syncTime);
      el.removeEventListener('loadedmetadata', syncDuration);
      el.removeEventListener('durationchange', syncDuration);
      el.removeEventListener('volumechange', syncVolume);
      el.removeEventListener('ratechange', syncRate);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onResume);
      el.removeEventListener('canplay', onResume);
      el.removeEventListener('error', onError);
    };
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A rejected play() is normal (autoplay policy, a source that 404s); the
    // element stays paused and the button still reads "play".
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = ref.current;
    if (!el) return;
    const target = Math.min(Math.max(0, seconds), el.duration || 0);
    el.currentTime = target;
    // Ahead of the element's own event, so dragging doesn't lag the pointer.
    setTime(target);
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const el = ref.current;
      if (el) seek(el.currentTime + delta);
    },
    [seek],
  );

  const changeVolume = useCallback((value: number) => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, value));
    // Nudging the slider off zero is how you unmute — leaving it muted would
    // move the bar and change nothing you can hear.
    if (el.volume > 0) el.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const el = ref.current;
    if (el) el.muted = !el.muted;
  }, []);

  const changeRate = useCallback((value: number) => {
    const el = ref.current;
    if (el) el.playbackRate = value;
  }, []);

  const toggleLoop = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // No `loopchange` event exists, so this is the one piece of state the
    // element can't report back — set both sides together.
    el.loop = !el.loop;
    setLoop(el.loop);
  }, []);

  return {
    ref,
    playing,
    time,
    duration,
    volume,
    muted,
    rate,
    loop,
    ready,
    buffering,
    failed,
    toggle,
    seek,
    skip,
    changeVolume,
    toggleMute,
    changeRate,
    toggleLoop,
  };
}

/* ── Scrubber ────────────────────────────────────────────────────────────── */

/**
 * A track you can click, drag and arrow-key.
 *
 * Pointer capture rather than window listeners: the drag keeps following the
 * pointer past the edge of the bar, which is where it always ends up, without
 * leaking a listener if the pane closes mid-drag.
 */
function Scrubber({
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
function useAudioPeaks(
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
function Waveform({
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
      aria-label="Seek"
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
function WaveformPlaceholder() {
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

/* ── Transport pieces ────────────────────────────────────────────────────── */

function VolumeControl({
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
  const effective = muted ? 0 : volume;
  const overMedia = tone === 'over-media';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        variant="ghost"
        mode="icon"
        size="sm"
        onClick={onToggleMute}
        disabled={disabled}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className={
          overMedia ? 'text-white hover:bg-white/15 hover:text-white' : 'text-muted-foreground'
        }
      >
        {effective === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </Button>
      <Scrubber
        value={effective}
        max={1}
        step={0.1}
        onSeek={onChange}
        accent={accent}
        label="Volume"
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
function TransportButton({
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
          mode="icon"
          size="sm"
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

/* ── Audio ───────────────────────────────────────────────────────────────── */

/**
 * Audio has nothing to look at, so the type tile stands in for artwork and the
 * waveform carries the page: it's the one thing on screen that says anything
 * about this particular recording.
 */
export function AudioStage({
  src,
  filename,
  contentType,
  size,
  infoOpen = true,
}: {
  src: string;
  filename: string;
  contentType: string;
  size: number;
  infoOpen?: boolean;
}) {
  const player = useMediaPlayer<HTMLAudioElement>();
  const { peaks, status: waveform } = useAudioPeaks(src, size);
  const { color, label } = getFileTypeMeta(contentType, filename);
  // Nothing is operable until the file has a length. A play button that does
  // nothing, and a 0:00 / 0:00 readout, both read as "broken" rather than
  // "still coming" — which is exactly what a large file looks like for a while.
  const locked = !player.ready;
  const bitrate = approximateBitrate(size, player.duration);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-8">
          {/* The cover carries the name: a big tinted panel with a caption under
            it reads as two things, and there's only one thing here. */}
          <div
            className="flex w-full max-w-sm shrink-0 flex-col items-center gap-4 rounded-3xl border border-border px-8 py-10 shadow-sm"
            style={{
              background: `color-mix(in oklab, ${color} 14%, transparent)`,
            }}
          >
            {getFileIconLarge(contentType, filename, 'size-14')}
            <div className="w-full text-center">
              <p className="truncate text-base font-semibold" title={filename}>
                {basename(filename)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
            </div>
          </div>

          <div className="w-full max-w-2xl shrink-0 space-y-3">
            {waveform === 'analysing' ? (
              <WaveformPlaceholder />
            ) : peaks ? (
              <Waveform
                peaks={peaks}
                value={player.time}
                max={player.duration}
                accent={color}
                onSeek={player.seek}
                disabled={locked}
              />
            ) : null}

            {/* The precise control, under the shape. The waveform is for aiming
              at a passage; this is for aiming at a time. */}
            <div>
              <Scrubber
                value={player.time}
                max={player.duration}
                onSeek={player.seek}
                accent={color}
                label="Seek"
                disabled={locked}
                className="text-muted-foreground"
              />
              <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
                {/* An em dash rather than 0:00 while the length is unknown: two
                  zeroes look like a track that is somehow both empty and loaded. */}
                <span>{locked ? '—' : formatDuration(player.time)}</span>
                <span>{locked ? '—' : formatDuration(player.duration)}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <TransportButton
              onClick={() => player.skip(-SKIP_SECONDS)}
              disabled={locked}
              label={`Back ${SKIP_SECONDS} seconds`}
            >
              <SkipBack className="size-5" />
            </TransportButton>

            <Button
              mode="icon"
              onClick={player.toggle}
              disabled={locked}
              aria-label={player.playing ? 'Pause' : 'Play'}
              className="size-14 rounded-full text-white shadow-md hover:opacity-90"
              style={{ background: color }}
            >
              {locked ? (
                <Loader2 className="size-6 animate-spin" />
              ) : player.playing ? (
                <Pause className="size-6" />
              ) : (
                <Play className="size-6 translate-x-0.5" />
              )}
            </Button>

            <TransportButton
              onClick={() => player.skip(SKIP_SECONDS)}
              disabled={locked}
              label={`Forward ${SKIP_SECONDS} seconds`}
            >
              <SkipForward className="size-5" />
            </TransportButton>

            <TransportButton
              onClick={player.toggleLoop}
              disabled={locked}
              active={player.loop}
              label="Repeat"
            >
              <Repeat className="size-5" style={player.loop ? { color } : undefined} />
            </TransportButton>
          </div>

          <VolumeControl
            volume={player.volume}
            muted={player.muted}
            onToggleMute={player.toggleMute}
            onChange={player.changeVolume}
            accent={color}
            disabled={locked}
            className="shrink-0"
          />

          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio ref={player.ref} src={src} preload="metadata" className="hidden" />
        </div>

        {/* Format and size aren't here: the header above already carries both,
            and a column that repeats the line two inches above it is spending
            width to say nothing. */}
        <InfoPanel open={infoOpen}>
          <InfoSection
            title="Track information"
            rows={[
              [
                'Duration',
                player.failed ? (
                  'Unavailable'
                ) : locked ? (
                  <PendingValue label="Loading" />
                ) : (
                  formatDuration(player.duration)
                ),
              ],
              // Only shown while it's happening: on a small file it's over before
              // you look, and on a big one it's the row that explains the wait.
              ...(waveform === 'analysing'
                ? ([['Waveform', <PendingValue key="waveform" label="Analysing" />]] as [
                    string,
                    ReactNode,
                  ][])
                : []),
              ...((bitrate ? [['Bitrate', bitrate]] : []) as [string, ReactNode][]),
            ]}
          />
        </InfoPanel>
      </div>

      <ViewerFooter
        left={label}
        center={
          locked
            ? transportStatus(player)
            : `${transportStatus(player)} • ${formatDuration(player.time)} / ${formatDuration(player.duration)}`
        }
        right={[getFileExtensionLabel(filename), bitrate].filter(Boolean).join(' • ')}
      />
    </div>
  );
}

/* ── Video ───────────────────────────────────────────────────────────────── */

/**
 * Video with its own chrome instead of the browser's.
 *
 * The controls sit in a band along the bottom of the picture rather than
 * fading in and out. This pane isn't a cinema — you're checking a recording,
 * scrubbing back over a step you missed, and the seek bar is what you came for.
 */
export function VideoStage({
  src,
  filename,
  contentType,
  size,
  infoOpen = true,
}: {
  src: string;
  filename: string;
  contentType: string;
  size: number;
  infoOpen?: boolean;
}) {
  const player = useMediaPlayer<HTMLVideoElement>();
  const shellRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipAvailable, setPipAvailable] = useState(false);
  const { color, label } = getFileTypeMeta(contentType, filename);
  // Same rule as audio: no length, no transport. A big video sits on a black
  // rectangle for a while, and a live play button over it invites a click that
  // can't do anything yet.
  const locked = !player.ready;
  // "1080p" the way a file's properties would put it — the short height name,
  // not the full resolution the side panel already spells out.
  const shorthand = dimensions ? `${dimensions.height}p` : null;

  useEffect(() => {
    setPipAvailable(Boolean(document.pictureInPictureEnabled));
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void shellRef.current?.requestFullscreen?.().catch(() => {});
  };

  const togglePip = () => {
    const el = player.ref.current;
    if (!el) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void el.requestPictureInPicture?.().catch(() => {});
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div
          ref={shellRef}
          onClick={locked ? undefined : player.toggle}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-black"
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={player.ref}
            src={src}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              if (el.videoWidth) setDimensions({ width: el.videoWidth, height: el.videoHeight });
            }}
            className="size-full object-contain"
          />

          {/* The one control that has to be findable without hunting. It sits on
            top of the shell's own click handler, so it needs no handler here.
            While the file is still arriving it becomes the wait indicator —
            same place, same size, so nothing moves when it turns into a
            button. Buffering mid-playback shows it again for the same reason. */}
          {(locked || player.buffering || !player.playing) && !player.failed && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/25">
              <div
                className={cn(
                  'grid size-20 place-items-center rounded-full shadow-lg',
                  (locked || player.buffering) && 'bg-black/60 backdrop-blur-sm',
                )}
                style={locked || player.buffering ? undefined : { background: color }}
              >
                {locked || player.buffering ? (
                  <Loader2 className="size-8 animate-spin text-white" />
                ) : (
                  <Play className="size-9 translate-x-1 text-white" />
                )}
              </div>
            </div>
          )}

          {player.failed && (
            <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-white/70">
              This video couldn&apos;t be loaded.
            </p>
          )}

          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 via-black/60 to-transparent px-4 pt-10 pb-3"
          >
            <Scrubber
              value={player.time}
              max={player.duration}
              onSeek={player.seek}
              accent={color}
              label="Seek"
              disabled={locked}
              className="text-white"
            />
            <div className="mt-1.5 flex justify-between text-xs tabular-nums text-white/80">
              <span>{locked ? '—' : formatDuration(player.time)}</span>
              <span>{locked ? '—' : formatDuration(player.duration)}</span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <TransportButton
                  onClick={player.toggle}
                  disabled={locked}
                  label={player.playing ? 'Pause' : 'Play'}
                  tone="over-media"
                >
                  {player.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </TransportButton>
                <TransportButton
                  onClick={() => player.skip(-SKIP_SECONDS)}
                  disabled={locked}
                  label={`Back ${SKIP_SECONDS} seconds`}
                  tone="over-media"
                >
                  <SkipBack className="size-4" />
                </TransportButton>
                <TransportButton
                  onClick={() => player.skip(SKIP_SECONDS)}
                  disabled={locked}
                  label={`Forward ${SKIP_SECONDS} seconds`}
                  tone="over-media"
                >
                  <SkipForward className="size-4" />
                </TransportButton>
                <VolumeControl
                  volume={player.volume}
                  muted={player.muted}
                  onToggleMute={player.toggleMute}
                  onChange={player.changeVolume}
                  accent={color}
                  tone="over-media"
                  disabled={locked}
                  className="ml-1 hidden sm:flex"
                />
              </div>

              <div className="flex items-center gap-1">
                {pipAvailable && (
                  <TransportButton
                    onClick={togglePip}
                    disabled={locked}
                    label="Picture in picture"
                    tone="over-media"
                  >
                    <PictureInPicture className="size-4" />
                  </TransportButton>
                )}
                <TransportButton
                  onClick={toggleFullscreen}
                  label={fullscreen ? 'Exit full screen' : 'Full screen'}
                  tone="over-media"
                >
                  {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
                </TransportButton>
              </div>
            </div>
          </div>
        </div>

        {/* See the note on the audio panel: what the header says, this doesn't
            repeat. */}
        <InfoPanel open={infoOpen}>
          <InfoSection
            title="Video information"
            rows={[
              [
                'Duration',
                player.failed ? (
                  'Unavailable'
                ) : locked ? (
                  <PendingValue label="Loading" />
                ) : (
                  formatDuration(player.duration)
                ),
              ],
              [
                'Resolution',
                player.failed ? (
                  'Unavailable'
                ) : dimensions ? (
                  `${dimensions.width} × ${dimensions.height}`
                ) : (
                  <PendingValue label="Loading" />
                ),
              ],
            ]}
          />
          {/* A grid rather than a menu: the speeds are the reason to look over
            here, and picking one is a comparison between seven numbers. */}
          <InfoSection title="Playback speed">
            <div className="grid grid-cols-4 gap-2">
              {PLAYBACK_RATES.map((rate) => (
                <Button
                  key={rate}
                  size="sm"
                  variant={player.rate === rate ? 'primary' : 'outline'}
                  onClick={() => player.changeRate(rate)}
                  disabled={locked}
                  aria-pressed={player.rate === rate}
                  className="px-0 text-xs tabular-nums"
                >
                  {rate}×
                </Button>
              ))}
            </div>
          </InfoSection>
        </InfoPanel>
      </div>

      <ViewerFooter
        left={label}
        center={
          locked
            ? transportStatus(player)
            : `${transportStatus(player)} • ${formatDuration(player.time)} / ${formatDuration(player.duration)}`
        }
        right={[getFileExtensionLabel(filename), shorthand].filter(Boolean).join(' • ')}
      />
    </div>
  );
}
