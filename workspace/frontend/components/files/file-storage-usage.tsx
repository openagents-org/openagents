'use client';

import { HardDrive } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import { useFormatters, useT } from '@/lib/i18n';

/** Server totals include private files and recoverable trash, not just this view. */
export function FileStorageUsage() {
  const { fileStorage, files } = useWorkspace();
  const { formatFileSize } = useFormatters();
  const t = useT();
  // Older backends don't supply workspace totals. Label the limited scope
  // rather than presenting the viewer's files as everyone's storage usage.
  const visibleBytes = files.reduce((sum, file) => sum + Math.max(0, file.size || 0), 0);
  // A development-only allowance lets designers preview the meter against
  // older APIs without inventing a production quota or workspace total.
  const configuredPreviewLimit = process.env.NODE_ENV === 'development'
    ? Number(process.env.NEXT_PUBLIC_PREVIEW_FILE_STORAGE_LIMIT_BYTES)
    : 0;
  const previewLimit = Number.isFinite(configuredPreviewLimit) && configuredPreviewLimit > 0
    ? configuredPreviewLimit : null;
  const isPreview = !fileStorage?.limitBytes && previewLimit !== null;
  const limitBytes = fileStorage?.limitBytes || previewLimit;
  const usedBytes = fileStorage?.usedBytes ?? visibleBytes;
  const percent = limitBytes ? usedBytes / limitBytes * 100 : null;
  const percentLabel = percent !== null && percent > 0 && percent < 0.1
    ? '<0.1%' : `${percent?.toFixed(1)}%`;

  return (
    <div className="shrink-0 space-y-2 border-t px-4 py-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium"><HardDrive className="size-3.5 text-muted-foreground" />{t('files.storageTitle')}</span>
        {percent !== null && <span className="tabular-nums text-muted-foreground">{percentLabel}</span>}
      </div>
      {fileStorage || isPreview ? (
        <>
          {percent !== null && (
            <Progress
              // A sliver for any usage at all, so a nearly-empty workspace still
              // shows a bar; assistive tech gets the real figure.
              value={usedBytes > 0 ? Math.max(1, Math.min(100, percent)) : 0}
              aria-label={t('files.storageTitle')}
              aria-valuenow={Math.min(100, percent)}
              aria-valuetext={t('files.storageOf', { used: formatFileSize(usedBytes), limit: formatFileSize(limitBytes!) })}
              className={cn('h-1.5', percent >= 90 && '*:data-[slot=progress-indicator]:bg-warning')}
            />
          )}
          <p className="text-muted-foreground">
            {limitBytes
              ? t('files.storageOf', { used: formatFileSize(usedBytes), limit: formatFileSize(limitBytes!) })
              : t('files.storageUsed', { size: formatFileSize(usedBytes) })}
          </p>
          {percent === null && <p className="text-muted-foreground">{t('files.storageNoLimit')}</p>}
          {fileStorage && fileStorage.trashBytes > 0 && <p className="text-muted-foreground">{t('files.storageTrash', { size: formatFileSize(fileStorage.trashBytes) })}</p>}
        </>
      ) : (
        <p className="text-muted-foreground" title={t('files.storageUnavailable')}>
          {t('files.storageVisible', { size: formatFileSize(visibleBytes) })}
        </p>
      )}
    </div>
  );
}
