import { FileText, FileCode, Image, File as FileIcon } from 'lucide-react';
import type { WorkspaceFile } from '@/lib/types';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIcon(contentType: string | undefined, filename: string) {
  const ct = contentType || '';
  if (ct.startsWith('image/')) return <Image className="size-4 text-purple-500" />;
  if (ct.startsWith('text/') || filename.match(/\.(md|txt|csv)$/i))
    return <FileText className="size-4 text-foreground/70" />;
  if (
    filename.match(/\.(js|ts|tsx|jsx|py|rs|go|java|rb|c|cpp|h|sh|yaml|yml|json|toml)$/i) ||
    ct.includes('javascript') ||
    ct.includes('json')
  )
    return <FileCode className="size-4 text-emerald-500" />;
  return <FileIcon className="size-4 text-zinc-400" />;
}

/** Larger icons for the grid view */
export function getFileIconLarge(contentType: string | undefined, filename: string) {
  const ct = contentType || '';
  if (ct.startsWith('image/')) return <Image className="size-10 text-purple-500" />;
  if (ct.startsWith('text/') || filename.match(/\.(md|txt|csv)$/i))
    return <FileText className="size-10 text-foreground/70" />;
  if (
    filename.match(/\.(js|ts|tsx|jsx|py|rs|go|java|rb|c|cpp|h|sh|yaml|yml|json|toml)$/i) ||
    ct.includes('javascript') ||
    ct.includes('json')
  )
    return <FileCode className="size-10 text-emerald-500" />;
  return <FileIcon className="size-10 text-zinc-400" />;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Get the basename of a path (last segment after /) */
export function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export interface FolderEntry {
  type: 'folder';
  name: string;
  fileCount: number;
}

export interface FileEntry {
  type: 'file';
  file: WorkspaceFile;
  displayName: string;
}

export type ListEntry = FolderEntry | FileEntry;

/**
 * Given files and a current path, compute the folder entries and file entries
 * visible at this level.
 */
export function getEntriesAtPath(files: WorkspaceFile[], currentPath: string): ListEntry[] {
  const prefix = currentPath ? currentPath + '/' : '';
  const folders = new Map<string, number>(); // folderName -> fileCount (excluding .keep)
  const fileEntries: FileEntry[] = [];

  for (const file of files) {
    const name = file.filename;
    // Only consider files that are at or below the current path
    if (prefix && !name.startsWith(prefix)) continue;

    const remainder = prefix ? name.slice(prefix.length) : name;
    const slashIdx = remainder.indexOf('/');

    if (slashIdx === -1) {
      // Hide .keep placeholder files
      if (remainder === '.keep') continue;
      // This file is directly at the current level
      fileEntries.push({ type: 'file', file, displayName: remainder });
    } else {
      // This file is inside a subfolder
      const folderName = remainder.slice(0, slashIdx);
      // Don't count .keep files toward the visible file count
      const rest = remainder.slice(slashIdx + 1);
      const isOnlyKeep = rest === '.keep' && !rest.includes('/');
      folders.set(folderName, (folders.get(folderName) || 0) + (isOnlyKeep ? 0 : 1));
    }
  }

  const entries: ListEntry[] = [];

  // Folders first, sorted alphabetically
  const sortedFolders = Array.from(folders.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, count] of sortedFolders) {
    entries.push({ type: 'folder', name, fileCount: count });
  }

  // Then files, sorted alphabetically
  fileEntries.sort((a, b) => a.displayName.localeCompare(b.displayName));
  entries.push(...fileEntries);

  return entries;
}
