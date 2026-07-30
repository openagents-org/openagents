'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Search, Upload, FileX, ChevronRight, ArrowLeft, RotateCcw, Trash2, FolderOpen, PanelLeft,
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
import type { PendingUpload } from '@/hooks/use-upload-queue';
// Aliased: these two are the layout context's vocabulary too, since it holds
// the state — one definition, so the two can't drift apart.
import type {
  FileEntry, FileFilterGroup, FolderEntry,
  FileSortKey as SortKey, FileTypeFilter as TypeFilter,
} from './file-utils';
import {
  FILE_FILTER_GROUPS, FileRowIcon, FileTile, FileTypeTile, FolderRowIcon, FolderTile,
  describeFolder, formatSize, getFileFilterGroup, getFileIcon, timeAgo,
  basename, dirname, getFilesUnderPath, getFolderContents,
} from './file-utils';

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  recent: 'Last modified',
  size: 'Size',
};

/**
 * How many files the no-folder view shows.
 *
 * A starting point rather than an index: past the first screenful you're not
 * scanning any more, you're looking for something, and the folder tree and its
 * search are what that is.
 */
const RECENT_LIMIT = 50;

/**
 * The detail pane: the files inside whatever the folder panel has selected.
 *
 * The folder panel is the persistent tree; this pane shows the direct contents
 * of the selected folder, including its immediate subfolders.
 *
 * With nothing picked it shows the newest files in the workspace instead of an
 * empty root. That listing is a starting point, not a place: it can't be
 * uploaded into, and each row carries the folder it actually lives in, because
 * a flat dump you could mistake for a folder is one you'd try to act on.
 */
