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
  describeFolder, getFileFilterGroup, getFileIcon,
  basename, dirname, getFilesUnderPath, getFolderContents,
} from './file-utils';
import { useFormatters, useT, type MessageKey, type TranslateFn } from '@/lib/i18n';

const SORT_LABEL_KEYS: Record<SortKey, MessageKey> = {
  name: 'files.sortName',
  recent: 'files.lastModified',
  size: 'files.sortSize',
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
  const t = useT();
  const { timeAgo, formatFileSize } = useFormatters();
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
    ? t('files.folders')
    : activeFilter
    ? t(activeFilter.labelKey)
    : t('files.allTypes');
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

  /**
   * One step up the path, and nothing else.
   *
   * This used to double as "leave the files pane" on mobile, which made a tap
   * from the first level jump straight to the folder panel — a whole screen
   * away, reading as a level skipped rather than a level climbed. Switching
   * panes is its own control now (see the folder button below), so this stays a
   * plain path operation at every depth and on both layouts.
   */
  const navigateUp = useCallback(() => {
    setCurrentPath(parentPath ?? '');
    setSelectedFileId(null);
  }, [parentPath, setCurrentPath, setSelectedFileId]);

  const navigateUpLabel = parentPath
    ? t('files.upOneLevel')
    : isMobile
      ? t('files.backToRecent')
      : t('files.clearFolderSelection');

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
      title: t('files.deleteTitle'),
      description: t('files.deleteDescription', { name: basename(filename) }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFile(fileId);
      toast.success(t('files.movedToTrash', { name: basename(filename) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.deleteFailed'));
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
      toast.error(t('files.pickFolderTitle'), {
        description: t('files.pickFolderBody'),
      });
      return;
    }
    uploadInto(droppedFiles);
  };

  /**
   * The folder's search box. Rendered in the toolbar on desktop and on its own
   * row below the header on mobile, where the toolbar has no width to spare —
   * one definition so the two can't drift apart.
   */
  const searchField = (
    <div className="relative w-full md:w-56">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('files.searchFilesPlaceholder')}
        aria-label={t('files.searchFilesLabel')}
        className="h-8 pr-7 pl-8 text-xs"
      />
      {search && (
        <button
          type="button"
          onClick={() => setSearch('')}
          aria-label={t('files.clearSearch')}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );

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
              <>
                {/* Mobile's way back to the folder tree, which lives in the
                    other pane. It takes the back button's slot at the top of
                    the path, so climbing out of a folder ends here rather than
                    skipping the recent list entirely. */}
                {isMobile && (
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    onClick={openMobileList}
                    className="mr-1 shrink-0 text-muted-foreground"
                    title={t('files.browseFolders')}
                    aria-label={t('files.browseFolders')}
                  >
                    <PanelLeft className="size-4" />
                  </Button>
                )}
                <span className="shrink-0 px-1.5 py-0.5 font-medium">{t('files.recentFiles')}</span>
              </>
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
                  title={navigateUpLabel}
                  aria-label={navigateUpLabel}
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
            {/* On a narrow screen the search box shares this row with the
                breadcrumbs, and at 224px wide it wins — the path, back button
                included, gets squeezed to nothing. So below `md` it moves to
                its own row under the header and only the icon actions stay
                here. See {@link searchField}. */}
            <div className="hidden md:block">{searchField}</div>

            {/* Type filter — only the kinds actually present, each with its
                count. An empty "Presentations" row is a dead end, not a
                filter. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('files.filterByType')}
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
                    <span className="flex-1">{t('files.allTypes')}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {contents.folders.length + scopedFiles.length}
                    </span>
                  </DropdownMenuRadioItem>
                  {contents.folders.length > 0 && (
                    <DropdownMenuRadioItem value="folders">
                      <span className="flex-1">{t('files.folders')}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {contents.folders.length}
                      </span>
                    </DropdownMenuRadioItem>
                  )}
                  {FILE_FILTER_GROUPS.filter((group) => typeCounts.get(group.id)).map((group) => (
                    <DropdownMenuRadioItem key={group.id} value={group.id}>
                      <span className="flex-1">{t(group.labelKey)}</span>
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
                  <span className="hidden lg:inline">{t(SORT_LABEL_KEYS[sort])}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                  {(Object.keys(SORT_LABEL_KEYS) as SortKey[]).map((key) => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {t(SORT_LABEL_KEYS[key])}
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
                aria-label={view === 'grid' ? t('files.switchToListView') : t('files.switchToGridView')}
                className="shrink-0 text-muted-foreground"
              >
                {view === 'grid' ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{view === 'grid' ? t('files.listView') : t('files.gridView')}</TooltipContent>
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
                aria-label={t('files.uploadFile')}
                className="shrink-0 text-muted-foreground"
              >
                <Upload className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('files.uploadTo', { path: currentPath })}</TooltipContent>
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

      {/* Search, on the narrow screens where it can't share the toolbar row */}
      {hasFolder && (
        <div className="shrink-0 border-b border-border px-3 py-2 md:hidden">
          {searchField}
        </div>
      )}

      {/* Grid content */}
      {!hasFolder && isEmpty ? (
        /* Nothing to be recent about — a workspace with no files at all. The
           one move that gets you out of it, and on mobile, where the folder
           panel is a separate pane, the way to reach it. */
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <FolderOpen className="size-16 opacity-20" />
            <p className="text-sm font-medium">{t('files.emptyTitle')}</p>
            <p className="max-w-md text-xs text-balance">{t('files.emptyBody')}</p>
            {isMobile && (
              <Button variant="outline" size="sm" className="mt-1" onClick={openMobileList}>
                <PanelLeft className="size-3.5" />
                {t('files.browseFolders')}
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
                ? t('files.noFoldersHere')
                : activeFilter
                ? t('files.noTypeHere', { type: t(activeFilter.labelKey) })
                : search
                ? t('files.noMatches')
                : t('files.folderEmpty')}
            </p>
            <p className="max-w-md text-xs text-balance">
              {typeFilter === 'folders'
                ? search
                  ? t('files.noSubfolderMatches')
                  : t('files.noSubfolders')
                : activeFilter
                ? search
                  ? t('files.noTypeMatchesInFolder')
                  : t('files.noTypeInFolder')
                : search
                ? // Says where it looked: the search covers this folder, so a
                  // miss here doesn't mean the file isn't in the workspace.
                  t('files.noMatchesIn', { folder: basename(currentPath), query: search })
                : t('files.dropHint')}
            </p>
            {/* One action: the thing this empty folder is for. Moving between
                folders belongs to the trail in the header and the panel on the
                left — a second way up from down here would be a third place to
                learn, for a move you can already make. */}
            {typeFilter !== 'all' ? (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => setTypeFilter('all')}>
                <X className="size-3.5" />
                {t('files.clearFilter')}
              </Button>
            ) : search ? (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => setSearch('')}>
                <X className="size-3.5" />
                {t('files.clearSearch')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="mt-1" onClick={() => fileInputRef.current?.click()}>
                <Upload className="size-3.5" />
                {t('files.uploadFiles')}
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
                {describeFolder(folder, t)}
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
                  {formatFileSize(file.size)}
                </span>
                <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground lg:inline">
                  {file.createdAt ? timeAgo(file.createdAt) : ''}
                </span>
                <Button
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  onClick={(e) => handleDelete(e, file.id, file.filename)}
                  aria-label={t('files.deleteItem', { name: displayName })}
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
                  {describeFolder(folder, t)}
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
                      : `${formatFileSize(file.size)}${file.createdAt ? ` · ${timeAgo(file.createdAt)}` : ''}`}
                  </span>

                  {/* Delete button on hover */}
                  <Button
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    onClick={(e) => handleDelete(e, file.id, file.filename)}
                    aria-label={t('files.deleteItem', { name: displayName })}
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
function uploadStatusLabel(upload: PendingUpload, t: TranslateFn): string {
  switch (upload.status) {
    case 'queued': return t('files.uploadWaiting');
    case 'error': return t('files.uploadFailedShort');
    // The bytes are up; the list is catching up. Saying 100% and sitting there
    // reads as stuck, and this is a beat, not a stage.
    case 'done': return t('files.uploadFinishing');
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
  const t = useT();
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
      aria-label={t('files.uploadingItem', { name: upload.name })}
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
  const t = useT();
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
          aria-label={t('files.retryUploadItem', { name: upload.name })}
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
        aria-label={failed ? t('files.dismissItem', { name: upload.name }) : t('files.cancelUploadItem', { name: upload.name })}
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
  const t = useT();
  const { formatFileSize } = useFormatters();
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
          ? upload.error ?? t('files.uploadFailed')
          : `${formatFileSize(upload.size)} · ${uploadStatusLabel(upload, t)}`}
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
  const t = useT();
  const { formatFileSize } = useFormatters();
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
        {failed ? upload.error ?? t('files.uploadFailed') : uploadStatusLabel(upload, t)}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {formatFileSize(upload.size)}
      </span>

      <UploadActions upload={upload} onRetry={onRetry} onCancel={onCancel} />
    </div>
  );
}
