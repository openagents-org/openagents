'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { workspaceApi } from '@/lib/api';

/**
 * A file on its way up, as the grid draws it.
 *
 * The point of the record is that the file is on screen from the moment it's
 * dropped — as its own tile, with its own progress — instead of appearing only
 * once the server has it. Everything the tile needs is here, so the grid never
 * has to reach for the `File` itself.
 */
export interface PendingUpload {
  id: string;
  /** Folder it's landing in, so the grid only shows the ones you're looking at. */
  folder: string;
  /** Basename, without the folder prefix the API reads off the filename. */
  name: string;
  size: number;
  contentType: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  /** 0–1. Stays 0 until the browser reports the first chunk. */
  progress: number;
  error?: string;
  /** Object URL for images — the tile can show the actual picture straight
   *  from disk, so what you dropped is what you see going up. */
  previewUrl?: string;
}

/** Uploads run one at a time: a dozen parallel POSTs make every bar crawl at
 *  once, and a queue where one file finishes is easier to read than twelve
 *  that are all half done. */
let uploadSeq = 0;

export interface UploadQueue {
  uploads: PendingUpload[];
  /** Queue a batch into `folder`; returns as soon as they're on screen. */
  enqueueUploads: (files: File[], folder: string) => void;
  retryUpload: (id: string) => void;
  /** Abort if it's in flight, and drop the tile either way. */
  cancelUpload: (id: string) => void;
}

/**
 * The upload queue behind the Files grid.
 *
 * Lives in the workspace provider rather than the grid so that navigating to
 * another folder — or another section entirely — doesn't cancel an upload
 * that's halfway up.
 *
 * `onUploaded` refetches the file list; it runs once per batch rather than per
 * file, and the finished stand-ins are only dropped after it resolves, so a
 * tile is never briefly absent between "uploaded" and "listed".
 */
export function useUploadQueue(onUploaded: () => Promise<void>): UploadQueue {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);

  // The queue itself is refs: it's a worker's bookkeeping, and re-rendering on
  // every step of it would just be noise.
  const queueRef = useRef<string[]>([]);
  const filesRef = useRef(new Map<string, File>());
  const previewsRef = useRef(new Map<string, string>());
  const abortsRef = useRef(new Map<string, AbortController>());
  const runningRef = useRef(false);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const patch = useCallback((id: string, updates: Partial<PendingUpload>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...updates } : u)));
  }, []);

  const forget = useCallback((id: string) => {
    const preview = previewsRef.current.get(id);
    if (preview) {
      URL.revokeObjectURL(preview);
      previewsRef.current.delete(id);
    }
    filesRef.current.delete(id);
    abortsRef.current.delete(id);
    queueRef.current = queueRef.current.filter((queued) => queued !== id);
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      // Outer loop: anything queued while the refetch was running gets picked
      // up here rather than sitting for the next drop to notice it.
      while (queueRef.current.length > 0) {
        while (queueRef.current.length > 0) {
          const id = queueRef.current.shift()!;
          const file = filesRef.current.get(id);
          if (!file) continue;

          const controller = new AbortController();
          abortsRef.current.set(id, controller);
          patch(id, { status: 'uploading', progress: 0, error: undefined });

          try {
            await workspaceApi.uploadFile(file, undefined, {
              signal: controller.signal,
              onProgress: (fraction) => patch(id, { progress: fraction }),
            });
            // Held at 'done' rather than removed: the real row isn't listed
            // until the refetch below, and the tile shouldn't blink out
            // in between.
            patch(id, { status: 'done', progress: 1 });
          } catch (err) {
            if (controller.signal.aborted) continue; // cancelUpload already tidied up
            const message = err instanceof Error ? err.message : 'Upload failed';
            patch(id, { status: 'error', error: message });
            // The tile carries the failure and the retry, but only for whoever
            // is looking at that folder — a toast is what reaches you if you
            // walked away while it was going up.
            toast.error(`Couldn't upload ${file.name.split('/').pop()}`, {
              description: message,
            });
          } finally {
            abortsRef.current.delete(id);
          }
        }

        await onUploadedRef.current();
        setUploads((prev) =>
          prev.filter((u) => {
            if (u.status !== 'done') return true;
            forget(u.id);
            return false;
          }),
        );
      }
    } finally {
      runningRef.current = false;
    }
  }, [patch, forget]);

  const enqueueUploads = useCallback((files: File[], folder: string) => {
    if (files.length === 0) return;

    const records = files.map((file): PendingUpload => {
      const id = `upload-${++uploadSeq}`;
      // The folder rides along as part of the name; the API reads it back off
      // the prefix, the same way the grid does.
      filesRef.current.set(
        id,
        folder ? new File([file], `${folder}/${file.name}`, { type: file.type }) : file,
      );
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previewsRef.current.set(id, previewUrl);
      return {
        id,
        folder,
        name: file.name,
        size: file.size,
        contentType: file.type,
        status: 'queued',
        progress: 0,
        previewUrl,
      };
    });

    setUploads((prev) => [...prev, ...records]);
    queueRef.current.push(...records.map((r) => r.id));
    void pump();
  }, [pump]);

  const retryUpload = useCallback((id: string) => {
    if (!filesRef.current.has(id)) return;
    patch(id, { status: 'queued', progress: 0, error: undefined });
    if (!queueRef.current.includes(id)) queueRef.current.push(id);
    void pump();
  }, [patch, pump]);

  const cancelUpload = useCallback((id: string) => {
    abortsRef.current.get(id)?.abort();
    setUploads((prev) => prev.filter((u) => u.id !== id));
    forget(id);
  }, [forget]);

  // Object URLs outlive the component unless they're handed back.
  useEffect(() => {
    const previews = previewsRef.current;
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
      previews.clear();
    };
  }, []);

  return { uploads, enqueueUploads, retryUpload, cancelUpload };
}
