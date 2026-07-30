'use client';

import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useWorkspace } from '@/lib/workspace-context';
import type { TrashEntry } from '@/lib/types';
import { FileRowIcon, FolderRowIcon, dirname, formatSize, getFileIcon, timeAgo } from './file-utils';

/** How many files a folder entry brought with it, in words. */
function describeContents(entry: TrashEntry): string {
  if (entry.kind === 'file') return formatSize(entry.size);
  return `${entry.fileCount} ${entry.fileCount === 1 ? 'file' : 'files'}`;
}

export function TrashView() {
  const confirm = useConfirm();
  const { trashEntries: entries, refreshTrash, restoreFromTrash, purgeTrash, emptyTrash } =
    useWorkspace();
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
            ? `Restored "${entry.name}" — ${renamedCount} renamed around a name already taken`
            : entry.kind === 'folder'
            ? `Restored "${entry.name}" and its ${describeContents(entry)}`
            : `Restored "${entry.name}"`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not restore "${entry.name}"`);
      }
    });

  const handleDelete = async (entry: TrashEntry) => {
    const ok = await confirm({
      title: 'Delete permanently?',
      description:
        entry.kind === 'folder'
          ? `"${entry.name}" and its ${describeContents(entry)} will be gone for good. This can't be undone.`
          : `"${entry.name}" will be gone for good. This can't be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await runOn(entry.trashId, async () => {
      try {
        await purgeTrash([entry.trashId]);
        toast.success(`Deleted "${entry.name}"`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Could not delete "${entry.name}"`);
      }
    });
  };

  const handleEmpty = async () => {
    const ok = await confirm({
      title: 'Empty Trash?',
      description:
        'This action cannot be undone. All items in the trash will be permanently deleted.',
      confirmText: 'Empty Trash',
      destructive: true,
    });
    if (!ok) return;
    setEmptying(true);
    try {
      await emptyTrash();
      toast.success('Trash emptied');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not empty the trash');
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
            <h2 className="truncate text-sm leading-snug font-semibold">Trash</h2>
            {entries.length > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {entries.length} {entries.length === 1 ? 'item' : 'items'}
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
              aria-label="Empty trash"
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Empty trash</TooltipContent>
        </Tooltip>
      </DetailHeader>

      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
          <Trash2 className="size-16 opacity-20" />
          <p className="text-sm font-medium">Trash is empty</p>
          <p className="max-w-md text-xs text-balance">
            Deleted files and folders land here first, so you can put them back.
          </p>
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
                      in {parent}
                    </span>
                  )}
                </span>

                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {describeContents(entry)}
                </span>
                <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground lg:inline">
                  {/* Deleted before the trash recorded timestamps — the row is
                      still restorable, it just can't say when it got here. */}
                  {entry.deletedAt ? `Deleted ${timeAgo(entry.deletedAt)}` : 'Deleted earlier'}
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
                        aria-label={`Restore ${entry.name}`}
                        className="size-6 text-muted-foreground"
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Restore</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        mode="icon"
                        size="sm"
                        onClick={() => handleDelete(entry)}
                        disabled={busy}
                        aria-label={`Delete ${entry.name} permanently`}
                        className="size-6 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete permanently</TooltipContent>
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
