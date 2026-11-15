'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, workspaceApi } from '@/lib/api';
import { useFormatters, useT } from '@/lib/i18n';
import type { WorkspaceFile } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { basename, type FileKind } from './file-utils';
import { MAX_TEXT_BYTES, sha256Hex, type LoadStrategy } from './preview-load';

/**
 * The bytes a preview needs — text into state, PDFs into a blob URL — and the
 * markdown editing that rides on the text: a draft, its dirty state, and a save
 * that refuses to overwrite an edit made meanwhile.
 */
export function usePreviewContent(file: WorkspaceFile | undefined, kind: FileKind, strategy: LoadStrategy) {
  const { refreshFiles } = useWorkspace();
  const t = useT();
  const { formatFileSize } = useFormatters();
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Hash of the markdown as loaded, sent back on save so an edit made
   *  meanwhile (say, by an agent) isn't silently overwritten. */
  const [contentHash, setContentHash] = useState<string | undefined>();
  /** The text being edited; null when the file is just being viewed. */
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load whatever this kind needs — text into state, PDFs into a blob URL,
  // media straight off the download route.
  //
  // <Activity> re-runs this when Files is shown again. What it loaded is
  // still in state (and an unsaved draft with it), so a reveal of the same
  // file is a no-op: re-fetching blanked the preview to a spinner on every
  // switch back, and threw the draft away. The PDF URL is therefore revoked
  // when it's replaced, not on cleanup, which also runs on hide.
  const loadedRef = useRef<string | null>(null);
  const blobRef = useRef<string | null>(null);
  useEffect(() => {
    const loadKey = file ? `${file.id}:${strategy}` : null;
    if (loadKey && loadedRef.current === loadKey) return;
    loadedRef.current = null;
    setContent(null);
    setContentHash(undefined);
    setDraft(null);
    setError(null);
    setBlobUrl(null);

    if (!file || (strategy !== 'text' && strategy !== 'blob')) {
      setLoading(false);
      return;
    }

    if (strategy === 'text' && file.size > MAX_TEXT_BYTES) {
      setError(t('files.tooLargeToPreview', { size: formatFileSize(file.size) }));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    workspaceApi.fetchFile(file.id)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (strategy === 'text') {
          const bytes = await res.arrayBuffer();
          const text = new TextDecoder().decode(bytes);
          const hash = kind === 'markdown' ? await sha256Hex(bytes).catch(() => undefined) : undefined;
          if (!cancelled) {
            setContent(text);
            setContentHash(hash);
            loadedRef.current = loadKey;
          }
        } else {
          const data = await res.blob();
          if (cancelled) return;
          // Force the type: the browser only opens its PDF viewer when the
          // blob says application/pdf, and uploads often arrive octet-stream.
          const objectUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
          if (blobRef.current) URL.revokeObjectURL(blobRef.current);
          blobRef.current = objectUrl;
          setBlobUrl(objectUrl);
          loadedRef.current = loadKey;
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('files.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file?.id, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Release the PDF when the preview goes away. <Activity> runs this on hide
  // as well, so a PDF (unlike text, which costs nothing to keep) is fetched
  // again when Files is shown next.
  useEffect(() => () => {
    if (!blobRef.current) return;
    URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
    loadedRef.current = null;
  }, []);

  const dirty = draft !== null && draft !== content;

  // Closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const handleSave = useCallback(async () => {
    if (!file || draft === null || saving) return;
    if (!dirty) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      const saved = draft;
      await workspaceApi.updateFileContent(file.id, saved, contentHash);
      const bytes = new TextEncoder().encode(saved);
      setContent(saved);
      setContentHash(await sha256Hex(bytes.buffer as ArrayBuffer).catch(() => undefined));
      setDraft(null);
      toast.success(t('files.fileSaved', { name: basename(file.filename) }));
      void refreshFiles();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast.error(t('files.editConflict'));
      else if (err instanceof ApiError && err.status === 403) toast.error(t('files.noEditPermission'));
      else toast.error(err instanceof ApiError && err.serverMessage ? err.serverMessage : t('files.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [file, draft, saving, dirty, contentHash, refreshFiles, t]);

  const cancelEdit = () => {
    if (dirty && !window.confirm(t('files.discardEdits'))) return;
    setDraft(null);
  };

  return { content, blobUrl, loading, error, draft, setDraft, saving, dirty, handleSave, cancelEdit };
}
