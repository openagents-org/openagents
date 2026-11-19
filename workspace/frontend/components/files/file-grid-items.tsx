'use client';

import { ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Item } from '@/components/ui/item';
import { TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArtifactOwner, ArtifactVisibilityBadge } from '@/components/sharing/artifact-access-badge';
import { useFormatters, useT } from '@/lib/i18n';
import type { ArtifactVisibility, WorkspaceFile } from '@/lib/types';
import { cn } from '@/lib/utils';
import { destructiveIconClass } from '@/lib/destructive-icon';
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

/** The keyboard target in a row or tile. The row itself takes the pointer, so
 *  this stops propagation and an open fires once. */
const NAME_BUTTON = 'rounded-sm text-start font-medium wrap-anywhere outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/* ── List view ───────────────────────────────────────────────────────────────
 * A Table whose columns follow the file pane's width (container queries),
 * including when the folder panel is open. Name is always shown; size from
 * @lg, date added from @2xl. */

export function FileListHeading() {
  const t = useT();
  return (
    <TableHeader className="sticky top-0 z-10 bg-background">
      <TableRow className="hover:bg-transparent">
        <TableHead className="ps-3 text-xs text-muted-foreground">{t('files.sortName')}</TableHead>
        <TableHead className="hidden w-16 text-right text-xs text-muted-foreground @lg:table-cell">{t('files.sortSize')}</TableHead>
        <TableHead className="hidden w-24 text-right text-xs text-muted-foreground @2xl:table-cell">{t('files.dateAdded')}</TableHead>
        <TableHead className="w-14 pe-3"><span className="sr-only">{t('files.fileActions')}</span></TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** A subfolder in list view. */
export function FolderListRow({ folder, onOpen }: { folder: FolderEntry; onOpen: () => void }) {
  const t = useT();
  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      {/* max-w-0 + w-full lets the name wrap inside the column instead of
          pushing the number columns out of the pane. */}
      <TableCell className="w-full max-w-0 py-2.5 ps-3 whitespace-normal">
        <div className="flex min-w-0 items-center gap-3">
          <FolderRowIcon />
          <div className="flex min-w-0 flex-col gap-0.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className={cn(NAME_BUTTON, 'truncate text-sm')}
            >
              <span title={folder.path}>{folder.name}</span>
            </button>
            <span className="truncate text-xs text-muted-foreground">{describeFolder(folder, t)}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden @lg:table-cell" />
      <TableCell className="hidden @2xl:table-cell" />
      <TableCell className="pe-3 text-right">
        <ChevronRight className="ms-auto size-4 text-muted-foreground/60" />
      </TableCell>
    </TableRow>
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
    <TableRow data-state={selected ? 'selected' : undefined} className="cursor-pointer" onClick={onOpen}>
      <TableCell className="w-full max-w-0 py-3 ps-3 whitespace-normal">
        <div className="flex min-w-0 items-center gap-3">
          <FileRowIcon file={file} />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              aria-current={selected || undefined}
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className={cn(NAME_BUTTON, 'line-clamp-2 text-sm leading-5')}
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
      </TableCell>
      <TableCell className="hidden text-right text-xs text-muted-foreground tabular-nums @lg:table-cell">{formatFileSize(file.size)}</TableCell>
      <TableCell className="hidden text-right text-xs text-muted-foreground @2xl:table-cell">
        {file.createdAt ? timeAgo(file.createdAt) : '—'}
      </TableCell>
      <TableCell className="pe-3">
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
            className={destructiveIconClass}
            onClick={onDelete}
            aria-label={t('files.deleteItem', { name: displayName })}
          >
            <Trash2 />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ── Grid view ───────────────────────────────────────────────────────────── */

/** A subfolder in grid view, in the same slot a file tile takes. */
export function FolderGridTile({ folder, onOpen }: { folder: FolderEntry; onOpen: () => void }) {
  const t = useT();
  return (
    <Item
      variant="outline"
      asChild
      className="group flex-col flex-nowrap items-stretch gap-2 rounded-xl p-3 text-start hover:bg-muted/50"
    >
      <button type="button" onClick={onOpen}>
        <div className="flex aspect-16/10 w-full items-center justify-center rounded-lg bg-muted/40">
          <FolderTile className="group-hover:-translate-y-0.5" />
        </div>
        <span className="line-clamp-2 min-h-10 w-full text-sm leading-5 font-medium wrap-anywhere" title={folder.path}>
          {folder.name}
        </span>
        <span className="w-full truncate text-xs leading-tight text-muted-foreground">{describeFolder(folder, t)}</span>
      </button>
    </Item>
  );
}

/** Tile actions: always shown on narrow panes and touch screens; on a wide
 *  pane with a mouse they come in on hover, focus, or while their menu is open. */
const TILE_REVEAL = 'absolute top-1.5 opacity-100 shadow-sm transition-opacity @lg:opacity-0 @lg:group-hover:opacity-100 @lg:group-focus-within:opacity-100 @lg:data-[state=open]:opacity-100 pointer-coarse:opacity-100';
// Tile actions sit on top of a thumbnail, so they keep an opaque backdrop;
// the delete one keeps it on hover too, so only its icon turns red.
const TILE_ACTION = `${TILE_REVEAL} bg-background/80 text-muted-foreground`;

/** A file in grid view: its thumbnail or type tile, name, and hover actions. */
export function FileGridTile({
  file, displayName, selected, inFolder, onOpen, onShare, onVisibility, onDelete,
}: FileItemProps) {
  const t = useT();
  const { timeAgo, formatFileSize } = useFormatters();
  const name = projectDisplayName(displayName, file.contentType);
  const folder = dirname(file.filename);
  return (
    // The whole tile is a pointer target; the name button is the keyboard one.
    // Not a button itself: it holds the share menu and delete buttons.
    <div
      onClick={onOpen}
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 rounded-xl border p-3 transition-colors',
        selected ? 'bg-muted ring-1 ring-ring' : 'hover:bg-muted/50',
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
        aria-current={selected || undefined}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className={cn(NAME_BUTTON, 'line-clamp-2 min-h-10 w-full text-sm leading-5')}
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
        className={cn(TILE_ACTION, 'left-1.5')}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={t('files.deleteItem', { name: displayName })}
        className={cn(TILE_ACTION, 'right-1.5', destructiveIconClass, 'hover:bg-background/80 dark:hover:bg-background/80')}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
