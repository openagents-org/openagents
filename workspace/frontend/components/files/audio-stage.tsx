'use client';

import type { ReactNode } from 'react';
import { Pause, Play, Repeat, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { basename, getFileExtensionLabel, getFileIconLarge, getFileTypeMeta } from './file-utils';
import { Waveform, WaveformPlaceholder, useAudioPeaks } from './audio-waveform';
import { Scrubber, TransportButton, VolumeControl } from './media-controls';
import { SKIP_SECONDS, approximateBitrate, formatDuration, transportStatus, useMediaPlayer } from './media-player';
import { InfoPanel, InfoSection, PendingValue, ViewerFooter } from './viewer-chrome';

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
  const t = useT();
  const player = useMediaPlayer<HTMLAudioElement>();
  const { peaks, status: waveform } = useAudioPeaks(src, size);
  const { color, labelKey } = getFileTypeMeta(contentType, filename);
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
            className="flex w-full max-w-sm shrink-0 flex-col items-center gap-4 rounded-3xl border px-8 py-10 shadow-sm"
            style={{
              background: `color-mix(in oklab, ${color} 14%, transparent)`,
            }}
          >
            {getFileIconLarge(contentType, filename, 'size-14')}
            <div className="flex w-full flex-col gap-0.5 text-center">
              <p className="truncate text-base font-semibold" title={filename}>
                {basename(filename)}
              </p>
              <p className="text-xs text-muted-foreground">{t(labelKey)}</p>
            </div>
          </div>

          <div className="flex w-full max-w-2xl shrink-0 flex-col gap-3">
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
            <div className="flex flex-col gap-1.5">
              <Scrubber
                value={player.time}
                max={player.duration}
                onSeek={player.seek}
                accent={color}
                label={t("media.seek")}
                disabled={locked}
                className="text-muted-foreground"
              />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
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
              label={t("media.skipBack", { seconds: SKIP_SECONDS })}
            >
              <SkipBack className="size-5" />
            </TransportButton>

            <Button size="icon"
              onClick={player.toggle}
              disabled={locked}
              aria-label={player.playing ? t("media.pause") : t("media.play")}
              className="size-14 rounded-full text-white shadow-md hover:opacity-90"
              style={{ background: color }}
            >
              {locked ? (
                <Spinner className="size-6" />
              ) : player.playing ? (
                <Pause className="size-6" />
              ) : (
                <Play className="size-6 translate-x-0.5" />
              )}
            </Button>

            <TransportButton
              onClick={() => player.skip(SKIP_SECONDS)}
              disabled={locked}
              label={t("media.skipForward", { seconds: SKIP_SECONDS })}
            >
              <SkipForward className="size-5" />
            </TransportButton>

            <TransportButton
              onClick={player.toggleLoop}
              disabled={locked}
              active={player.loop}
              label={t("media.repeat")}
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
            title={t("media.trackInformation")}
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
              // Only shown while it's happening: on a small file it's over before
              // you look, and on a big one it's the row that explains the wait.
              ...(waveform === 'analysing'
                ? ([[t('media.waveform'), <PendingValue key="waveform" label={t("media.analysing")} />]] as [
                    string,
                    ReactNode,
                  ][])
                : []),
              ...((bitrate ? [[t('media.bitrate'), bitrate]] : []) as [string, ReactNode][]),
            ]}
          />
        </InfoPanel>
      </div>

      <ViewerFooter
        left={t(labelKey)}
        center={
          locked
            ? transportStatus(player, t)
            : `${transportStatus(player, t)} • ${formatDuration(player.time)} / ${formatDuration(player.duration)}`
        }
        right={[getFileExtensionLabel(filename), bitrate].filter(Boolean).join(' • ')}
      />
    </div>
  );
}
