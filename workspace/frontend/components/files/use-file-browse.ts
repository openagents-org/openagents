'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useIncrementalList } from '@/hooks/use-incremental-list';
// Aliased: these two are the layout context's vocabulary too, since it holds
// the state — one definition, so the two can't drift apart.
import type {
  FileFilterGroup, FolderEntry,
  FileSortKey as SortKey, FileTypeFilter as TypeFilter,
} from './file-utils';
import {
  FILE_FILTER_GROUPS, basename, getFileFilterGroup, getFilesUnderPath, getFolderContents,
} from './file-utils';

/**
 * What the Files pane is showing: the folder on screen, how it is narrowed and
 * ordered, and the folders, files and in-flight uploads that leaves — derived
 * here so the pane itself is only layout.
 */
export function useFileBrowse() {
  const { files, setSelectedFileId, currentFilePath, setCurrentFilePath, pendingUploads } = useWorkspace();
  const { filesBrowse, setFilesBrowse } = useLayout();

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

  // Search the full accessible collection, including older files.
  const allFiles = useMemo(() => getFilesUnderPath(files, '').map(entry => ({
    ...entry, displayName: basename(entry.file.filename),
  })), [files]);

  const contents = useMemo(() => {
    const { folders, files: direct } = currentPath
      ? getFolderContents(files, currentPath)
      : { folders: [] as FolderEntry[], files: allFiles };
    if (!search) return { folders, files: direct };
    const q = search.toLowerCase();
    return {
      folders: folders.filter((folder) => folder.name.toLowerCase().includes(q)),
      files: direct.filter((e) => e.displayName.toLowerCase().includes(q)),
    };
  }, [files, currentPath, search, allFiles]);

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

  /** A page of tiles at a time — mounting thousands at once froze the window. */
  const { shown: shownEntries, more: moreEntries, showMore } = useIncrementalList(
    entries, [currentPath, search, typeFilter, sort].join('\u0000'),
  );

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
    const listed = new Set(contents.files.map((e) => e.file.filename));
    const q = search.toLowerCase();
    return pendingUploads.filter((upload) => {
      if (currentPath && upload.folder !== currentPath) return false;
      const filename = upload.folder ? `${upload.folder}/${upload.name}` : upload.name;
      if (upload.status === 'done' && listed.has(filename)) return false;
      if (q && !upload.name.toLowerCase().includes(q)) return false;
      if (typeFilter === 'folders') return false;
      if (typeFilter === 'all') return true;
      return getFileFilterGroup(upload.contentType, upload.name) === typeFilter;
    });
  }, [pendingUploads, currentPath, search, contents.files, typeFilter]);

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

  return {
    currentPath, hasFolder, view, sort, typeFilter, search,
    setView, setSort, setTypeFilter, setSearch,
    allFiles, contents, scopedFiles, typeCounts, activeFilter,
    entries, shownEntries, moreEntries, showMore, folderEntries, uploadsHere,
    itemCount, isEmpty, breadcrumbs, parentPath, openFolder,
  };
}
