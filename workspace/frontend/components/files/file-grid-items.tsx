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

/** A file in list view — one dense row with the whole name and its metadata. */
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
        'group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
        selected ? 'bg-primary/10 ring-1 ring-primary/30 ring-inset' : 'hover:bg-muted',
      )}
    >
      <FileRowIcon file={file} />
      <span className="flex-1 truncate text-sm font-medium" title={projectDisplayName(file.filename, file.contentType)}>
        {name}
        {/* Where it lives, only where that isn't already the answer:
            in a folder listing every row shares the same folder. */}
        {!inFolder && folder && (
          <span className="ms-1.5 text-xs font-normal text-muted-foreground">in {folder}</span>
        )}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{formatFileSize(file.size)}</span>
      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground lg:inline">
        {file.createdAt ? timeAgo(file.createdAt) : ''}
      </span>
      {(file.owner || file.visibility) && (
        <>
          <ArtifactOwner owner={file.owner} ownerLabel={file.ownerLabel} compact className="hidden sm:inline-flex" />
          <ArtifactVisibilityBadge
            kind="file"
            visibility={file.visibility}
            effectiveVisibility={file.effectiveVisibility}
            className="hidden md:inline-flex"
          />
        </>
      )}
      <FileAccessMenu
        file={file}
        displayName={name}
        onShare={onShare}
        onVisibility={onVisibility}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={t('files.deleteItem', { name: displayName })}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** A subfolder in grid view, in the same slot a file tile takes. */
export function FolderGridTile({ folder, onOpen }: { folder: FolderEntry; onOpen: () => void }) {
  const t = useT();
  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer flex-col items-center gap-1.5 rounded-xl p-3 text-center transition-colors hover:bg-muted"
    >
      <div className="flex h-19 items-center justify-center">
        <FolderTile className="group-hover:-translate-y-0.5" />
      </div>
      <span className="w-full truncate text-xs leading-tight font-medium" title={folder.path}>
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
        'group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl p-3 text-center transition-colors',
        selected ? 'bg-primary/10 ring-2 ring-primary/30' : 'hover:bg-muted',
      )}
    >
      {/* An image shows itself; everything else shows its type tile. Both
          occupy this same 76px slot, so thumbnails loading in never move the
          grid around them. */}
      <div className="flex h-19 items-center justify-center">
        <FileTile file={file} className="group-hover:-translate-y-0.5" />
      </div>

      {/* In a folder listing every file sits directly in the folder above, so
          the name is all there is to say. The recent list spans folders, so
          the metadata line carries the one each file came from. */}
      <span className="w-full truncate text-xs leading-tight font-medium" title={projectDisplayName(file.filename, file.contentType)}>
        {name}
      </span>
      <span className="w-full truncate text-xs leading-tight text-muted-foreground">
        {!inFolder && folder
          ? folder
          : `${formatFileSize(file.size)}${file.createdAt ? ` · ${timeAgo(file.createdAt)}` : ''}`}
      </span>

      {(file.owner || file.visibility) && (
        <span className="flex w-full items-center justify-center gap-1">
          <ArtifactOwner owner={file.owner} ownerLabel={file.ownerLabel} compact size={14} />
          <ArtifactVisibilityBadge kind="file" visibility={file.visibility} effectiveVisibility={file.effectiveVisibility} />
        </span>
      )}

      <FileAccessMenu
        file={file}
        displayName={name}
        onShare={onShare}
        onVisibility={onVisibility}
        className="absolute top-1.5 left-1.5 bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={t('files.deleteItem', { name: displayName })}
        className="absolute top-1.5 right-1.5 bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </div>
  );
}
