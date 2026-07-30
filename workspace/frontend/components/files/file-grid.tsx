'use client';

import { useRef, useState, useMemo, useCallback } from 'react';
import {
  Search, Upload, FileX, ChevronRight, ArrowLeft, Trash2,
  LayoutGrid, List, ArrowDownWideNarrow, ListFilter, X,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { FileFilterGroup } from './file-utils';
import {
  FILE_FILTER_GROUPS, FileRowIcon, FileTile, formatSize, getFileFilterGroup, timeAgo,
  basename, dirname, getFilesUnderPath,
} from './file-utils';

type SortKey = 'name' | 'recent' | 'size';

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  recent: 'Last modified',
  size: 'Size',
};

/**
 * The detail pane: the files inside whatever the folder panel has selected.
 *
 * Folders live entirely in that panel — this side never draws one. Splitting
 * it that way means a folder is one thing in one place instead of a row on the
 * left and a tile on the right that had to be kept in sync, and it makes the
 * pane's job sayable in one line: these are the files under here.
 */
export function FileGrid() {
  const {
    files, selectedFileId, setSelectedFileId, uploadFile, deleteFile,
    currentFilePath, setCurrentFilePath,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<SortKey>('name');
  const [typeFilter, setTypeFilter] = useState<FileFilterGroup | 'all'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPath = currentFilePath;
  const setCurrentPath = setCurrentFilePath;

  /**
   * Every file under the selected folder — subfolders included, because "All
   * files" means all of them and a folder you've picked means everything it
   * holds. Search widens that to the whole workspace. This is also what the
   * filter menu counts, so a listed type always has something behind it.
   */
  const scopedFiles = useMemo(() => {
    if (search) {
      const q = search.toLowerCase();
      return getFilesUnderPath(files, '')
        .filter((e) => e.file.filename.toLowerCase().includes(q));
    }
    return getFilesUnderPath(files, currentPath);
  }, [files, currentPath, search]);

  const typeCounts = useMemo(() => {
    const counts = new Map<FileFilterGroup, number>();
    for (const entry of scopedFiles) {
      const group = getFileFilterGroup(entry.file.contentType, entry.file.filename);
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    return counts;
  }, [scopedFiles]);

  const activeFilter = typeFilter === 'all'
    ? null
    : FILE_FILTER_GROUPS.find((g) => g.id === typeFilter) ?? null;

  const entries = useMemo(() => {
    const scoped = typeFilter === 'all'
      ? scopedFiles
      : scopedFiles.filter(
          (e) => getFileFilterGroup(e.file.contentType, e.file.filename) === typeFilter,
        );

    return [...scoped].sort((a, b) => {
      if (sort === 'size') return b.file.size - a.file.size;
      if (sort === 'recent') {
        const at = a.file.createdAt ? new Date(a.file.createdAt).getTime() : 0;
        const bt = b.file.createdAt ? new Date(b.file.createdAt).getTime() : 0;
        return bt - at;
      }
      return a.displayName.localeCompare(b.displayName);
    });
  }, [scopedFiles, sort, typeFilter]);

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/');
  }, [currentPath]);

  const navigateToBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      setCurrentPath('');
    } else {
      const segments = currentPath.split('/');
      setCurrentPath(segments.slice(0, index + 1).join('/'));
    }
  }, [currentPath, setCurrentPath]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        if (currentPath) {
          const renamedFile = new File([file], `${currentPath}/${file.name}`, { type: file.type });
          await uploadFile(renamedFile);
        } else {
          await uploadFile(file);
        }
      }
      toast.success(selectedFiles.length === 1 ? `Uploaded ${selectedFiles[0].name}` : `Uploaded ${selectedFiles.length} files`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };


  const handleDelete = async (e: React.MouseEvent, fileId: string, filename: string) => {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete file?',
      description: `"${basename(filename)}" will be permanently deleted.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFile(fileId);
      toast.success(`Deleted ${basename(filename)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // Drop zone handling
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < droppedFiles.length; i++) {
        const file = droppedFiles[i];
        if (currentPath) {
          const renamedFile = new File([file], `${currentPath}/${file.name}`, { type: file.type });
          await uploadFile(renamedFile);
        } else {
          await uploadFile(file);
        }
      }
      toast.success(droppedFiles.length === 1 ? `Uploaded ${droppedFiles[0].name}` : `Uploaded ${droppedFiles.length} files`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={cn('flex flex-col h-full', dragOver && 'ring-2 ring-inset ring-primary/40 bg-primary/5')}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Toolbar — the title says which files these are (search widens past
          the selected folder, so it says so instead of showing a path that no
          longer describes the list), and the count says how many. */}
      <DetailHeader
        titleInHeader
        title={
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground">
            {search ? (
              <span className="shrink-0 px-1.5 py-0.5 font-medium text-foreground">
                Search results
              </span>
            ) : (
              <>
                {/* Up one level — a breadcrumb tells you where you are, but
                    going back shouldn't require hitting a 40px-wide word. */}
                {currentPath && (
                  <button
                    onClick={() => navigateToBreadcrumb(breadcrumbs.length - 2)}
                    className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground"
                    title="Up one level"
                    aria-label="Up one level"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                )}
                <button
                  onClick={() => navigateToBreadcrumb(-1)}
                  className={cn(
                    'shrink-0 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-muted hover:text-foreground',
                    !currentPath && 'text-foreground'
                  )}
                >
                  All files
                </button>
                {breadcrumbs.map((segment, i) => (
                  <span key={i} className="flex items-center gap-0.5 shrink-0">
                    <ChevronRight className="size-3.5 opacity-40" />
                    <button
                      onClick={() => navigateToBreadcrumb(i)}
                      className={cn(
                        'rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground',
                        i === breadcrumbs.length - 1 && 'text-foreground font-medium'
                      )}
                    >
                      {segment}
                    </button>
                  </span>
                ))}
              </>
            )}
            {entries.length > 0 && (
              <Badge variant="secondary" size="sm" className="ml-1.5 shrink-0 rounded-full!">
                {entries.length}
              </Badge>
            )}
          </div>
        }
      >
        {/* Search */}
        <div className="relative w-48 shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            aria-label="Search files"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Type filter — only the kinds actually present, each with its count.
            An empty "Presentations" row is a dead end, not a filter. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Filter by type"
              className={cn('shrink-0 gap-1.5', activeFilter ? 'text-foreground' : 'text-muted-foreground')}
            >
              <ListFilter className="size-4" style={activeFilter ? { color: activeFilter.color } : undefined} />
              <span className="hidden lg:inline">{activeFilter?.label ?? 'All types'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuRadioGroup
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v as FileFilterGroup | 'all')}
            >
              <DropdownMenuRadioItem value="all">
                <span className="flex-1">All types</span>
                <span className="text-xs text-muted-foreground tabular-nums">{scopedFiles.length}</span>
              </DropdownMenuRadioItem>
              {FILE_FILTER_GROUPS.filter((group) => typeCounts.get(group.id)).map((group) => (
                <DropdownMenuRadioItem key={group.id} value={group.id}>
                  <span className="flex-1">{group.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {typeCounts.get(group.id)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground">
              <ArrowDownWideNarrow className="size-4" />
              <span className="hidden lg:inline">{SORT_LABELS[sort]}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {SORT_LABELS[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
              aria-label={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              className="shrink-0 text-muted-foreground"
            >
              {view === 'grid' ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{view === 'grid' ? 'List view' : 'Grid view'}</TooltipContent>
        </Tooltip>

        {/* Upload only — creating folders belongs to the folder panel, which
            owns the tree and can show the new folder in place. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Upload file"
              className="shrink-0 text-muted-foreground"
            >
              <Upload className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {currentPath ? `Upload to ${currentPath}` : 'Upload file'}
          </TooltipContent>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </DetailHeader>

      {/* Grid content */}
      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="flex flex-col items-center gap-3 text-center">
            <FileX className="size-16 opacity-20" />
            <p className="text-sm font-medium">
              {files.length === 0
                ? 'No files yet'
                : activeFilter
                ? `No ${activeFilter.label.toLowerCase()} here`
                : search
                ? 'No matches'
                : 'No files in this folder'}
            </p>
            <p className="max-w-xs text-xs">
              {files.length === 0
                ? 'Upload files or ask an agent to create one. You can also drag & drop them anywhere here.'
                : activeFilter
                ? search
                  ? 'Nothing of this type matches your search.'
                  : 'Nothing of this type in this folder or the ones below it.'
                : search
                ? 'Try a different search term'
                : 'Drag files in, upload them, or pick another folder on the left.'}
            </p>
            {/* The empty state offers this pane's own action, not the folder
                panel's — same boundary as the toolbar above. */}
            {activeFilter ? (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => setTypeFilter('all')}>
                <X className="size-3.5" />
                Clear filter
              </Button>
            ) : !search && (
              <div className="mt-1 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <Upload className="size-3.5" />
                  Upload files
                </Button>
                {currentPath && (
                  <Button variant="ghost" size="sm" onClick={() => navigateToBreadcrumb(breadcrumbs.length - 2)}>
                    <ArrowLeft className="size-3.5" />
                    Back
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : view === 'list' ? (
        /* List view — one row per file, name in full including its subfolder.
           Upload names run long and look alike, so a dense row with the whole
           name and its metadata beats a wall of truncated tiles. */
        <div className="flex-1 overflow-y-auto p-2">
          {entries.map((entry) => {
            const { file, displayName } = entry;
            const isSelected = selectedFileId === file.id;

            return (
              <div
                key={file.id}
                onClick={() => {
                  setSelectedFileId(file.id);
                  if (isMobile) openMobileDetail();
                }}
                className={cn(
                  'group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                  isSelected
                    ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                )}
              >
                <FileRowIcon file={file} />
                <span className="flex-1 truncate text-sm font-medium" title={displayName}>
                  {displayName}
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                  {formatSize(file.size)}
                </span>
                <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground lg:inline">
                  {file.createdAt ? timeAgo(file.createdAt) : ''}
                </span>
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  onClick={(e) => handleDelete(e, file.id, file.filename)}
                  aria-label={`Delete ${displayName}`}
                  className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {/* Wider tiles: at 120px the names truncate after a few characters,
              and these are timestamped upload names. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
            {entries.map((entry) => {
              const { file, displayName } = entry;
              const isSelected = selectedFileId === file.id;

              return (
                <div
                  key={file.id}
                  className={cn(
                    'relative flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-colors cursor-pointer group',
                    isSelected
                      ? 'bg-primary/10 ring-2 ring-primary/30'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                  )}
                  onClick={() => {
                    // Opening a file leaves the folder selection alone: the
                    // file is already inside the current scope, so closing the
                    // preview should land back on the same list.
                    setSelectedFileId(file.id);
                    if (isMobile) openMobileDetail();
                  }}
                >
                  {/* An image shows itself; everything else shows its type
                      tile. Both occupy this same 76px slot, so thumbnails
                      loading in never move the grid around them. */}
                  <div className="flex h-19 items-center justify-center">
                    <FileTile file={file} className="group-hover:-translate-y-0.5" />
                  </div>

                  {/* Filename — the list is flat, so the name drops its folder
                      and the metadata line picks it up. A 160px tile is too
                      narrow to carry both in full. */}
                  <span className="text-xs font-medium truncate w-full leading-tight" title={displayName}>
                    {basename(displayName)}
                  </span>

                  {/* Metadata */}
                  <span className="w-full truncate text-[10px] text-muted-foreground leading-tight">
                    {dirname(displayName)
                      ? `${dirname(displayName)} · ${formatSize(file.size)}`
                      : `${formatSize(file.size)}${file.createdAt ? ` · ${timeAgo(file.createdAt)}` : ''}`}
                  </span>

                  {/* Delete button on hover */}
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    onClick={(e) => handleDelete(e, file.id, file.filename)}
                    aria-label={`Delete ${displayName}`}
                    className="absolute top-1.5 right-1.5 size-6 bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
