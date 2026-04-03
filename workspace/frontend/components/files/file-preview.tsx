'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, Trash2, Loader2, ChevronLeft } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
import { MarkdownContent } from '@/components/chat/markdown-content';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isHtmlFile(contentType: string, filename: string): boolean {
  return contentType === 'text/html' || /\.html?$/i.test(filename);
}

function isImageFile(contentType: string): boolean {
  return contentType.startsWith('image/');
}

function isMarkdownFile(contentType: string, filename: string): boolean {
  return contentType === 'text/markdown' || /\.mdx?$/i.test(filename);
}

function isTextFile(contentType: string, filename: string): boolean {
  if (isHtmlFile(contentType, filename)) return false; // HTML is handled separately
  return (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/javascript' ||
    contentType === 'application/xml' ||
    contentType === 'application/yaml' ||
    /\.(md|txt|csv|json|js|ts|tsx|jsx|py|rs|go|java|rb|c|cpp|h|sh|yaml|yml|toml|cfg|ini|log)$/i.test(filename)
  );
}

export function FilePreview() {
  const { files, selectedFileId, deleteFile, setSelectedFileId } = useWorkspace();
  const { isMobile, openMobileList } = useLayout();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const file = files.find((f) => f.id === selectedFileId);

  // Cleanup blob URLs
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  // Load file content when selection changes
  useEffect(() => {
    if (!file) {
      setContent(null);
      setBlobUrl(null);
      return;
    }

    const ct = file.contentType || '';
    const fn = file.filename || '';
    const isHtml = isHtmlFile(ct, fn);
    const isImage = isImageFile(ct);
    const isText = isTextFile(ct, fn);

    // HTML and images use the direct URL — no fetch needed
    if (isHtml) {
      setContent(null);
      const url = workspaceApi.getFileUrl(file.id);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(url);
      setLoading(false);
      return;
    }

    if (!isText && !isImage) {
      setContent(null);
      setBlobUrl(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const url = workspaceApi.getFileUrl(file.id);
    const headers: Record<string, string> = {};
    const token = (workspaceApi as unknown as { token: string }).token;
    if (token) headers['X-Workspace-Token'] = token;

    fetch(url, { headers })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        if (isImage) {
          const blob = await res.blob();
          if (!cancelled) {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            setBlobUrl(URL.createObjectURL(blob));
            setContent(null);
          }
        } else {
          const text = await res.text();
          if (!cancelled) {
            setContent(text);
            setBlobUrl(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent(null);
          setBlobUrl(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="opacity-20 mb-3">
          <FileText className="size-10" />
        </div>
        <p className="text-sm font-medium">Select a file</p>
        <p className="text-xs mt-1">Choose a file from the list to preview.</p>
      </div>
    );
  }

  const handleDownload = () => {
    const url = workspaceApi.getFileUrl(file.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    // We can't easily add headers to an <a> download, so open in new tab
    window.open(url, '_blank');
  };

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
      toast.success(`Deleted ${file.filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 lg:px-4 py-2 lg:py-3 border-b shrink-0">
        {isMobile && (
          <button
            onClick={openMobileList}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        <FileText className="size-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.filename.split('/').pop() || file.filename}</p>
          <p className="text-xs text-muted-foreground truncate">
            {file.filename.includes('/') && (
              <span className="text-muted-foreground/60">{file.filename.split('/').slice(0, -1).join('/')}/ · </span>
            )}
            {formatSize(file.size)} · {file.contentType || 'unknown'} · {(file.uploadedBy || 'unknown').replace(/^(openagents:|human:)/, '')}
          </p>
        </div>
        <button
          onClick={handleDownload}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
          title="Download"
        >
          <Download className="size-4" />
        </button>
        <button
          onClick={handleDelete}
          className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-red-500 transition-colors"
          title="Delete"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : isHtmlFile(file.contentType || '', file.filename) && blobUrl ? (
          <iframe
            src={blobUrl}
            title={file.filename}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : blobUrl && isImageFile(file.contentType || '') ? (
          <div className="flex items-center justify-center p-4 h-full">
            <img
              src={blobUrl}
              alt={file.filename}
              className="max-w-full max-h-full object-contain rounded"
            />
          </div>
        ) : content !== null && isMarkdownFile(file.contentType || '', file.filename) ? (
          <div className="p-5 max-w-3xl mx-auto text-sm">
            <MarkdownContent content={content} agentNames={[]} />
          </div>
        ) : content !== null ? (
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words text-foreground">
            {content}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <FileText className="size-8 opacity-30" />
            <p className="text-sm">Preview not available for this file type</p>
            <button
              onClick={handleDownload}
              className="text-xs text-primary hover:underline"
            >
              Download file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
