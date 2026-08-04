'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import type { TrashEntry } from '@/lib/types';
import { useFormatters, useT, type TranslateFn } from '@/lib/i18n';
import { FileRowIcon, FolderRowIcon, dirname, getFileIcon } from './file-utils';

export function TrashView() {
  const confirm = useConfirm();
  const { trashEntries: entries, refreshTrash, restoreFromTrash, purgeTrash, emptyTrash } =
    useWorkspace();
  const t = useT();
  const { isMobile, openMobileList } = useLayout();
  const { timeAgo, formatFileSize } = useFormatters();

  /** How many files a folder entry brought with it, in words. */
  const describeContents = (entry: TrashEntry): string =>
    entry.kind === 'file'
      ? formatFileSize(entry.size)
      : t('files.fileCount', { count: entry.fileCount });
  /** Rows with a request in flight — their buttons stay put but stop firing. */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [emptying, setEmptying] = useState(false);

  // The count in the folder panel is loaded once at startup; opening the view
  // is the moment it has to be right, and an agent may have deleted since.
  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  const runOn = async (trashId: string, action: () => Promise<void>) => {
    if (busyIds.has(trashId)) return;
    setBusyIds((prev) => new Set(prev).add(trashId));
    try {
      await action();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(trashId);
        return next;
      });
    }
  };

  const handleRestore = (entry: TrashEntry) =>
    runOn(entry.trashId, async () => {
      try {
        const { renamedCount } = await restoreFromTrash([entry.trashId]);
        // A clash doesn't fail the restore — the file comes back beside its
        // replacement under a new name, and saying so is the only way the user
        // finds out which one they're now looking at.
        toast.success(
          renamedCount > 0
            ? t('trash.restoredRenamed', { name: entry.name, count: renamedCount })
            : entry.kind === 'folder'
            ? t('trash.restoredFolder', { name: entry.name, contents: describeContents(entry) })
            : t('trash.restored', { name: entry.name }),
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t('trash.restoreFailed', { name: entry.name }),
        );
      }
    });

  const handleDelete = async (entry: TrashEntry) => {
    const ok = await confirm({
      title: t('trash.deletePermanentlyTitle'),
      description:
        entry.kind === 'folder'
          ? t('trash.deleteFolderDescription', { name: entry.name, contents: describeContents(entry) })
          : t('trash.deleteFileDescription', { name: entry.name }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    await runOn(entry.trashId, async () => {
      try {
        await purgeTrash([entry.trashId]);
        toast.success(t('trash.deleted', { name: entry.name }));
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t('trash.deleteFailed', { name: entry.name }),
        );
      }
    });
  };

  const handleEmpty = async () => {
    const ok = await confirm({
      title: t('trash.emptyTrashTitle'),
      description: t('trash.emptyTrashBody'),
      confirmText: t('trash.emptyTrashConfirm'),
      destructive: true,
    });
    if (!ok) return;
    setEmptying(true);
    try {
      await emptyTrash();
      toast.success(t('trash.emptied'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('trash.emptyFailed'));
    } finally {
      setEmptying(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <DetailHeader
        titleInHeader
        title={
          <div className="flex min-w-0 items-center gap-2">
            {/* Trash is a detail pane, and on mobile the folder panel it belongs
                to is off screen — without this there is no way back to it. */}
            {isMobile && (
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                onClick={openMobileList}
                aria-label={t('files.browseFolders')}
                title={t('files.browseFolders')}
                className="-ml-1 shrink-0 text-muted-foreground"
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            <h2 className="truncate text-sm leading-snug font-semibold">{t('trash.title')}</h2>
            {entries.length > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('folders.itemCount', { count: entries.length })}
              </span>
            )}
          </div>
        }
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={handleEmpty}
              disabled={entries.length === 0 || emptying}
              aria-label={t('trash.emptyTrash')}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('trash.emptyTrash')}</TooltipContent>
        </Tooltip>
      </DetailHeader>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
          <Trash2 className="size-16 opacity-20" />
          <p className="text-sm font-medium">{t('trash.empty')}</p>
          <p className="max-w-md text-xs text-balance">{t('trash.emptyHint')}</p>
        </div>
      ) : (
        /* Same row as the file list: nothing here is a different kind of thing,
           it's the same files with a restore action and no way in. */
        <div className="flex-1 overflow-y-auto p-2">
          {entries.map((entry) => {
            const busy = busyIds.has(entry.trashId);
            // A folder entry has no content type of its own; a file entry is
            // its single file, which is what the leading square is drawn from —
            // an image shows its own pixels here for the same reason it does in
            // the grid, and here it's what you decide the restore on.
            const file = entry.files[0];
            const parent = dirname(entry.path);
            return (
              <div
                key={entry.trashId}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                {entry.kind === 'folder' ? (
                  <FolderRowIcon />
                ) : file ? (
                  <FileRowIcon
                    key={file.id}
                    file={{
                      id: file.id,
                      filename: file.filename,
                      contentType: file.contentType,
                      size: file.size,
                    }}
                  />
                ) : (
                  // A file entry always carries its file; this is the one case
                  // it can't — a bare `.keep`, which the listing counts as no
                  // files at all.
                  <span className="flex size-7 shrink-0 items-center justify-center">
                    {getFileIcon(undefined, entry.name)}
                  </span>
                )}

                <span
                  className="flex-1 truncate text-sm font-medium"
                  title={entry.path}
                >
                  {entry.name}
                  {parent && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {t('trash.inFolder', { parent })}
                    </span>
                  )}
                </span>

                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {describeContents(entry)}
                </span>
                <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground lg:inline">
                  {/* Deleted before the trash recorded timestamps — the row is
                      still restorable, it just can't say when it got here. */}
                  {entry.deletedAt
                    ? t('trash.deletedAt', { time: timeAgo(entry.deletedAt) })
                    : t('trash.deletedEarlier')}
                </span>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        mode="icon"
                        size="sm"
                        onClick={() => handleRestore(entry)}
                        disabled={busy}
                        aria-label={t('trash.restoreItem', { name: entry.name })}
                        className="size-6 text-muted-foreground"
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('trash.restore')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        mode="icon"
                        size="sm"
                        onClick={() => handleDelete(entry)}
                        disabled={busy}
                        aria-label={t('trash.deleteItemPermanently', { name: entry.name })}
                        className="size-6 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('trash.deletePermanently')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
