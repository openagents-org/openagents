'use client';

import { useSyncExternalStore } from 'react';
import { Folder, RotateCcw, Trash2 } from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { formatSize, getFileIcon } from './file-utils';

/**
 * A soft-deleted file or folder.
 *
 * `deletedLabel` is a pre-rendered string rather than a timestamp: these rows
 * are mock data for now, and deriving "2 days ago" from Date.now() at render
 * time makes the server and client markup disagree.
 */
export interface TrashEntry {
  id: string;
  name: string;
  /** Folder rows have no size or content type and restore their whole subtree. */
  type: 'file' | 'folder';
  contentType?: string;
  size?: number;
  /** Where it lived, so a name on its own isn't ambiguous. */
  path: string;
  deletedLabel: string;
  createdLabel: string;
  /** Folders only — how much comes back with a restore. */
  itemCount?: number;
}

// Mock until the backend grows a trash endpoint (soft-deleted rows already
// exist — `FileRecord.status = 'deleted'` — they're just not queryable yet).
const MOCK_TRASH: TrashEntry[] = [
  { id: 't1', name: 'Climate Report.pdf', type: 'file', contentType: 'application/pdf', size: 2_411_000, path: 'uploaded_files', deletedLabel: '2 days ago', createdLabel: 'Mar 28, 2025' },
  { id: 't2', name: 'Meeting Notes.txt', type: 'file', contentType: 'text/plain', size: 14_200, path: 'uploaded_files', deletedLabel: '2 days ago', createdLabel: 'Mar 28, 2025' },
  { id: 't3', name: 'Project Plan.docx', type: 'file', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 88_400, path: 'uploaded_files', deletedLabel: '2 days ago', createdLabel: 'Mar 28, 2025' },
  { id: 't4', name: 'Budget 2025.xlsx', type: 'file', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 132_900, path: 'reports', deletedLabel: '2 days ago', createdLabel: 'Mar 28, 2025' },
  { id: 't5', name: 'archive-2024', type: 'folder', path: '', deletedLabel: '2 days ago', createdLabel: 'Mar 28, 2025', itemCount: 12 },
  { id: 't6', name: 'README.md', type: 'file', contentType: 'text/markdown', size: 6_100, path: 'docs', deletedLabel: '2 days ago', createdLabel: 'Mar 28, 2025' },
  { id: 't7', name: 'Data Export.csv', type: 'file', contentType: 'text/csv', size: 402_800, path: 'reports', deletedLabel: '2 days ago', createdLabel: 'Mar 28, 2025' },
  { id: 't8', name: 'Study Card', type: 'file', contentType: 'application/octet-stream', size: 21_500, path: 'uploaded_files', deletedLabel: '3 days ago', createdLabel: 'Mar 28, 2025' },
  { id: 't9', name: 'Analysis Output', type: 'file', contentType: 'application/octet-stream', size: 55_300, path: 'uploaded_files', deletedLabel: '3 days ago', createdLabel: 'Mar 28, 2025' },
];

/**
 * Module-level store so the folder panel's count and this list stay in step —
 * with the state inside the view, emptying the trash left the sidebar still
 * claiming nine items. Swap the two accessors for the real endpoint when the
 * backend grows one; nothing else has to change.
 */
let trashEntries: TrashEntry[] = MOCK_TRASH;
const trashListeners = new Set<() => void>();

function setTrashEntries(next: TrashEntry[]) {
  trashEntries = next;
  trashListeners.forEach((listener) => listener());
}

function subscribeToTrash(listener: () => void) {
  trashListeners.add(listener);
  return () => trashListeners.delete(listener);
}

function useTrashEntries(): TrashEntry[] {
  return useSyncExternalStore(
    subscribeToTrash,
    () => trashEntries,
    () => trashEntries,
  );
}

/** Item count for the folder panel's Trash row. */
export function useTrashCount(): number {
  return useTrashEntries().length;
}

export function TrashView() {
  const confirm = useConfirm();
  const entries = useTrashEntries();

  const handleRestore = (entry: TrashEntry) => {
    setTrashEntries(entries.filter((e) => e.id !== entry.id));
    toast.success(
      entry.type === 'folder'
        ? `Restored "${entry.name}" and its ${entry.itemCount} items`
        : `Restored "${entry.name}"`,
    );
  };

  const handleDelete = async (entry: TrashEntry) => {
    const ok = await confirm({
      title: 'Delete permanently?',
      description:
        entry.type === 'folder'
          ? `"${entry.name}" and its ${entry.itemCount} items will be gone for good. This can't be undone.`
          : `"${entry.name}" will be gone for good. This can't be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setTrashEntries(entries.filter((e) => e.id !== entry.id));
    toast.success(`Deleted "${entry.name}"`);
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
    setTrashEntries([]);
    toast.success('Trash emptied');
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
              disabled={entries.length === 0}
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <Trash2 className="size-16 opacity-20" />
          <p className="text-sm font-medium">Trash is empty</p>
          <p className="max-w-xs text-xs">
            Deleted files and folders land here first, so you can put them back.
          </p>
        </div>
      ) : (
        /* Same row as the file list: nothing here is a different kind of thing,
           it's the same files with a restore action and no way in. */
        <div className="flex-1 overflow-y-auto p-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            >
              {entry.type === 'folder' ? (
                <Folder className="size-4 shrink-0 text-amber-500" />
              ) : (
                getFileIcon(entry.contentType, entry.name)
              )}

              <span className="flex-1 truncate text-sm font-medium" title={entry.path ? `${entry.path}/${entry.name}` : entry.name}>
                {entry.name}
              </span>

              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                {entry.type === 'folder'
                  ? `${entry.itemCount} items`
                  : formatSize(entry.size ?? 0)}
              </span>
              <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground lg:inline">
                Deleted {entry.deletedLabel}
              </span>

              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      mode="icon"
                      size="sm"
                      onClick={() => handleRestore(entry)}
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
          ))}
        </div>
      )}
    </div>
  );
}
