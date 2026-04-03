'use client';

import { useRef, useState, useMemo, useCallback } from 'react';
import {
  Search, Upload, FolderOpen, FileText, FileCode, Image,
  File as FileIcon, Trash2, Folder, ChevronRight, FolderPlus,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WorkspaceFile } from '@/lib/types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(contentType: string | undefined, filename: string) {
  const ct = contentType || '';
  if (ct.startsWith('image/')) return <Image className="size-4 text-purple-500" />;
  if (ct.startsWith('text/') || filename.match(/\.(md|txt|csv)$/i))
    return <FileText className="size-4 text-blue-500" />;
  if (
    filename.match(/\.(js|ts|tsx|jsx|py|rs|go|java|rb|c|cpp|h|sh|yaml|yml|json|toml)$/i) ||
    ct.includes('javascript') ||
    ct.includes('json')
  )
    return <FileCode className="size-4 text-emerald-500" />;
  return <FileIcon className="size-4 text-zinc-400" />;
}

function timeAgo(dateStr: string): string {
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
function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

interface FolderEntry {
  type: 'folder';
  name: string;
  fileCount: number;
}

interface FileEntry {
  type: 'file';
  file: WorkspaceFile;
  displayName: string;
}

type ListEntry = FolderEntry | FileEntry;

/**
 * Given files and a current path, compute the folder entries and file entries
 * visible at this level.
 */
function getEntriesAtPath(files: WorkspaceFile[], currentPath: string): ListEntry[] {
  const prefix = currentPath ? currentPath + '/' : '';
  const folders = new Map<string, number>(); // folderName -> fileCount
  const fileEntries: FileEntry[] = [];

  for (const file of files) {
    const name = file.filename;
    // Only consider files that are at or below the current path
    if (prefix && !name.startsWith(prefix)) continue;

    const remainder = prefix ? name.slice(prefix.length) : name;
    const slashIdx = remainder.indexOf('/');

    if (slashIdx === -1) {
      // This file is directly at the current level
      fileEntries.push({ type: 'file', file, displayName: remainder });
    } else {
      // This file is inside a subfolder
      const folderName = remainder.slice(0, slashIdx);
      folders.set(folderName, (folders.get(folderName) || 0) + 1);
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

export function FileList() {
  const { files, selectedFileId, setSelectedFileId, uploadFile, deleteFile, refreshFiles } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When searching, show flat results across all folders; otherwise show current folder
  const entries = useMemo(() => {
    if (search) {
      const filtered = files.filter((f) => f.filename.toLowerCase().includes(search.toLowerCase()));
      return filtered.map((f): FileEntry => ({
        type: 'file',
        file: f,
        displayName: f.filename,
      }));
    }
    return getEntriesAtPath(files, currentPath);
  }, [files, currentPath, search]);

  // Breadcrumb segments
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/');
  }, [currentPath]);

  const navigateToFolder = useCallback((folderName: string) => {
    setCurrentPath((prev) => prev ? `${prev}/${folderName}` : folderName);
    setSearch('');
  }, []);

  const navigateToBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      setCurrentPath('');
    } else {
      const segments = currentPath.split('/');
      setCurrentPath(segments.slice(0, index + 1).join('/'));
    }
  }, [currentPath]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        // Prepend current folder path to filename
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

  const handleCreateFolder = () => {
    const name = prompt('Folder name:');
    if (!name?.trim()) return;
    const sanitized = name.trim().replace(/[/\\]/g, '-');
    // Navigate into the new folder — it will appear once a file is uploaded into it
    const newPath = currentPath ? `${currentPath}/${sanitized}` : sanitized;
    setCurrentPath(newPath);
    toast.success(`Opened folder "${sanitized}" — upload files here`);
  };

  const handleDelete = async (e: React.MouseEvent, fileId: string, filename: string) => {
    e.stopPropagation();
    try {
      await deleteFile(fileId);
      toast.success(`Deleted ${basename(filename)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-3 shrink-0">
        <div className="flex items-center w-full gap-1">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-input text-muted-foreground">
            <Search className="size-3.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files..."
              className="text-xs bg-transparent outline-none flex-1 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={handleCreateFolder}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
            title="New Folder"
          >
            <FolderPlus className="size-3.5" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-50"
            title={currentPath ? `Upload to ${currentPath}` : 'Upload File'}
          >
            <Upload className="size-3.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
        </div>
      </div>

      {/* Breadcrumb navigation */}
      {(currentPath || search) && !search && (
        <div className="flex items-center gap-0.5 px-3 pb-2 text-[11px] text-muted-foreground overflow-x-auto shrink-0">
          <button
            onClick={() => navigateToBreadcrumb(-1)}
            className="hover:text-foreground transition-colors shrink-0 font-medium"
          >
            Files
          </button>
          {breadcrumbs.map((segment, i) => (
            <span key={i} className="flex items-center gap-0.5 shrink-0">
              <ChevronRight className="size-3 opacity-40" />
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className={cn(
                  'hover:text-foreground transition-colors',
                  i === breadcrumbs.length - 1 && 'text-foreground font-medium'
                )}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* File/folder list */}
      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <FolderOpen className="size-10 mx-auto opacity-30" />
            <p className="text-sm font-medium">
              {files.length === 0 ? 'No files yet' : search ? 'No matches' : 'Empty folder'}
            </p>
            <p className="text-xs">
              {files.length === 0
                ? 'Upload a file or ask an agent to create one'
                : search
                ? 'Try a different search term'
                : 'Upload files here or go back'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1">
          {entries.map((entry) => {
            if (entry.type === 'folder') {
              return (
                <div
                  key={`folder:${entry.name}`}
                  onClick={() => navigateToFolder(entry.name)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors group cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <Folder className="size-4 text-amber-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">{entry.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {entry.fileCount} {entry.fileCount === 1 ? 'file' : 'files'}
                    </p>
                  </div>
                  <ChevronRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              );
            }

            const { file, displayName } = entry;
            return (
              <div
                key={file.id}
                onClick={() => {
                  setSelectedFileId(file.id);
                  if (isMobile) openMobileDetail();
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors group cursor-pointer',
                  selectedFileId === file.id
                    ? 'bg-zinc-100 dark:bg-zinc-800'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                )}
              >
                {getFileIcon(file.contentType, file.filename)}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{displayName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatSize(file.size)} · {(file.uploadedBy || 'unknown').replace(/^(openagents:|human:)/, '')}
                    {file.createdAt && ` · ${timeAgo(file.createdAt)}`}
                  </p>
                </div>
                <button
                  onClick={(e) => handleDelete(e, file.id, file.filename)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground hover:text-red-500 transition-all"
                  title="Delete"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
