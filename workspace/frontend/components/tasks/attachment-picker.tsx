'use client';

import { useEffect, useRef, useState } from 'react';
import { FileIcon, Film, Paperclip, RotateCw, X } from 'lucide-react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { AuthenticatedImage } from '@/components/files/authenticated-image';
import { MAX_UPLOAD_BYTES, useFileUploads, type UploadItem } from '@/components/files/use-file-uploads';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WorkspaceFile } from '@/lib/types';

const ATTACH_ACCEPT =
  'image/*,video/*,.pdf,.txt,.md,.json,.csv,.xlsx,.xls,.doc,.docx,.ppt,.pptx,.xml,.html,.css,.js,.ts,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml,.zip';

function RemoveAction({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <WithTooltip label={label}><AttachmentAction disabled={disabled} onClick={onClick} aria-label={label}>
          <X />
        </AttachmentAction></WithTooltip>
  );
}

function PendingCard({ item, onRemove, onRetry }: { item: UploadItem; onRemove: () => void; onRetry: () => void }) {
  const t = useT();
  const failed = item.status === 'failed';
  const percent = item.progress === null ? null : Math.round(item.progress * 100);
  return (
    <Attachment size="sm" state={failed ? 'error' : 'uploading'} className="max-w-60">
      <AttachmentMedia variant={item.preview ? 'image' : 'icon'}>
        {item.preview ? <img src={item.preview} alt={item.file.name} /> : item.file.type.startsWith('video/') ? <Film /> : <FileIcon />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{item.file.name}</AttachmentTitle>
        {failed ? (
          <AttachmentDescription role="alert">
            {t(item.error === 'tooLarge' ? 'tasks.attachTooLarge' : 'tasks.attachFailed', { size: MAX_UPLOAD_BYTES / (1024 * 1024) })}
          </AttachmentDescription>
        ) : (
          <>
            <AttachmentDescription className="tabular-nums">{percent === null ? t('tasks.attachUploading') : `${percent}%`}</AttachmentDescription>
            <Progress value={percent} aria-label={item.file.name} className="mt-1" />
          </>
        )}
      </AttachmentContent>
      <AttachmentActions>
        {failed && item.error !== 'tooLarge' && (
          <WithTooltip label={t('common.retry')}><AttachmentAction onClick={onRetry} aria-label={t('common.retry')}>
                <RotateCw />
              </AttachmentAction></WithTooltip>
        )}
        <RemoveAction label={t(failed ? 'common.remove' : 'tasks.attachCancel', { name: item.file.name })} onClick={onRemove} />
      </AttachmentActions>
    </Attachment>
  );
}

/**
 * Attach workspace files (screenshots, logs, docs, videos). Each file uploads
 * on pick (so the ids exist when the form is saved) with its own progress,
 * cancel and retry; more files can be added while others are still going up.
 * `compact` drops the label and size hint and shows a small button, for the
 * issue comment composer. It accepts the same files as the full picker.
 */
export function AttachmentPicker({
  value,
  onChange,
  disabled = false,
  onUploadingChange,
  compact = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
  compact?: boolean;
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
  const onUploadingChangeRef = useRef(onUploadingChange);
  onUploadingChangeRef.current = onUploadingChange;
  useEffect(() => {
    if (uploadingRef.current === uploads.uploading) return;
    uploadingRef.current = uploads.uploading;
    onUploadingChangeRef.current?.(uploads.uploading);
  }, [uploads.uploading]);
  // Unmounting aborts in-flight uploads; tell the parent they are over, or a
  // reopened form would stay blocked on an upload that no longer exists.
  useEffect(() => () => {
    if (uploadingRef.current) onUploadingChangeRef.current?.(false);
  }, []);

  const resolve = (id: string): WorkspaceFile | undefined =>
    uploaded.find((f) => f.id === id) ?? files.find((f) => f.id === id);

  const addFiles = (list: FileList | File[]) => {
    if (disabled) return;
    uploads.add(Array.from(list));
  };

  const remove = (id: string) => onChange(value.filter((x) => x !== id));

  return (
    <div
      className={cn('flex flex-col gap-1.5 rounded-md transition-colors', dragging && !disabled && 'bg-primary/5 outline-2 outline-offset-4 outline-primary/50')}
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
      {!compact && (
        <div className="flex items-center gap-1.5 text-sm leading-snug font-medium">
          <Paperclip className="size-3.5 text-muted-foreground" />
          {t('tasks.fieldAttachments')}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </div>
      )}

      {(value.length > 0 || uploads.items.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {value.map((id) => {
            const f = resolve(id);
            const isImage = f?.contentType.startsWith('image/');
            return (
              <Attachment key={id} size="sm" className="max-w-60">
                <AttachmentMedia variant={isImage && f ? 'image' : 'icon'}>
                  {isImage && f
                    ? <AuthenticatedImage fileId={f.id} alt={f.filename} />
                    : f?.contentType.startsWith('video/') ? <Film /> : <FileIcon />}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{f?.filename ?? t('tasks.attachedFile')}</AttachmentTitle>
                </AttachmentContent>
                <AttachmentActions>
                  <RemoveAction label={t('common.remove')} disabled={disabled} onClick={() => remove(id)} />
                </AttachmentActions>
              </Attachment>
            );
          })}
          {uploads.items.map((item) => (
            <PendingCard key={item.key} item={item} onRemove={() => uploads.remove(item.key)} onRetry={() => uploads.retry(item.key)} />
          ))}
        </div>
      )}

      <Button
        type="button"
        variant={compact ? 'ghost' : 'outline'}
        size={compact ? 'xs' : 'sm'}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={compact ? 'self-start text-muted-foreground' : 'w-full border-dashed text-muted-foreground'}
      >
        <Paperclip data-icon="inline-start" />
        {t(dragging && !disabled ? 'tasks.attachDrop' : compact ? 'issues.attachFiles' : 'tasks.attachAdd')}
      </Button>
      <input
        disabled={disabled}
        aria-label={t(compact ? 'issues.attachFiles' : 'tasks.fieldAttachments')}
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {!compact && <p className="text-xs text-muted-foreground/70">{t('tasks.attachLimit', { size: MAX_UPLOAD_BYTES / (1024 * 1024) })}</p>}
    </div>
  );
}
