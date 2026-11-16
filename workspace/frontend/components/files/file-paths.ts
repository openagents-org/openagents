import type { WorkspaceFile } from '@/lib/types';
import type { TranslateFn } from '@/lib/i18n';

/** Get the basename of a path (last segment after /) */
export function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** The folder a path lives in — '' for a file sitting at the root. */
export function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** Marker file the backend writes so an empty folder still has a path prefix. */
export const FOLDER_KEEP = '.keep';

/**
 * True for the placeholder rows that back empty folders.
 *
 * These are an implementation detail of "a folder exists" and are never a file
 * the user put there, so every listing and every count has to skip them —
 * which is why the test lives here rather than being spelled out at each site.
 */
export function isKeepFile(filename: string): boolean {
  return basename(filename) === FOLDER_KEEP;
}

/**
 * How many real files the workspace holds, placeholders excluded.
 *
 * The count the sidebar shows has to mean the same thing as the counts inside
 * the files view; reading `files.length` there counted one extra per empty
 * folder and left the sidebar disagreeing with every number below it.
 */
export function countFiles(files: WorkspaceFile[]): number {
  let total = 0;
  for (const file of files) if (!isKeepFile(file.filename)) total += 1;
  return total;
}

export interface FileEntry {
  type: 'file';
  file: WorkspaceFile;
  displayName: string;
}

export interface FolderEntry {
  type: 'folder';
  /** Full path from the root, which is what selecting it navigates to */
  path: string;
  name: string;
  /** Files anywhere below it — what you'd find if you kept opening it */
  fileCount: number;
  /** Direct subfolders, so a folder of folders doesn't read as empty */
  folderCount: number;
  /** Total bytes in the folder subtree, used when sorting folders by size */
  totalSize: number;
  /** Newest item in the folder subtree, used as the folder's modified time */
  modifiedAt: string | null;
}

/**
 * Every file at or below `path`, named relative to it.
 *
 * Used for search, which spans folders and so has to say which one each hit
 * came from. Browsing uses {@link getFolderContents} instead — one level at a
 * time, the way the folder was built.
 */
export function getFilesUnderPath(files: WorkspaceFile[], path: string): FileEntry[] {
  const prefix = path ? `${path}/` : '';
  const entries: FileEntry[] = [];

  for (const file of files) {
    if (prefix && !file.filename.startsWith(prefix)) continue;
    const relative = prefix ? file.filename.slice(prefix.length) : file.filename;
    if (isKeepFile(relative)) continue;
    entries.push({ type: 'file', file, displayName: relative });
  }

  return entries;
}

/**
 * Every folder represented by the file-path prefixes in the workspace.
 *
 * Folder metadata is aggregated over the whole subtree. This gives folder
 * sorting useful semantics even though folders are virtual and do not have
 * their own size or modified timestamp in the API.
 */
export function getAllFolders(files: WorkspaceFile[]): FolderEntry[] {
  const folders = new Map<string, FolderEntry>();
  const childFolders = new Map<string, Set<string>>();

  for (const file of files) {
    const directory = dirname(file.filename);
    if (!directory) continue;

    const segments = directory.split('/');
    const isKeep = isKeepFile(file.filename);
    const createdAtMs = file.createdAt ? new Date(file.createdAt).getTime() : 0;

    for (let i = 0; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join('/');
      let entry = folders.get(path);
      if (!entry) {
        entry = {
          type: 'folder',
          path,
          name: segments[i],
          fileCount: 0,
          folderCount: 0,
          totalSize: 0,
          modifiedAt: null,
        };
        folders.set(path, entry);
        childFolders.set(path, new Set());
      }

      if (!isKeep) {
        entry.fileCount += 1;
        entry.totalSize += file.size;
      }

      const previousMs = entry.modifiedAt ? new Date(entry.modifiedAt).getTime() : 0;
      if (createdAtMs > previousMs) entry.modifiedAt = file.createdAt;

      if (i < segments.length - 1) {
        childFolders.get(path)!.add(segments[i + 1]);
      }
    }
  }

  childFolders.forEach((children, path) => {
    folders.get(path)!.folderCount = children.size;
  });

  return Array.from(folders.values());
}

/**
 * What's directly inside `path`: its subfolders, and the files sitting in it.
 *
 * One level only. Flattening a folder's descendants into its own listing puts
 * files somewhere they aren't — the folder you're looking at stops matching
 * what it holds, and dragging a file "out" of a subfolder you can't see isn't
 * a thing you can do.
 */
export function getFolderContents(
  files: WorkspaceFile[],
  path: string,
): { folders: FolderEntry[]; files: FileEntry[] } {
  const prefix = path ? `${path}/` : '';
  const directFiles: FileEntry[] = [];

  for (const file of files) {
    if (prefix && !file.filename.startsWith(prefix)) continue;
    const relative = prefix ? file.filename.slice(prefix.length) : file.filename;
    const slash = relative.indexOf('/');

    if (slash === -1) {
      // `.keep` only exists to give an empty folder something to be
      if (isKeepFile(relative)) continue;
      directFiles.push({ type: 'file', file, displayName: relative });
    }
  }

  const folders = getAllFolders(files)
    .filter((folder) => dirname(folder.path) === path)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    folders,
    files: directFiles,
  };
}

/**
 * "3 folders · 12 files", or "Empty" when there's nothing to say.
 * Takes the translator so it stays a plain function usable outside render.
 */
export function describeFolder(entry: FolderEntry, t: TranslateFn): string {
  const parts: string[] = [];
  if (entry.folderCount) {
    parts.push(t('files.folderCount', { count: entry.folderCount }));
  }
  if (entry.fileCount) {
    parts.push(t('files.fileCount', { count: entry.fileCount }));
  }
  return parts.join(' · ') || t('files.folderEmptyShort');
}
