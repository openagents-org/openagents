'use client';

import { useRef, useState, useMemo, useCallback } from 'react';
import {
  Search, Upload, FolderOpen, Folder, ChevronRight, FolderPlus, Trash2,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';
import type { FileEntry } from './file-utils';
import { formatSize, getFileIconLarge, timeAgo, basename, getEntriesAtPath } from './file-utils';

/** Image thumbnail using the workspace file download URL */
function ImageThumbnail({ fileId, filename }: { fileId: string; filename: string }) {
  const [failed, setFailed] = useState(false);
  const url = workspaceApi.getFileUrl(fileId);

  if (failed) {
    return getFileIconLarge('image/', filename);
  }

  return (
    <img
      src={url}
      alt={filename}
      className="size-16 object-cover rounded-lg"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function FileGrid() {
  const {
    files, selectedFileId, setSelectedFileId, uploadFile, deleteFile,
    currentFilePath, setCurrentFilePath,
  } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPath = currentFilePath;
  const setCurrentPath = setCurrentFilePath;

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

  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/');
  }, [currentPath]);

  const navigateToFolder = useCallback((folderName: string) => {
    setCurrentPath(currentPath ? `${currentPath}/${folderName}` : folderName);
    setSearch('');
  }, [currentPath, setCurrentPath]);

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

  const handleCreateFolder = async () => {
    const name = await prompt({
      title: 'New folder',
      placeholder: 'Folder name',
      confirmText: 'Create',
    });
    if (!name?.trim()) return;
    const sanitized = name.trim().replace(/[/\\]/g, '-');
    const folderPath = currentPath ? `${currentPath}/${sanitized}` : sanitized;
    try {
      // Upload a .keep placeholder so the folder persists even when empty
      const keepFile = new File([''], `${folderPath}/.keep`, { type: 'text/plain' });
      await uploadFile(keepFile);
      toast.success(`Created folder "${sanitized}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create folder');
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
      {/* Toolbar — breadcrumbs as the title, the rest as header actions */}
      <DetailHeader
        titleInHeader
        title={
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground">
            <button
              onClick={() => navigateToBreadcrumb(-1)}
              className={cn(
                'hover:text-foreground transition-colors shrink-0 font-medium',
                !currentPath && 'text-foreground'
              )}
            >
              Files
            </button>
            {breadcrumbs.map((segment, i) => (
              <span key={i} className="flex items-center gap-0.5 shrink-0">
                <ChevronRight className="size-3.5 opacity-40" />
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
        }
      >
        {/* Search */}
        <div className="flex w-48 items-center gap-1.5 rounded-lg border border-input bg-muted/50 px-2.5 py-1.5 text-muted-foreground">
          <Search className="size-3.5 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="text-xs bg-transparent outline-none flex-1 text-foreground placeholder:text-muted-foreground"
          />
        </div>

        {/* Actions */}
        <button
          onClick={handleCreateFolder}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
          title="New Folder"
        >
          <FolderPlus className="size-4" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-50"
          title={currentPath ? `Upload to ${currentPath}` : 'Upload File'}
        >
          <Upload className="size-4" />
        </button>
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
          <div className="text-center space-y-3">
            <FolderOpen className="size-16 mx-auto opacity-20" />
            <p className="text-sm font-medium">
              {files.length === 0 ? 'No files yet' : search ? 'No matches' : 'Empty folder'}
            </p>
            <p className="text-xs max-w-[240px]">
              {files.length === 0
                ? 'Upload files or ask an agent to create one. You can also drag & drop files here.'
                : search
                ? 'Try a different search term'
                : 'Upload files here or go back'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {entries.map((entry) => {
              if (entry.type === 'folder') {
                return (
                  <button
                    key={`folder:${entry.name}`}
                    type="button"
                    onClick={() => navigateToFolder(entry.name)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-center transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60 cursor-pointer group"
                  >
                    <Folder className="size-12 text-amber-500" />
                    <span className="text-xs font-medium truncate w-full">{entry.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {entry.fileCount} {entry.fileCount === 1 ? 'item' : 'items'}
                    </span>
                  </button>
                );
              }

              const { file, displayName } = entry;
              const isImage = (file.contentType || '').startsWith('image/');
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
                    setSelectedFileId(file.id);
                    if (isMobile) openMobileDetail();
                  }}
                >
                  {/* Thumbnail or icon */}
                  <div className="size-16 flex items-center justify-center">
                    {isImage
                      ? <ImageThumbnail fileId={file.id} filename={file.filename} />
                      : getFileIconLarge(file.contentType, file.filename)
                    }
                  </div>

                  {/* Filename */}
                  <span className="text-xs font-medium truncate w-full leading-tight" title={displayName}>
                    {displayName}
                  </span>

                  {/* Metadata */}
                  <span className="text-[10px] text-muted-foreground leading-tight">
                    {formatSize(file.size)}
                    {file.createdAt && ` · ${timeAgo(file.createdAt)}`}
                  </span>

                  {/* Delete button on hover */}
                  <button
                    onClick={(e) => handleDelete(e, file.id, file.filename)}
                    className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-white/80 dark:bg-zinc-900/80 hover:bg-red-50 dark:hover:bg-red-950/50 text-muted-foreground hover:text-red-500 transition-all shadow-sm"
                    title="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
