'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, PictureInPicture, Play, SkipBack, SkipForward } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getFileExtensionLabel, getFileTypeMeta } from './file-utils';
import { Scrubber, TransportButton, VolumeControl } from './media-controls';
import { PLAYBACK_RATES, SKIP_SECONDS, formatDuration, transportStatus, useMediaPlayer } from './media-player';
import { InfoPanel, InfoSection, PendingValue, ViewerFooter } from './viewer-chrome';

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
  const t = useT();
  const player = useMediaPlayer<HTMLVideoElement>();
  const shellRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipAvailable, setPipAvailable] = useState(false);
  const { color, labelKey } = getFileTypeMeta(contentType, filename);
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
                  <Spinner className="size-8 text-white" />
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
              label={t("media.seek")}
              disabled={locked}
              className="text-white"
            />
            <div className="mt-1.5 flex justify-between text-xs text-white/80 tabular-nums">
              <span>{locked ? '—' : formatDuration(player.time)}</span>
              <span>{locked ? '—' : formatDuration(player.duration)}</span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <TransportButton
                  onClick={player.toggle}
                  disabled={locked}
                  label={player.playing ? t("media.pause") : t("media.play")}
                  tone="over-media"
                >
                  {player.playing ? <Pause /> : <Play />}
                </TransportButton>
                <TransportButton
                  onClick={() => player.skip(-SKIP_SECONDS)}
                  disabled={locked}
                  label={t("media.skipBack", { seconds: SKIP_SECONDS })}
                  tone="over-media"
                >
                  <SkipBack />
                </TransportButton>
                <TransportButton
                  onClick={() => player.skip(SKIP_SECONDS)}
                  disabled={locked}
                  label={t("media.skipForward", { seconds: SKIP_SECONDS })}
                  tone="over-media"
                >
                  <SkipForward />
                </TransportButton>
                <VolumeControl
                  volume={player.volume}
                  muted={player.muted}
                  onToggleMute={player.toggleMute}
                  onChange={player.changeVolume}
                  accent={color}
                  tone="over-media"
                  disabled={locked}
                  className="ms-1 hidden sm:flex"
                />
              </div>

              <div className="flex items-center gap-1">
                {pipAvailable && (
                  <TransportButton
                    onClick={togglePip}
                    disabled={locked}
                    label={t("media.pictureInPicture")}
                    tone="over-media"
                  >
                    <PictureInPicture />
                  </TransportButton>
                )}
                <TransportButton
                  onClick={toggleFullscreen}
                  label={fullscreen ? t("media.exitFullScreen") : t("media.fullScreen")}
                  tone="over-media"
                >
                  {fullscreen ? <Minimize /> : <Maximize />}
                </TransportButton>
              </div>
            </div>
          </div>
        </div>

        {/* See the note on the audio panel: what the header says, this doesn't
            repeat. */}
        <InfoPanel open={infoOpen}>
          <InfoSection
            title={t("media.videoInformation")}
            rows={[
              [
                t('media.duration'),
                player.failed ? (
                  t('media.unavailable')
                ) : locked ? (
                  <PendingValue label={t("media.loading")} />
                ) : (
                  formatDuration(player.duration)
                ),
              ],
              [
                t('media.resolution'),
                player.failed ? (
                  t('media.unavailable')
                ) : dimensions ? (
                  `${dimensions.width} × ${dimensions.height}`
                ) : (
                  <PendingValue label={t("media.loading")} />
                ),
              ],
            ]}
          />
          {/* A grid rather than a menu: the speeds are the reason to look over
            here, and picking one is a comparison between seven numbers. */}
          <InfoSection title={t("media.playbackSpeed")}>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={String(player.rate)}
              onValueChange={(v) => { if (v) player.changeRate(Number(v)); }}
              disabled={locked}
              aria-label={t("media.playbackSpeed")}
              className="grid w-full grid-cols-4"
            >
              {PLAYBACK_RATES.map((rate) => (
                <ToggleGroupItem key={rate} value={String(rate)} className="px-0 text-xs tabular-nums">
                  {rate}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </InfoSection>
        </InfoPanel>
      </div>

      <ViewerFooter
        left={t(labelKey)}
        center={
          locked
            ? transportStatus(player, t)
            : `${transportStatus(player, t)} • ${formatDuration(player.time)} / ${formatDuration(player.duration)}`
        }
        right={[getFileExtensionLabel(filename), shorthand].filter(Boolean).join(' • ')}
      />
    </div>
  );
}
