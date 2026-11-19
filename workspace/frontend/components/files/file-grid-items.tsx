'use client';

import { ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArtifactOwner, ArtifactVisibilityBadge } from '@/components/sharing/artifact-access-badge';
import { useFormatters, useT } from '@/lib/i18n';
import type { ArtifactVisibility, WorkspaceFile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { projectDisplayName } from '@/lib/web-projects';
import { FileAccessMenu } from './file-access-menu';
import { FileRowIcon, FileTile, FolderRowIcon, FolderTile, describeFolder, dirname, type FolderEntry } from './file-utils';

/** What a file row or tile can do — the same in both views. */
export interface FileItemProps {
  file: WorkspaceFile;
  /** The name relative to the listing it sits in. */
  displayName: string;
  selected: boolean;
  /** A folder is on screen, so every file here shares it and needn't say so. */
  inFolder: boolean;
  onOpen: () => void;
  onShare: () => void;
  onVisibility: (visibility: ArtifactVisibility | null) => void;
  onDelete: (e: React.MouseEvent) => void;
}

/** A subfolder in list view. */
export function FolderListRow({ folder, onOpen }: { folder: FolderEntry; onOpen: () => void }) {
  const t = useT();
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted"
    >
      <FolderRowIcon />
      <span className="flex-1 truncate text-sm font-medium" title={folder.path}>
        {folder.name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{describeFolder(folder, t)}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </div>
  );
}

// Container queries follow the file pane's width, including when the folder
// panel is open. Keep the header and file rows on the same column tracks.
const LIST_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-3 @lg:grid-cols-[minmax(0,1fr)_4rem_3.5rem] @2xl:grid-cols-[minmax(0,1fr)_4rem_6rem_3.5rem]';

export function FileListHeading() {
  const t = useT();
  return (
    <div className={cn(LIST_COLUMNS, 'sticky top-0 z-10 border-b bg-background px-3 py-2 text-xs font-medium text-muted-foreground')}>
      <span>{t('files.sortName')}</span>
      <span className="hidden text-right @lg:block">{t('files.sortSize')}</span>
      <span className="hidden text-right @2xl:block">{t('files.dateAdded')}</span>
      <span className="sr-only">{t('files.fileActions')}</span>
    </div>
  );
}

/** Filename and access stay together; size and date get aligned columns. */
export function FileListRow({
  file, displayName, selected, inFolder, onOpen, onShare, onVisibility, onDelete,
}: FileItemProps) {
  const t = useT();
  const { timeAgo, formatFileSize } = useFormatters();
  const name = projectDisplayName(displayName, file.contentType);
  const folder = dirname(file.filename);
  return (
    <div
      onClick={onOpen}
      className={cn(
        LIST_COLUMNS,
        'group cursor-pointer rounded-lg px-3 py-3 transition-colors',
        selected ? 'bg-primary/10 ring-1 ring-primary/30 ring-inset' : 'hover:bg-muted/60',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileRowIcon file={file} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="line-clamp-2 rounded-sm text-start text-sm leading-5 font-medium wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
            title={projectDisplayName(file.filename, file.contentType)}
          >
            {name}
          </button>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {!inFolder && folder && <span className="max-w-40 truncate" title={folder}>{folder}</span>}
            <span className="@lg:hidden">{formatFileSize(file.size)}</span>
            <ArtifactOwner owner={file.owner} ownerLabel={file.ownerLabel} compact size={14} />
            {(file.owner || file.visibility) && (
              <ArtifactVisibilityBadge kind="file" visibility={file.visibility} effectiveVisibility={file.effectiveVisibility} />
            )}
          </div>
        </div>
      </div>
      <span className="hidden text-right text-xs text-muted-foreground tabular-nums @lg:block">{formatFileSize(file.size)}</span>
      <span className="hidden text-right text-xs text-muted-foreground @2xl:block">
        {file.createdAt ? timeAgo(file.createdAt) : '—'}
      </span>
      <div className="flex items-center justify-end gap-1">
        <FileAccessMenu
          file={file}
          displayName={name}
          onShare={onShare}
          onVisibility={onVisibility}
          className="text-muted-foreground"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          aria-label={t('files.deleteItem', { name: displayName })}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

/** A subfolder in grid view, in the same slot a file tile takes. */
export function FolderGridTile({ folder, onOpen }: { folder: FolderEntry; onOpen: () => void }) {
  const t = useT();
  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer flex-col gap-2 rounded-xl border p-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex aspect-16/10 w-full items-center justify-center rounded-lg bg-muted/40">
        <FolderTile className="group-hover:-translate-y-0.5" />
      </div>
      <span className="line-clamp-2 min-h-10 w-full text-sm leading-5 font-medium wrap-anywhere" title={folder.path}>
        {folder.name}
      </span>
      <span className="w-full truncate text-xs leading-tight text-muted-foreground">{describeFolder(folder, t)}</span>
    </div>
  );
}

/** A file in grid view: its thumbnail or type tile, name, and hover actions. */
export function FileGridTile({
  file, displayName, selected, inFolder, onOpen, onShare, onVisibility, onDelete,
}: FileItemProps) {
  const t = useT();
  const { timeAgo, formatFileSize } = useFormatters();
  const name = projectDisplayName(displayName, file.contentType);
  const folder = dirname(file.filename);
  return (
    <div
      onClick={onOpen}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 rounded-xl border p-3 transition-colors',
        selected ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20' : 'hover:border-foreground/20 hover:bg-muted/30',
      )}
    >
      {/* A full-width preview gives images room without changing the card's
          height when a thumbnail loads or falls back to a file icon. */}
      <div className="flex aspect-16/10 w-full items-center justify-center rounded-lg bg-muted/40">
        <FileTile file={file} preview />
      </div>

      {/* In a folder listing every file sits directly in the folder above, so
          the name is all there is to say. The recent list spans folders, so
          the metadata line carries the one each file came from. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className="line-clamp-2 min-h-10 w-full rounded-sm text-start text-sm leading-5 font-medium wrap-anywhere focus-visible:outline-2 focus-visible:outline-ring"
        title={projectDisplayName(file.filename, file.contentType)}
      >
        {name}
      </button>
      <span className="w-full truncate text-xs leading-tight text-muted-foreground">
        {!inFolder && folder
          ? folder
          : `${formatFileSize(file.size)}${file.createdAt ? ` · ${timeAgo(file.createdAt)}` : ''}`}
      </span>

      {(file.owner || file.visibility) && (
        <span className="flex w-full items-center gap-1.5">
          <ArtifactOwner owner={file.owner} ownerLabel={file.ownerLabel} compact size={14} />
          <ArtifactVisibilityBadge kind="file" visibility={file.visibility} effectiveVisibility={file.effectiveVisibility} />
        </span>
      )}

      <FileAccessMenu
        file={file}
        displayName={name}
        onShare={onShare}
        onVisibility={onVisibility}
        className="absolute top-1.5 left-1.5 bg-background/80 text-muted-foreground opacity-100 shadow-sm transition-opacity @lg:opacity-0 @lg:group-hover:opacity-100 @lg:group-focus-within:opacity-100 data-[state=open]:opacity-100"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={t('files.deleteItem', { name: displayName })}
        className="absolute top-1.5 right-1.5 bg-background/80 text-muted-foreground opacity-100 shadow-sm transition-opacity @lg:opacity-0 @lg:group-hover:opacity-100 @lg:group-focus-within:opacity-100 data-[state=open]:opacity-100 hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </div>
  );
}
