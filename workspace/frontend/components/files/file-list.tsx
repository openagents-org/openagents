'use client';

import { useRef, useState, useMemo } from 'react';
import { Search, Upload, FolderOpen, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatSize, getFileIcon, timeAgo, basename } from './file-utils';

export function FileList() {
  const { files, selectedFileId, setSelectedFileId, uploadFile, deleteFile, currentFilePath } = useWorkspace();
  const { isMobile, openMobileDetail } = useLayout();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Flat list of all files, sorted by most recently modified
  const recentFiles = useMemo(() => {
    // Hide .keep placeholder files
    let list = files.filter((f) => !f.filename.endsWith('/.keep') && f.filename !== '.keep');
    if (search) {
      list = list.filter((f) => f.filename.toLowerCase().includes(search.toLowerCase()));
    }
    list.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    return list;
  }, [files, search]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        if (currentFilePath) {
          const renamedFile = new File([file], `${currentFilePath}/${file.name}`, { type: file.type });
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex h-12 items-center gap-1 px-2 lg:px-3 shrink-0 border-b border-border">
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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-50"
            title="Upload File"
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

      {/* Section label */}
      <div className="px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Recent Files
        </span>
      </div>

      {/* File list — flat, sorted by most recent */}
      {recentFiles.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <FolderOpen className="size-10 mx-auto opacity-30" />
            <p className="text-sm font-medium">
              {files.length === 0 ? 'No files yet' : 'No matches'}
            </p>
            <p className="text-xs">
              {files.length === 0
                ? 'Upload a file or ask an agent to create one'
                : 'Try a different search term'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-1">
          {recentFiles.map((file) => (
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
                <p className="text-[13px] font-medium truncate">{basename(file.filename)}</p>
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
          ))}
        </div>
      )}
    </div>
  );
}
