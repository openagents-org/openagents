import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslateFn } from '@/lib/i18n';

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
export const SKIP_SECONDS = 10;

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** m:ss, or h:mm:ss once there's an hour to show. */
export function formatDuration(seconds: number): string {
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
export function approximateBitrate(size: number, duration: number): string | null {
  if (!duration || !Number.isFinite(duration)) return null;
  return `≈${Math.round((size * 8) / duration / 1000)} kbps`;
}

/** What the footer says the player is doing right now. */
export function transportStatus(
  player: { failed: boolean; ready: boolean; buffering: boolean; playing: boolean },
  t: TranslateFn,
): string {
  if (player.failed) return t('media.unavailable');
  if (!player.ready) return t('media.loading');
  if (player.buffering) return t('media.buffering');
  return player.playing ? t('media.playing') : t('media.paused');
}

/* ── Player state ────────────────────────────────────────────────────────── */

export interface MediaPlayer<T extends HTMLMediaElement> {
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
export function useMediaPlayer<T extends HTMLMediaElement>(): MediaPlayer<T> {
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
