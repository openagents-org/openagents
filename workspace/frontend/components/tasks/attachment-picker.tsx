'use client';

import { useEffect, useRef, useState } from 'react';
import { FileIcon, Film, Paperclip, RotateCw, X } from 'lucide-react';
import { AuthenticatedImage } from '@/components/files/authenticated-image';
import { MAX_UPLOAD_BYTES, useFileUploads, type UploadItem } from '@/components/files/use-file-uploads';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WorkspaceFile } from '@/lib/types';

const ATTACH_ACCEPT =
  'image/*,video/*,.pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml,.zip';
const MEDIA_ACCEPT = 'image/*,video/*';

function PendingCard({ item, onRemove, onRetry }: { item: UploadItem; onRemove: () => void; onRetry: () => void }) {
  const t = useT();
  const failed = item.status === 'failed';
  const percent = item.progress === null ? null : Math.round(item.progress * 100);
  return (
    <div className={cn('group relative overflow-hidden rounded-lg border bg-muted', failed && 'border-rose-300 dark:border-rose-800')}
      title={item.file.name}>
      {item.preview ? (
        <img src={item.preview} alt={item.file.name} className={cn('h-16 w-auto max-w-[140px] object-cover', !failed && 'opacity-60')} />
      ) : (
        <div className="flex h-16 w-24 flex-col items-center justify-center gap-1 px-2">
          {item.file.type.startsWith('video/') ? <Film className="size-4 text-muted-foreground" /> : <FileIcon className="size-4 text-muted-foreground" />}
          <span className="w-full truncate text-center text-[10px] text-muted-foreground">{item.file.name}</span>
        </div>
      )}
      {failed ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-rose-600/90 px-1.5 py-0.5 text-[10px] text-white">
          <span className="truncate" role="alert">
            {t(item.error === 'tooLarge' ? 'tasks.attachTooLarge' : 'tasks.attachFailed', { size: MAX_UPLOAD_BYTES / (1024 * 1024) })}
          </span>
          {item.error !== 'tooLarge' && (
            <button type="button" onClick={onRetry} className="shrink-0 rounded p-0.5 hover:bg-white/20" aria-label={t('common.retry')} title={t('common.retry')}>
              <RotateCw className="size-3" />
            </button>
          )}
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0" role="progressbar" aria-label={item.file.name}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <div className="mx-1 mb-0.5 text-right text-[10px] font-medium tabular-nums text-foreground">
            {percent === null ? t('tasks.attachUploading') : `${percent}%`}
          </div>
          <div className="h-1 bg-black/10">
            <div className={cn('h-full bg-primary transition-[width]', percent === null && 'w-1/3 animate-pulse')}
              style={percent === null ? undefined : { width: `${percent}%` }} />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white"
        aria-label={t(failed ? 'common.remove' : 'tasks.attachCancel', { name: item.file.name })}
        title={t(failed ? 'common.remove' : 'tasks.attachCancel', { name: item.file.name })}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/**
 * Attach workspace files (screenshots, logs, docs, videos). Each file uploads
 * on pick (so the ids exist when the form is saved) with its own progress,
 * cancel and retry; more files can be added while others are still going up.
 * `media` narrows the picker to images and videos for a compact composer.
 */
export function AttachmentPicker({
  value,
  onChange,
  disabled = false,
  onUploadingChange,
  media = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
  media?: boolean;
}) {
  const t = useT();
  const { files } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  // Files uploaded in this session — the workspace `files` list may not have
  // refreshed yet, so keep our own record for names/thumbnails.
  const [uploaded, setUploaded] = useState<WorkspaceFile[]>([]);
  // Uploads finish independently; always extend the latest selection.
  const valueRef = useRef(value);
  valueRef.current = value;
  const uploads = useFileUploads((file) => {
    setUploaded((u) => [...u, file]);
    const next = [...valueRef.current, file.id];
    valueRef.current = next;
    onChange(next);
  });

  const uploadingRef = useRef(false);
  useEffect(() => {
    if (uploadingRef.current === uploads.uploading) return;
    uploadingRef.current = uploads.uploading;
    onUploadingChange?.(uploads.uploading);
  }, [uploads.uploading, onUploadingChange]);

  const resolve = (id: string): WorkspaceFile | undefined =>
    uploaded.find((f) => f.id === id) ?? files.find((f) => f.id === id);

  const addFiles = (list: FileList | File[]) => {
    if (disabled) return;
    uploads.add(Array.from(list).filter((f) => !media || f.type.startsWith('image/') || f.type.startsWith('video/')));
  };

  const remove = (id: string) => onChange(value.filter((x) => x !== id));

  return (
    <div
      className={cn('space-y-1.5 rounded-md transition-colors', dragging && !disabled && 'bg-primary/5 outline outline-2 outline-primary/50 outline-offset-4')}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {!media && (
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Paperclip className="size-3.5" />
          {t('tasks.fieldAttachments')}
          <span className="font-normal text-muted-foreground/60">({t('common.optional')})</span>
        </label>
      )}

      {(value.length > 0 || uploads.items.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {value.map((id) => {
            const f = resolve(id);
            const isImage = f?.contentType.startsWith('image/');
            return (
              <div key={id} className="group relative overflow-hidden rounded-lg border bg-muted">
                {isImage && f ? (
                  <AuthenticatedImage fileId={f.id} alt={f.filename} className="h-16 w-auto max-w-[140px] object-cover" />
                ) : (
                  <div className="flex h-16 w-24 flex-col items-center justify-center gap-1 px-2">
                    {f?.contentType.startsWith('video/') ? <Film className="size-4 text-muted-foreground" /> : <FileIcon className="size-4 text-muted-foreground" />}
                    <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                      {f?.filename ?? t('tasks.attachedFile')}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(id)}
                  className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  title={t('common.remove')}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
          {uploads.items.map((item) => (
            <PendingCard key={item.key} item={item} onRemove={() => uploads.remove(item.key)} onRetry={() => uploads.retry(item.key)} />
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={media
          ? 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50'
          : 'flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input px-3 py-2 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors'}
      >
        <Paperclip className="size-3.5" />
        {t(dragging && !disabled ? 'tasks.attachDrop' : media ? 'issues.attachMedia' : 'tasks.attachAdd')}
      </button>
      <input
        disabled={disabled}
        aria-label={t(media ? 'issues.attachMedia' : 'tasks.fieldAttachments')}
        ref={inputRef}
        type="file"
        multiple
        accept={media ? MEDIA_ACCEPT : ATTACH_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {!media && <p className="text-[11px] text-muted-foreground/70">{t('tasks.attachLimit', { size: MAX_UPLOAD_BYTES / (1024 * 1024) })}</p>}
    </div>
  );
}
