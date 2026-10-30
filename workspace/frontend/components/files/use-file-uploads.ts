'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceFile } from '@/lib/types';

/** Keep in sync with the backend's MAX_FILE_SIZE (app/config.py). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface UploadItem {
  key: string;
  file: File;
  /** Object URL for image previews; revoked when the item goes away. */
  preview?: string;
  /** Fraction uploaded, 0–1; null until the browser can measure it. */
  progress: number | null;
  status: 'uploading' | 'failed';
  error?: 'tooLarge' | 'failed';
}

let seq = 0;

/**
 * Upload picked files one request each, so every file has its own progress,
 * cancel and retry. A finished upload leaves the list and is handed to
 * `onUploaded`; failures stay listed until retried or removed. Unmounting
 * aborts whatever is still in flight, so closing a dialog never leaves an
 * invisible upload running.
 */
export function useFileUploads(onUploaded: (file: WorkspaceFile) => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const controllers = useRef(new Map<string, AbortController>());
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const patch = (key: string, next: Partial<UploadItem>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...next } : item)));
  const drop = (key: string) =>
    setItems((list) => list.filter((item) => {
      if (item.key !== key) return true;
      if (item.preview) URL.revokeObjectURL(item.preview);
      return false;
    }));

  const start = useCallback((key: string, file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      patch(key, { status: 'failed', error: 'tooLarge' });
      return;
    }
    const controller = new AbortController();
    controllers.current.set(key, controller);
    patch(key, { status: 'uploading', error: undefined, progress: null });
    workspaceApi.uploadFile(file, undefined, {
      signal: controller.signal,
      onProgress: (fraction) => patch(key, { progress: fraction }),
    }).then((uploaded) => {
      if (controller.signal.aborted) return;
      onUploadedRef.current(uploaded);
      drop(key);
    }).catch(() => {
      if (!controller.signal.aborted) patch(key, { status: 'failed', error: 'failed' });
    }).finally(() => {
      if (controllers.current.get(key) === controller) controllers.current.delete(key);
    });
  }, []);

  const add = useCallback((list: FileList | File[]) => {
    const picked = Array.from(list).map((file) => ({
      key: `upload-${++seq}`,
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      progress: null,
      status: 'uploading' as const,
    }));
    if (!picked.length) return;
    setItems((current) => [...current, ...picked]);
    for (const item of picked) start(item.key, item.file);
  }, [start]);

  /** Cancel an upload in flight, or discard a failed one. */
  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    drop(key);
  }, []);

  const retry = useCallback((key: string) => {
    const item = itemsRef.current.find((x) => x.key === key);
    if (item && item.status === 'failed') start(key, item.file);
  }, [start]);

  const clear = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    itemsRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    setItems([]);
  }, []);

  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort();
    itemsRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
  }, []);

  return {
    items,
    uploading: items.some((item) => item.status === 'uploading'),
    add,
    remove,
    retry,
    clear,
  };
}