export function FileGrid() {
  const {
    files, selectedFileId, setSelectedFileId, deleteFile,
    currentFilePath, setCurrentFilePath,
    pendingUploads, enqueueUploads, retryUpload, cancelUpload,
  } = useWorkspace();
  const {
    isMobile, openMobileDetail, openMobileList, filesBrowse, setFilesBrowse,
  } = useLayout();
  const confirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPath = currentFilePath;
  const setCurrentPath = setCurrentFilePath;

  /**
   * How this pane is looking at the folder. It's kept in the layout context
   * because this component is unmounted whenever a file is open — see
   * {@link FilesBrowseState}.
   *
   * The filter and the search box are folder-bound: they narrow the folder
   * you're standing in, and they only read back while you're still standing in
   * it. Opening a file doesn't move you, so they survive the preview; walking
   * into another folder does, so they don't come with you.
   */
  const { view, sort, narrowing } = filesBrowse;
  const inFolder = narrowing.path === currentPath;
  const typeFilter = inFolder ? narrowing.typeFilter : 'all';
  const search = inFolder ? narrowing.query : '';

  const setView = (next: 'grid' | 'list') => setFilesBrowse({ view: next });
  const setSort = (next: SortKey) => setFilesBrowse({ sort: next });
  const setTypeFilter = (next: TypeFilter) =>
    setFilesBrowse({ narrowing: { path: currentPath, typeFilter: next, query: search } });
  const setSearch = (query: string) =>
    setFilesBrowse({ narrowing: { path: currentPath, typeFilter, query } });

  /**
   * Drop a narrowing left over from another folder.
   *
   * The reads above already ignore it, so this is bookkeeping rather than
   * display: without it, a filter set in one folder would come back when you
   * returned to that folder later, which is exactly the "why is this list
   * short" moment the reset is here to prevent.
   */
  useEffect(() => {
    if (narrowing.path !== currentPath) {
      setFilesBrowse({ narrowing: { path: currentPath, typeFilter: 'all', query: '' } });
    }
  }, [currentPath, narrowing.path, setFilesBrowse]);

  /** A folder is picked, so there is a folder's worth of things to act on. */
  const hasFolder = Boolean(currentPath);

  /**
   * What's on screen with no folder picked: the newest files in the workspace,
   * wherever they live.
   *
   * The pane used to sit empty here telling you to pick something, which spent
   * the whole width on an instruction. What you want on opening Files is
   * usually the thing you or an agent just put there, and that's one list away
   * — every file is already loaded to draw the folder tree, so this is a sort
   * and a slice rather than a fetch.
   *
   * It's a starting point, not a place: there's no folder to upload into, no
   * subfolders to open, and the folder each file belongs to rides along on
   * every row so the list can't be mistaken for one.
   */
  const recentFiles = useMemo(() => {
    if (currentPath) return [] as FileEntry[];
    return getFilesUnderPath(files, '')
      .sort((a, b) => {
        const at = a.file.createdAt ? new Date(a.file.createdAt).getTime() : 0;
        const bt = b.file.createdAt ? new Date(b.file.createdAt).getTime() : 0;
        return bt - at || a.displayName.localeCompare(b.displayName);
      })
      .slice(0, RECENT_LIMIT)
      // The name alone, with the folder shown beside it — a row of full paths
      // truncates to the folder and hides the filename it's there for.
      .map((entry) => ({ ...entry, displayName: basename(entry.file.filename) }));
  }, [files, currentPath]);

  /**
   * What's in the folder on screen: its subfolders, and the files sitting
   * directly in it. One level, like the folder itself — a file two folders
   * down belongs to the folder it's in, not to this listing.
   *
   * Search narrows this listing and nothing else. It's a filter on the folder
   * you're standing in, not a way out of it: a query that pulled in matches
   * from folders you can't see would leave you looking at a list you can't act
   * on — you can't upload into it, and the header above it would be describing
   * a folder that half the rows don't belong to.
   */
  const contents = useMemo(() => {
    if (!currentPath) return { folders: [] as FolderEntry[], files: recentFiles };
    const { folders, files: direct } = getFolderContents(files, currentPath);
    if (!search) return { folders, files: direct };
    const q = search.toLowerCase();
    return {
      folders: folders.filter((folder) => folder.name.toLowerCase().includes(q)),
      files: direct.filter((e) => e.displayName.toLowerCase().includes(q)),
    };
  }, [files, currentPath, search, recentFiles]);

  /** The files this listing can show — what the filter menu counts, so a
   *  listed type always has something behind it. */
  const scopedFiles = contents.files;

  const typeCounts = useMemo(() => {
    const counts = new Map<FileFilterGroup, number>();
    for (const entry of scopedFiles) {
      const group = getFileFilterGroup(entry.file.contentType, entry.file.filename);
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    return counts;
  }, [scopedFiles]);

  const activeFilter = typeFilter === 'all' || typeFilter === 'folders'
    ? null
    : FILE_FILTER_GROUPS.find((g) => g.id === typeFilter) ?? null;

  const entries = useMemo(() => {
    const scoped = typeFilter === 'all'
      ? scopedFiles
      : typeFilter === 'folders'
      ? []
      : scopedFiles.filter(
          (e) => getFileFilterGroup(e.file.contentType, e.file.filename) === typeFilter,
        );

    // The recent list is already in the only order it has: newest first is what
    // makes it "recent", and the sort control is hidden with no folder picked.
    if (!currentPath) return scoped;

    return [...scoped].sort((a, b) => {
      if (sort === 'size') {
        return b.file.size - a.file.size || a.displayName.localeCompare(b.displayName);
      }
      if (sort === 'recent') {
        const at = a.file.createdAt ? new Date(a.file.createdAt).getTime() : 0;
        const bt = b.file.createdAt ? new Date(b.file.createdAt).getTime() : 0;
        return bt - at || a.displayName.localeCompare(b.displayName);
      }
      return a.displayName.localeCompare(b.displayName);
    });
  }, [scopedFiles, sort, typeFilter, currentPath]);

  /** Folders and files sort independently, then folders lead the combined
   *  listing. A size/recent sort uses aggregate subtree metadata for folders. */
  const folderEntries = useMemo(() => {
    if (typeFilter !== 'all' && typeFilter !== 'folders') return [];
    return [...contents.folders].sort((a, b) => {
      if (sort === 'size') {
        return b.totalSize - a.totalSize || a.path.localeCompare(b.path);
      }
      if (sort === 'recent') {
        const at = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
        const bt = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
        return bt - at || a.path.localeCompare(b.path);
      }
      return a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
    });
  }, [contents.folders, sort, typeFilter]);

  /**
   * Files still going up into the folder on screen, drawn as items of their own
   * at the head of the listing.
   *
   * A finished one stays until the refetch lists it for real — dropping it the
   * moment the request returned left a hole where the file had just been. It
   * goes when its name turns up in `contents`, which is the same instant the
   * real tile can take over.
   *
   * Search and the type filter narrow these the same way they narrow the rest
   * of the listing — an upload is one of this folder's items, and hiding the
   * listed ones while leaving the uploading ones would make the filter lie.
   */
  const uploadsHere = useMemo(() => {
    if (!currentPath) return [];
    const listed = new Set(contents.files.map((e) => e.displayName));
    const q = search.toLowerCase();
    return pendingUploads.filter((upload) => {
      if (upload.folder !== currentPath) return false;
      if (upload.status === 'done' && listed.has(upload.name)) return false;
      if (q && !upload.name.toLowerCase().includes(q)) return false;
      if (typeFilter === 'folders') return false;
      if (typeFilter === 'all') return true;
      return getFileFilterGroup(upload.contentType, upload.name) === typeFilter;
    });
  }, [pendingUploads, currentPath, search, contents.files, typeFilter]);

  const activeTypeLabel = typeFilter === 'folders'
    ? 'Folders'
    : activeFilter?.label ?? 'All types';
  const itemCount = folderEntries.length + entries.length + uploadsHere.length;
  const isEmpty = itemCount === 0;

  /** Open a subfolder from the listing; the folder panel follows along. */
  const openFolder = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedFileId(null);
  }, [setCurrentPath, setSelectedFileId]);

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/');
  }, [currentPath]);

  /** Only a nested folder has somewhere to go up *to* — the root isn't a view. */
  const parentPath = breadcrumbs.length > 1
    ? breadcrumbs.slice(0, -1).join('/')
    : null;

  const navigateUp = useCallback(() => {
    setCurrentPath(parentPath ?? '');
    setSelectedFileId(null);
  }, [parentPath, setCurrentPath, setSelectedFileId]);

  const navigateToBreadcrumb = useCallback((index: number) => {
    const segments = currentPath.split('/');
    setCurrentPath(segments.slice(0, index + 1).join('/'));
    setSelectedFileId(null);
  }, [currentPath, setCurrentPath, setSelectedFileId]);

  /**
   * Upload a batch into the folder on screen — the only place an upload can
   * land now that there's no root listing.
   *
   * This hands off and returns: the queue draws each file into the listing
   * right away and fills in its progress, so there's nothing to wait for here
   * and nothing to announce at the end that the grid hasn't already shown.
   */
  const uploadInto = useCallback((list: FileList) => {
    if (!currentPath || list.length === 0) return;
    enqueueUploads(Array.from(list), currentPath);
  }, [currentPath, enqueueUploads]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadInto(e.target.files);
    // Reset so picking the same file twice in a row still fires a change
    if (fileInputRef.current) fileInputRef.current.value = '';
  };


  const handleDelete = async (e: React.MouseEvent, fileId: string, filename: string) => {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete file?',
      description: `"${basename(filename)}" moves to the Trash, where you can put it back.`,
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFile(fileId);
      toast.success(`Moved "${basename(filename)}" to Trash`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // Drop zone handling — a drop needs a folder to land in, same as the upload
  // button. Without one the file would silently go somewhere you can't see.
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    if (!currentPath) {
      toast.error('Pick a folder first', {
        description: 'Choose a folder on the left, then drop the files in.',
      });
      return;
    }
    uploadInto(droppedFiles);
  };

  return (
    <div
      className={cn('flex flex-col h-full', dragOver && hasFolder && 'ring-2 ring-inset ring-primary/40 bg-primary/5')}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Toolbar — the title is the trail to the folder on screen and the count
          is what's in it. Searching doesn't change either: it narrows this
          folder, so the folder is still what you're looking at. The trail
          starts at the picked folder: there's no root above it to climb to. */}
      <DetailHeader
        titleInHeader
        title={
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground">
            {!currentPath ? (
              <span className="shrink-0 px-1.5 py-0.5 font-medium">Recent files</span>
            ) : (
              <>
                {/* At a nested level this goes to the parent. At the first
                    level it clears the selected folder and returns to the
                    unselected state. */}
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  onClick={navigateUp}
                  className="mr-1 shrink-0 text-muted-foreground"
                  title={parentPath ? 'Up one level' : 'Clear folder selection'}
                  aria-label={parentPath ? 'Up one level' : 'Clear folder selection'}
                >
                  <ArrowLeft className="size-4" />
                </Button>
                {breadcrumbs.map((segment, i) => (
                  <span key={i} className="flex items-center gap-0.5 shrink-0">
                    {i > 0 && <ChevronRight className="size-3.5 opacity-40" />}
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
            {itemCount > 0 && (
              <Badge variant="secondary" size="sm" className="ml-1.5 shrink-0 rounded-full!">
                {itemCount}
              </Badge>
            )}
          </div>
        }
      >
        {/* Everything here needs a list to act on, so it all waits for one:
            searching, sorting and filtering nothing are equally no-ops. */}
        {hasFolder && (
          <>
            {/* Search — a filter on this folder, which is why it says so and
                why it only exists once you're standing in one. */}
            <div className="relative w-48 shrink-0">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search in ${basename(currentPath)}…`}
                aria-label={`Search in ${currentPath}`}
                className="h-8 pr-7 pl-8 text-xs"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Type filter — only the kinds actually present, each with its
                count. An empty "Presentations" row is a dead end, not a
                filter. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Filter by type"
                  className={cn(
                    'shrink-0 gap-1.5',
                    typeFilter !== 'all' ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <ListFilter
                    className="size-4"
                    style={
                      activeFilter
                        ? { color: activeFilter.color }
                        : typeFilter === 'folders'
                        ? { color: '#f59e0b' }
                        : undefined
                    }
                  />
                  <span className="hidden lg:inline">{activeTypeLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuRadioGroup
                  value={typeFilter}
                  onValueChange={(v) => setTypeFilter(v as TypeFilter)}
                >
                  <DropdownMenuRadioItem value="all">
                    <span className="flex-1">All types</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {contents.folders.length + scopedFiles.length}
                    </span>
                  </DropdownMenuRadioItem>
                  {contents.folders.length > 0 && (
                    <DropdownMenuRadioItem value="folders">
                      <span className="flex-1">Folders</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {contents.folders.length}
                      </span>
                    </DropdownMenuRadioItem>
                  )}
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

          </>
        )}

        {/* Outside the block above: grid-or-list is how you like to read a
            listing rather than something about this folder, so it belongs to
            the recent list too. It waits for a listing to exist at all. */}
        {(hasFolder || !isEmpty) && (
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
        )}

        {/* Upload only — creating folders belongs to the folder panel, which
            owns the tree and can show the new folder in place. An upload has
            to land somewhere, so it appears once a folder is picked. */}
        {hasFolder && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload file"
                className="shrink-0 text-muted-foreground"
              >
                <Upload className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Upload to ${currentPath}`}</TooltipContent>
          </Tooltip>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleUpload}
        />
      </DetailHeader>

      {/* Grid content */}
      {!hasFolder && isEmpty ? (
        /* Nothing to be recent about — a workspace with no files at all. The
           one move that gets you out of it, and on mobile, where the folder
           panel is a separate pane, the way to reach it. */
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <FolderOpen className="size-16 opacity-20" />
            <p className="text-sm font-medium">No files yet</p>
            <p className="max-w-md text-xs text-balance">
              Create a folder on the left, then drop files into it — whatever
              lands there shows up here.
            </p>
            {isMobile && (
              <Button variant="outline" size="sm" className="mt-1" onClick={openMobileList}>
                <PanelLeft className="size-3.5" />
                Browse folders
              </Button>
            )}
          </div>
        </div>
      ) : hasFolder && isEmpty ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <FileX className="size-16 opacity-20" />
            <p className="text-sm font-medium">
              {typeFilter === 'folders'
                ? 'No folders here'
                : activeFilter
                ? `No ${activeFilter.label.toLowerCase()} here`
                : search
                ? 'No matches'
                : 'This folder is empty'}
            </p>
            <p className="max-w-md text-xs text-balance">
              {typeFilter === 'folders'
                ? search
                  ? 'No subfolder of this one matches your search.'
                  : 'This folder has no subfolders.'
                : activeFilter
                ? search
                  ? 'Nothing of this type in this folder matches your search.'
                  : 'Nothing of this type in this folder.'
                : search
                ? // Says where it looked: the search covers this folder, so a
                  // miss here doesn't mean the file isn't in the workspace.
                  `Nothing in ${basename(currentPath)} matches “${search}”.`
                : 'Drag files in, upload them, or pick another folder on the left.'}
            </p>
            {/* One action: the thing this empty folder is for. Moving between
                folders belongs to the trail in the header and the panel on the
                left — a second way up from down here would be a third place to
                learn, for a move you can already make. */}
            {typeFilter !== 'all' ? (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => setTypeFilter('all')}>
                <X className="size-3.5" />
                Clear filter
              </Button>
            ) : search ? (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => setSearch('')}>
                <X className="size-3.5" />
                Clear search
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-3.5" />
                Upload files
              </Button>
            )}
          </div>
        </div>
      ) : view === 'list' ? (
        /* List view — one row per item, name in full. Upload names run long
           and look alike, so a dense row with the whole name and its metadata
           beats a wall of truncated tiles. */
        <div className="flex-1 overflow-y-auto p-2">
          {/* Whatever is going up leads the list: it's the thing that just
              happened, and it's the thing with something left to say. */}
          {uploadsHere.map((upload) => (
            <UploadRow
              key={upload.id}
              upload={upload}
              onRetry={() => retryUpload(upload.id)}
              onCancel={() => cancelUpload(upload.id)}
            />
          ))}

          {/* Subfolders first, the way a folder listing reads everywhere else */}
          {folderEntries.map((folder) => (
            <div
              key={folder.path}
              onClick={() => openFolder(folder.path)}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            >
              <FolderRowIcon />
              <span className="flex-1 truncate text-sm font-medium" title={folder.path}>
                {folder.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {describeFolder(folder)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
            </div>
          ))}

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
                <span className="flex-1 truncate text-sm font-medium" title={file.filename}>
                  {displayName}
                  {/* Where it lives, only where that isn't already the answer:
                      in a folder listing every row shares the same folder. */}
                  {!hasFolder && dirname(file.filename) && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      in {dirname(file.filename)}
                    </span>
                  )}
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
            {/* Files on their way up take the first slots, in the same tiles
                they'll keep once they land. */}
            {uploadsHere.map((upload) => (
              <UploadTile
                key={upload.id}
                upload={upload}
                onRetry={() => retryUpload(upload.id)}
                onCancel={() => cancelUpload(upload.id)}
              />
            ))}

            {/* Subfolders lead, in the same grid — they're contents too, and a
                separate row of them would break the flow at every level. */}
            {folderEntries.map((folder) => (
              <div
                key={folder.path}
                onClick={() => openFolder(folder.path)}
                className="group flex cursor-pointer flex-col items-center gap-1.5 rounded-xl p-3 text-center transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              >
                <div className="flex h-19 items-center justify-center">
                  <FolderTile className="group-hover:-translate-y-0.5" />
                </div>
                <span className="w-full truncate text-xs leading-tight font-medium" title={folder.path}>
                  {folder.name}
                </span>
                <span className="w-full truncate text-[10px] leading-tight text-muted-foreground">
                  {describeFolder(folder)}
                </span>
              </div>
            ))}

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

                  {/* Filename — in a folder listing every file here sits
                      directly in the folder above, so the name is all there is
                      to say. The recent list spans folders, so the metadata
                      line below carries the one each file came from. */}
                  <span className="text-xs font-medium truncate w-full leading-tight" title={file.filename}>
                    {displayName}
                  </span>

                  {/* Metadata */}
                  <span className="w-full truncate text-[10px] text-muted-foreground leading-tight">
                    {!hasFolder && dirname(file.filename)
                      ? dirname(file.filename)
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

/* ── Uploads in progress ─────────────────────────────────────────────────────
 * An upload is drawn as the item it's about to become — same tile, same row,
 * same slot in the listing — with a bar across it. Two things follow from
 * that: you can see *what* is uploading (an image shows its own pixels,
 * straight off the disk, before a single byte has reached the server), and
 * when it lands nothing moves. The real file simply takes the space.
 * ─────────────────────────────────────────────────────────────────────────── */

/** The one line of state these have room for. */
function uploadStatusLabel(upload: PendingUpload): string {
  switch (upload.status) {
    case 'queued': return 'Waiting…';
    case 'error': return 'Failed';
    // The bytes are up; the list is catching up. Saying 100% and sitting there
    // reads as stuck, and this is a beat, not a stage.
    case 'done': return 'Finishing…';
    default: return `${Math.round(upload.progress * 100)}%`;
  }
}

function UploadProgress({
  upload,
  className,
}: {
  upload: PendingUpload;
  className?: string;
}) {
  const failed = upload.status === 'error';
  // A failed upload keeps its bar full and red rather than showing how far it
  // got: how far is no longer the question. A fresh one shows a sliver, so
  // there's a bar to watch from the first frame.
  const percent = failed || upload.status === 'done'
    ? 100
    : Math.max(3, Math.round(upload.progress * 100));

  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-foreground/10', className)}
      role="progressbar"
      aria-valuenow={Math.round(upload.progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Uploading ${upload.name}`}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200 ease-out',
          failed ? 'bg-destructive' : 'bg-primary',
          // Queued files haven't been asked for yet — a still bar at 3% would
          // claim otherwise.
          upload.status === 'queued' && 'animate-pulse',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Retry / cancel — retry only exists once there's something to retry. */
function UploadActions({
  upload,
  onRetry,
  onCancel,
  className,
}: {
  upload: PendingUpload;
  onRetry: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const failed = upload.status === 'error';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-0.5 transition-opacity',
        // A failure is waiting on an answer, so its buttons stay put; a healthy
        // upload's cancel is there when you go looking for it.
        failed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
        className,
      )}
    >
      {failed && (
        <Button
          variant="ghost"
          mode="icon"
          size="sm"
          onClick={onRetry}
          aria-label={`Retry uploading ${upload.name}`}
          className="size-6 bg-background/80 text-muted-foreground shadow-sm"
        >
          <RotateCcw className="size-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        mode="icon"
        size="sm"
        onClick={onCancel}
        aria-label={failed ? `Dismiss ${upload.name}` : `Cancel uploading ${upload.name}`}
        className="size-6 bg-background/80 text-muted-foreground shadow-sm hover:text-red-500"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

function UploadTile({
  upload,
  onRetry,
  onCancel,
}: {
  upload: PendingUpload;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const failed = upload.status === 'error';

  return (
    <div className="group relative flex flex-col items-center gap-1.5 rounded-xl p-3 text-center">
      <div className="relative flex h-19 items-center justify-center">
        {upload.previewUrl ? (
          <span className="block size-19 overflow-hidden rounded-xl border border-border/70 shadow-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={upload.previewUrl}
              alt=""
              className={cn('size-full object-cover', !failed && 'opacity-75')}
            />
          </span>
        ) : (
          <FileTypeTile
            contentType={upload.contentType}
            filename={upload.name}
            className={cn(!failed && 'opacity-75')}
          />
        )}

        {/* Across the file itself, not the row it sits in: the progress belongs
            to this file, and a tile of pictures needs the two tied together. */}
        <div className="absolute inset-x-1.5 bottom-1.5">
          <UploadProgress upload={upload} />
        </div>
      </div>

      <span className="w-full truncate text-xs leading-tight font-medium" title={upload.name}>
        {upload.name}
      </span>
      <span
        className={cn(
          'w-full truncate text-[10px] leading-tight',
          failed ? 'text-destructive' : 'text-muted-foreground',
        )}
        title={failed ? upload.error : undefined}
      >
        {failed
          ? upload.error ?? 'Upload failed'
          : `${formatSize(upload.size)} · ${uploadStatusLabel(upload)}`}
      </span>

      <UploadActions
        upload={upload}
        onRetry={onRetry}
        onCancel={onCancel}
        className="absolute top-1.5 right-1.5"
      />
    </div>
  );
}

function UploadRow({
  upload,
  onRetry,
  onCancel,
}: {
  upload: PendingUpload;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const failed = upload.status === 'error';

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2">
      {upload.previewUrl ? (
        <span className="block size-7 shrink-0 overflow-hidden rounded-md border border-border/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={upload.previewUrl} alt="" className="size-full object-cover" />
        </span>
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center">
          {getFileIcon(upload.contentType, upload.name)}
        </span>
      )}

      {/* The bar sits under the name, in the space the row already gives it —
          it's this file's progress, so it stays this file's width. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-sm font-medium" title={upload.name}>
          {upload.name}
        </span>
        <UploadProgress upload={upload} className="max-w-72" />
      </div>

      <span
        className={cn(
          'max-w-40 shrink-0 truncate text-xs tabular-nums',
          failed ? 'text-destructive' : 'text-muted-foreground',
        )}
        title={failed ? upload.error : undefined}
      >
        {failed ? upload.error ?? 'Upload failed' : uploadStatusLabel(upload)}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {formatSize(upload.size)}
      </span>

      <UploadActions upload={upload} onRetry={onRetry} onCancel={onCancel} />
    </div>
  );
}
