'use client';

import { useRef, useState } from 'react';
import { ArrowDownWideNarrow, LayoutGrid, List, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useT, type MessageKey } from '@/lib/i18n';
import { LoadMoreSentinel } from '@/hooks/use-incremental-list';
import { FILE_FILTER_GROUPS, basename, type FileEntry, type FileSortKey as SortKey } from './file-utils';
import { FilesEmptyWorkspace, FolderEmpty } from './file-grid-empty';
import { FileGridFilters, type FileFilterCategory } from './file-grid-filters';
import { FileGridTile, FileListRow, FolderGridTile, FolderListRow, type FileItemProps } from './file-grid-items';
import { FileGridTrail } from './file-grid-trail';
import { UploadRow, UploadTile } from './file-upload-items';
import { useFileBrowse } from './use-file-browse';
import { useFileSharing } from './use-file-sharing';

const SORT_LABEL_KEYS: Record<SortKey, MessageKey> = {
  name: 'files.sortName',
  recent: 'files.lastModified',
  size: 'files.sortSize',
};

/** Browse all accessible files, or a folder, with visible type categories. */
export function FileGrid() {
  const { selectedFileId, setSelectedFileId, deleteFile, enqueueUploads, retryUpload, cancelUpload } = useWorkspace();
  const { isMobile, openMobileDetail, openMobileList } = useLayout();
  const confirm = useConfirm();
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    currentPath, hasFolder, view, sort, typeFilter, search, setView, setSort, setTypeFilter, setSearch,
    allFiles, contents, scopedFiles, typeCounts, activeFilter, shownEntries, moreEntries, showMore,
    folderEntries, uploadsHere, itemCount, isEmpty, breadcrumbs, parentPath, openFolder,
  } = useFileBrowse();

  /**
   * One step up the path, and nothing else. Switching panes on mobile is its
   * own control (the folder button in the trail), so this stays a plain path
   * operation at every depth and on both layouts.
   */
  const navigateUp = () => openFolder(parentPath ?? '');
  const navigateUpLabel = parentPath
    ? t('files.upOneLevel')
    : isMobile
      ? t('files.backToRecent')
      : t('files.clearFolderSelection');

  /**
   * Upload a batch into the folder on screen — the only place an upload can
   * land now that there's no root listing. The queue draws each file into the
   * listing right away, so there's nothing to wait for here.
   */
  const uploadInto = (list: FileList) => {
    if (!currentPath || list.length === 0) return;
    enqueueUploads(Array.from(list), currentPath);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadInto(e.target.files);
    // Reset so picking the same file twice in a row still fires a change
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const { share, flipVisibility, shareDialog } = useFileSharing();

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
      toast.error(t('files.pickFolderTitle'), { description: t('files.pickFolderBody') });
      return;
    }
    uploadInto(droppedFiles);
  };

  const categories: FileFilterCategory[] = [
    { id: 'all', label: t('files.allTypes'), count: scopedFiles.length + contents.folders.length },
    ...(contents.folders.length ? [{ id: 'folders' as const, label: t('files.folders'), count: contents.folders.length }] : []),
    ...FILE_FILTER_GROUPS.map((group) => ({ id: group.id, label: t(group.labelKey), count: typeCounts.get(group.id) || 0 })),
  ];

  const itemProps = ({ file, displayName }: FileEntry): FileItemProps => ({
    file,
    displayName,
    selected: selectedFileId === file.id,
    inFolder: hasFolder,
    // Opening a file leaves the folder selection alone: the file is already
    // inside the current scope, so closing the preview lands on the same list.
    onOpen: () => {
      setSelectedFileId(file.id);
      if (isMobile) openMobileDetail();
    },
    onShare: () => share(file.id),
    onVisibility: (v) => flipVisibility(file, v),
    onDelete: (e) => handleDelete(e, file.id, file.filename),
  });

  return (
    <div
      className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden', dragOver && hasFolder && 'bg-primary/5 ring-2 ring-primary/40 ring-inset')}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <DetailHeader
        titleInHeader
        title={
          <FileGridTrail
            breadcrumbs={breadcrumbs}
            itemCount={itemCount}
            upLabel={navigateUpLabel}
            onUp={navigateUp}
            onCrumb={(i) => openFolder(breadcrumbs.slice(0, i + 1).join('/'))}
            onBrowseFolders={isMobile ? openMobileList : undefined}
          />
        }
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
              <ArrowDownWideNarrow data-icon="inline-start" />
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

        {/* Grid-or-list is how you like to read a listing rather than something
            about this folder, so it belongs to the recent list too. It waits
            for a listing to exist at all. */}
        {(hasFolder || !isEmpty) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
                aria-label={view === 'grid' ? t('files.switchToListView') : t('files.switchToGridView')}
                className="shrink-0 text-muted-foreground"
              >
                {view === 'grid' ? <List /> : <LayoutGrid />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{view === 'grid' ? t('files.listView') : t('files.gridView')}</TooltipContent>
          </Tooltip>
        )}

        {/* Upload only — creating folders belongs to the folder panel, which
            owns the tree. An upload has to land somewhere, so it appears once
            a folder is picked. */}
        {hasFolder && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                aria-label={t('files.uploadFile')}
                className="shrink-0 text-muted-foreground"
              >
                <Upload />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('files.uploadTo', { path: currentPath })}</TooltipContent>
          </Tooltip>
        )}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
      </DetailHeader>

      <FileGridFilters
        categories={categories}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
        search={search}
        onSearch={setSearch}
      />

      {!hasFolder && allFiles.length === 0 ? (
        <FilesEmptyWorkspace onBrowseFolders={isMobile ? openMobileList : undefined} />
      ) : isEmpty ? (
        <FolderEmpty
          typeFilter={typeFilter}
          filterLabel={activeFilter ? t(activeFilter.labelKey) : null}
          search={search}
          folder={hasFolder ? basename(currentPath) : null}
          onClearFilter={() => setTypeFilter('all')}
          onClearSearch={() => setSearch('')}
          onUpload={() => fileInputRef.current?.click()}
        />
      ) : view === 'list' ? (
        /* One row per item, name in full: upload names run long and look
           alike, so a dense row beats a wall of truncated tiles. Uploads lead,
           then subfolders, the way a folder listing reads everywhere else. */
        <div className="flex-1 overflow-y-auto p-2">
          {uploadsHere.map((upload) => (
            <UploadRow
              key={upload.id}
              upload={upload}
              onRetry={() => retryUpload(upload.id)}
              onCancel={() => cancelUpload(upload.id)}
            />
          ))}
          {folderEntries.map((folder) => (
            <FolderListRow key={folder.path} folder={folder} onOpen={() => openFolder(folder.path)} />
          ))}
          {shownEntries.map((entry) => <FileListRow key={entry.file.id} {...itemProps(entry)} />)}
          {moreEntries && <LoadMoreSentinel onVisible={showMore} count={shownEntries.length} />}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {/* Wider tiles: at 120px the names truncate after a few characters,
              and these are timestamped upload names. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
            {uploadsHere.map((upload) => (
              <UploadTile
                key={upload.id}
                upload={upload}
                onRetry={() => retryUpload(upload.id)}
                onCancel={() => cancelUpload(upload.id)}
              />
            ))}
            {folderEntries.map((folder) => (
              <FolderGridTile key={folder.path} folder={folder} onOpen={() => openFolder(folder.path)} />
            ))}
            {shownEntries.map((entry) => <FileGridTile key={entry.file.id} {...itemProps(entry)} />)}
            {moreEntries && <LoadMoreSentinel onVisible={showMore} count={shownEntries.length} />}
          </div>
        </div>
      )}

      {shareDialog}
    </div>
  );
}
