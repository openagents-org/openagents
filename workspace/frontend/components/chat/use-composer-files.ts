'use client';

import * as React from 'react';
import { toast } from 'sonner';

// Keep in sync with the backend's MAX_FILE_SIZE (app/config.py); nginx's
// /v1/files client_max_body_size allows extra headroom for multipart
// overhead. Oversized files would be rejected server-side anyway, so
// reject them here with immediate feedback instead.
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const FILE_ACCEPT =
  'image/*,.pdf,.txt,.md,.json,.csv,.xlsx,.xls,.doc,.docx,.ppt,.pptx,.zip,.xml,.html,.css,.js,.ts,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.sh,.yaml,.yml,.toml';

export interface PendingFile {
  file: File;
  preview?: string; // data URL for images
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * Files queued in the composer before sending: picker, paste and
 * drag-and-drop all funnel through `addFiles`.
 */
export function useComposerFiles() {
  const [pendingFiles, setPendingFiles] = React.useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragCountRef = React.useRef(0);

  const addFiles = React.useCallback((files: FileList | File[]) => {
    const newFiles: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" is too large (max 50MB)`);
        continue;
      }
      if (isImageFile(file)) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPendingFiles((prev) => prev.map((pf) =>
            pf.file === file ? { ...pf, preview: e.target?.result as string } : pf
          ));
        };
        reader.readAsDataURL(file);
      }
      newFiles.push({ file });
    }
    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = (index: number) => {
    setPendingFiles((prev) => {
      const removed = prev[index];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const clearFiles = () => setPendingFiles([]);

  // Handle paste — detect images from clipboard
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  };

  const dragHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current++;
      if (e.dataTransfer.types.includes('Files')) {
        setIsDragging(true);
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current--;
      if (dragCountRef.current === 0) {
        setIsDragging(false);
      }
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current = 0;
      setIsDragging(false);

      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
  };

  /**
   * Opens the shared file input, optionally narrowed to one kind (images).
   * The accept list is restored afterwards so the next "Attach file" is not
   * stuck on the narrowed filter.
   */
  const openFilePicker = (accept?: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept ?? FILE_ACCEPT;
    input.click();
    if (accept) {
      setTimeout(() => {
        if (fileInputRef.current) fileInputRef.current.accept = FILE_ACCEPT;
      }, 100);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = ''; // reset so same file can be selected again
    }
  };

  return {
    pendingFiles,
    removeFile,
    clearFiles,
    isDragging,
    dragHandlers,
    handlePaste,
    fileInputRef,
    openFilePicker,
    handleFileSelect,
  };
}
