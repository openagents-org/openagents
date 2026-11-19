'use client';

import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingUpload } from '@/hooks/use-upload-queue';
import { useFormatters, useT, type TranslateFn } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { FileTypeTile, getFileIcon } from './file-utils';

/* ── Uploads in progress ─────────────────────────────────────────────────────
 * An upload is drawn as the item it's about to become — same tile, same row,
 * same slot in the listing — with a bar across it. Two things follow from
 * that: you can see *what* is uploading (an image shows its own pixels,
 * straight off the disk, before a single byte has reached the server), and
 * when it lands nothing moves. The real file simply takes the space.
 * ─────────────────────────────────────────────────────────────────────────── */

/** The one line of state these have room for. */
function uploadStatusLabel(upload: PendingUpload, t: TranslateFn): string {
  switch (upload.status) {
    case 'queued': return t('files.uploadWaiting');
    case 'error': return t('files.uploadFailedShort');
    // The bytes are up; the list is catching up. Saying 100% and sitting there
    // reads as stuck, and this is a beat, not a stage.
    case 'done': return t('files.uploadFinishing');
    default: return `${Math.round(upload.progress * 100)}%`;
  }
}

function UploadProgress({
  upload,
  className,
}: {
  upload: PendingUpload;
  className?: string;
}) {
  const t = useT();
  const failed = upload.status === 'error';
  // A failed upload keeps its bar full and red rather than showing how far it
  // got: how far is no longer the question. A fresh one shows a sliver, so
  // there's a bar to watch from the first frame.
  const percent = failed || upload.status === 'done'
    ? 100
    : Math.max(3, Math.round(upload.progress * 100));

  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-foreground/10', className)}
      role="progressbar"
      aria-valuenow={Math.round(upload.progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t('files.uploadingItem', { name: upload.name })}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200 ease-out',
          failed ? 'bg-destructive' : 'bg-primary',
          // Queued files haven't been asked for yet — a still bar at 3% would
          // claim otherwise.
          upload.status === 'queued' && 'animate-pulse',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Retry / cancel — retry only exists once there's something to retry. */
function UploadActions({
  upload,
  onRetry,
  onCancel,
  className,
}: {
  upload: PendingUpload;
  onRetry: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const t = useT();
  const failed = upload.status === 'error';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5 transition-opacity',
        // A failure is waiting on an answer, so its buttons stay put; a healthy
        // upload's cancel is there when you go looking for it.
        failed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        className,
      )}
    >
      {failed && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRetry}
          aria-label={t('files.retryUploadItem', { name: upload.name })}
          className="bg-background/80 text-muted-foreground shadow-sm"
        >
          <RotateCcw />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onCancel}
        aria-label={failed ? t('files.dismissItem', { name: upload.name }) : t('files.cancelUploadItem', { name: upload.name })}
        className="bg-background/80 text-muted-foreground shadow-sm hover:text-destructive"
      >
        <X />
      </Button>
    </div>
  );
}

export function UploadTile({
  upload,
  onRetry,
  onCancel,
}: {
  upload: PendingUpload;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { formatFileSize } = useFormatters();
  const failed = upload.status === 'error';

  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border p-3">
      <div className="relative flex aspect-16/10 w-full items-center justify-center rounded-lg bg-muted/40">
        {upload.previewUrl ? (
          <span className="block size-full overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={upload.previewUrl}
              alt=""
              className={cn('size-full object-contain', !failed && 'opacity-75')}
            />
          </span>
        ) : (
          <FileTypeTile
            contentType={upload.contentType}
            filename={upload.name}
            className={cn(!failed && 'opacity-75')}
          />
        )}

        {/* Across the file itself, not the row it sits in: the progress belongs
            to this file, and a tile of pictures needs the two tied together. */}
        <div className="absolute inset-x-1.5 bottom-1.5">
          <UploadProgress upload={upload} />
        </div>
      </div>

      <span className="line-clamp-2 min-h-10 w-full text-sm leading-5 font-medium wrap-anywhere" title={upload.name}>
        {upload.name}
      </span>
      <span
        className={cn(
          'w-full truncate text-xs leading-tight',
          failed ? 'text-destructive' : 'text-muted-foreground',
        )}
        title={failed ? upload.error : undefined}
      >
        {failed
          ? upload.error ?? t('files.uploadFailed')
          : `${formatFileSize(upload.size)} · ${uploadStatusLabel(upload, t)}`}
      </span>

      <UploadActions
        upload={upload}
        onRetry={onRetry}
        onCancel={onCancel}
        className="absolute top-1.5 right-1.5"
      />
    </div>
  );
}

export function UploadRow({
  upload,
  onRetry,
  onCancel,
}: {
  upload: PendingUpload;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { formatFileSize } = useFormatters();
  const failed = upload.status === 'error';

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2">
      {upload.previewUrl ? (
        <span className="block size-7 shrink-0 overflow-hidden rounded-md border border-border/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={upload.previewUrl} alt="" className="size-full object-cover" />
        </span>
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center">
          {getFileIcon(upload.contentType, upload.name)}
        </span>
      )}

      {/* The bar sits under the name, in the space the row already gives it —
          it's this file's progress, so it stays this file's width. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-sm font-medium" title={upload.name}>
          {upload.name}
        </span>
        <UploadProgress upload={upload} className="max-w-72" />
      </div>

      <span
        className={cn(
          'max-w-40 shrink-0 truncate text-xs tabular-nums',
          failed ? 'text-destructive' : 'text-muted-foreground',
        )}
        title={failed ? upload.error : undefined}
      >
        {failed ? upload.error ?? t('files.uploadFailed') : uploadStatusLabel(upload, t)}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {formatFileSize(upload.size)}
      </span>

      <UploadActions upload={upload} onRetry={onRetry} onCancel={onCancel} />
    </div>
  );
}
