'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { toast } from 'sonner';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import type { TrashEntry } from '@/lib/types';
import { useFormatters, useT, type TranslateFn } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { destructiveIconClass } from '@/lib/destructive-icon';
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
                size="icon-sm"
                onClick={openMobileList}
                aria-label={t('files.browseFolders')}
                className="-ms-1 shrink-0 text-muted-foreground"
              >
                <ArrowLeft />
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
        <WithTooltip label={t('trash.emptyTrash')}><Button
              variant="ghost"
              size="icon-sm"
              onClick={handleEmpty}
              disabled={entries.length === 0 || emptying}
              aria-label={t('trash.emptyTrash')}
              className={cn('shrink-0', destructiveIconClass)}
            >
              <Trash2 />
            </Button></WithTooltip>
      </DetailHeader>

      {entries.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trash2 />
            </EmptyMedia>
            <EmptyTitle>{t('trash.empty')}</EmptyTitle>
            <EmptyDescription className="text-balance">{t('trash.emptyHint')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        /* Same row as the file list: nothing here is a different kind of thing,
           it's the same files with a restore action and no way in. */
        <div className="flex-1 overflow-y-auto p-2">
          {/* Rows sit flush like a file list: drop ItemGroup's has-[size] gap. */}
          <ItemGroup className="has-data-[size=sm]:gap-0">
          {entries.map((entry) => {
            const busy = busyIds.has(entry.trashId);
            // A folder entry has no content type of its own; a file entry is
            // its single file, which is what the leading square is drawn from —
            // an image shows its own pixels here for the same reason it does in
            // the grid, and here it's what you decide the restore on.
            const file = entry.files[0];
            const parent = dirname(entry.path);
            return (
              <Item key={entry.trashId} size="sm" role="listitem" className="flex-nowrap py-2">
                <ItemMedia>
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
                </ItemMedia>

                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full" title={entry.path}>
                    <span className="min-w-0 truncate">
                      {entry.name}
                      {parent && (
                        <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                          {t('trash.inFolder', { parent })}
                        </span>
                      )}
                    </span>
                  </ItemTitle>
                </ItemContent>

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

                {/* Always shown: restore is the reason to be here, and touch
                    screens have no hover to reveal it with. */}
                <ItemActions className="gap-0.5">
                  <WithTooltip label={t('trash.restore')}><Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleRestore(entry)}
                        disabled={busy}
                        aria-label={t('trash.restoreItem', { name: entry.name })}
                        className="text-muted-foreground"
                      >
                        <RotateCcw />
                      </Button></WithTooltip>
                  <WithTooltip label={t('trash.deletePermanently')}><Button
                        variant="ghost"
                        size="icon-xs"
                        className={destructiveIconClass}
                        onClick={() => handleDelete(entry)}
                        disabled={busy}
                        aria-label={t('trash.deleteItemPermanently', { name: entry.name })}
                      >
                        <Trash2 />
                      </Button></WithTooltip>
                </ItemActions>
              </Item>
            );
          })}
          </ItemGroup>
        </div>
      )}
    </div>
  );
}
