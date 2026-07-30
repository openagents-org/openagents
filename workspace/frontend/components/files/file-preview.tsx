'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  RotateCw,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FileGrid } from './file-grid';
import {
  basename,
  dirname,
  formatSize,
  getFileIcon,
  getFileIconLarge,
  getFileKind,
  getFileTypeMeta,
  type FileKind,
} from './file-utils';

/** Text we're willing to pull into the browser and lay out. Past this a
 *  preview is slower and less useful than the download button. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Rows we're willing to put in the DOM for a delimited file. */
const MAX_SHEET_ROWS = 500;

function isHtml(contentType: string, filename: string): boolean {
  return contentType === 'text/html' || /\.html?$/i.test(filename);
}

/** CSV/TSV are the only spreadsheets we can render without a parser library. */
function delimiterFor(contentType: string, filename: string): string | null {
  if (/\.tsv$/i.test(filename) || contentType === 'text/tab-separated-values') return '\t';
  if (/\.csv$/i.test(filename) || contentType === 'text/csv') return ',';
  return null;
}

/**
 * How the preview gets at a file's bytes.
 *
 * `url` hands the download route straight to an <img>/<audio>/<video>/<iframe>
 * (the URL carries the workspace token). `blob` is for PDFs: the route serves
 * them as an attachment, which makes a direct <iframe> download the file
 * instead of rendering it — a blob URL has no disposition, so the browser's
 * built-in viewer takes over.
 */
type LoadStrategy = 'text' | 'blob' | 'url' | 'none';

function loadStrategyFor(kind: FileKind, contentType: string, filename: string): LoadStrategy {
  switch (kind) {
    case 'markdown':
    case 'text':
    case 'code':
      return 'text';
    case 'sheet':
      return delimiterFor(contentType, filename) ? 'text' : 'none';
    case 'pdf':
      return 'blob';
    case 'image':
    case 'audio':
    case 'video':
      return 'url';
    case 'web':
      return isHtml(contentType, filename) ? 'url' : 'none';
    default:
      return 'none';
  }
}

/** RFC 4180-ish: quoted cells, doubled quotes, embedded newlines. */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* ── Per-kind stages ─────────────────────────────────────────────────────── */

/** Plain text and source: line numbers, no wrapping, no highlighting. */
function TextStage({ content }: { content: string }) {
  const lines = useMemo(() => content.replace(/\n$/, '').split('\n'), [content]);

  return (
    <div className="flex min-h-full font-mono text-xs leading-5">
      <div
        aria-hidden
        className="sticky left-0 shrink-0 border-r border-border/60 bg-muted/30 px-2.5 py-4 text-right text-muted-foreground/60 tabular-nums select-none"
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 px-3 py-4 whitespace-pre text-foreground">
        {lines.map((line, i) => (
          <div key={i}>{line || '​'}</div>
        ))}
      </pre>
    </div>
  );
}

/** CSV/TSV as a real table — the first row reads as a header, because in
 *  practice it always is one, and a sticky one at that. */
function SheetStage({ content, delimiter }: { content: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(content, delimiter), [content, delimiter]);
  const truncated = rows.length > MAX_SHEET_ROWS;
  const visible = truncated ? rows.slice(0, MAX_SHEET_ROWS) : rows;

  if (visible.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">This file is empty.</p>;
  }

  const [header, ...body] = visible;

  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted/70 backdrop-blur">
            <tr>
              <th className="w-10 border-b border-border px-2 py-1.5 text-right font-normal text-muted-foreground/60 tabular-nums" />
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="border-b border-l border-border px-2.5 py-1.5 text-left font-semibold whitespace-nowrap"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="hover:bg-muted/40">
                <td className="border-b border-border/60 px-2 py-1.5 text-right text-muted-foreground/50 tabular-nums select-none">
                  {r + 1}
                </td>
                {header.map((_, c) => (
                  <td
                    key={c}
                    className="max-w-70 truncate border-b border-l border-border/60 px-2.5 py-1.5"
                    title={row[c] || ''}
                  >
                    {row[c] || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          Showing the first {MAX_SHEET_ROWS} of {rows.length} rows — download the file for the rest.
        </p>
      )}
    </div>
  );
}

/** Images get the controls people reach for: zoom, rotate, fit. */
function ImageStage({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // A new file starts fresh — carrying 300% and 180° over is disorienting.
  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [src]);

  const fitted = zoom === 1 && rotation === 0;

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
          className={cn(
            'rounded shadow-sm transition-transform duration-150',
            fitted && 'max-h-full max-w-full object-contain',
          )}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/90 px-1.5 py-1 shadow-md backdrop-blur">
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            aria-label="Zoom out"
            disabled={zoom <= 0.25}
            onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}
            className="text-muted-foreground"
          >
            <ZoomOut className="size-4" />
          </Button>
          <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            aria-label="Zoom in"
            disabled={zoom >= 4}
            onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
            className="text-muted-foreground"
          >
            <ZoomIn className="size-4" />
          </Button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            aria-label="Rotate"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="text-muted-foreground"
          >
            <RotateCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            aria-label="Fit to screen"
            disabled={fitted}
            onClick={() => {
              setZoom(1);
              setRotation(0);
            }}
            className="text-muted-foreground"
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Audio has nothing to look at, so the type tile stands in for artwork. */
function AudioStage({
  src,
  filename,
  contentType,
}: {
  src: string;
  filename: string;
  contentType: string;
}) {
  const { color } = getFileTypeMeta(contentType, filename);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-border p-8">
        <div
          className="flex size-24 items-center justify-center rounded-2xl"
          style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }}
        >
          {getFileIconLarge(contentType, filename, 'size-11')}
        </div>
        <p className="max-w-full truncate text-sm font-medium" title={filename}>
          {basename(filename)}
        </p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={src} controls className="w-full" />
      </div>
    </div>
  );
}

/** Everything we can't render in the browser — Office formats, archives,
 *  binaries. Named, typed, and one click from being downloaded. */
function UnsupportedStage({
  filename,
  contentType,
  reason,
  onDownload,
}: {
  filename: string;
  contentType: string;
  reason?: string;
  onDownload: () => void;
}) {
  const { color, label } = getFileTypeMeta(contentType, filename);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div
        className="flex size-20 items-center justify-center rounded-2xl"
        style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }}
      >
        {getFileIconLarge(contentType, filename)}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {reason ?? "This format can't be previewed in the browser."}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onDownload}>
        <Download className="size-3.5" />
        Download file
      </Button>
    </div>
  );
}

/* ── Preview ─────────────────────────────────────────────────────────────── */

export function FilePreview() {
  const { files, selectedFileId, deleteFile, setSelectedFileId, setCurrentFilePath } = useWorkspace();
  const { isMobile, openMobileList } = useLayout();
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const file = files.find((f) => f.id === selectedFileId);
  const contentType = file?.contentType || '';
  const filename = file?.filename || '';
  const kind = file ? getFileKind(contentType, filename) : 'unknown';
  const strategy = file ? loadStrategyFor(kind, contentType, filename) : 'none';
  const sourceUrl = file ? workspaceApi.getFileUrl(file.id) : '';

  // Load whatever this kind needs — text into state, PDFs into a blob URL,
  // media straight off the download route.
  useEffect(() => {
    setContent(null);
    setError(null);
    setBlobUrl(null);

    if (!file || (strategy !== 'text' && strategy !== 'blob')) {
      setLoading(false);
      return;
    }

    if (strategy === 'text' && file.size > MAX_TEXT_BYTES) {
      setError(`This file is ${formatSize(file.size)} — too large to preview.`);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);

    const headers: Record<string, string> = {};
    const token = (workspaceApi as unknown as { token: string }).token;
    if (token) headers['X-Workspace-Token'] = token;

    fetch(workspaceApi.getFileUrl(file.id), { headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (strategy === 'text') {
          const text = await res.text();
          if (!cancelled) setContent(text);
        } else {
          const data = await res.blob();
          // Force the type: the browser only opens its PDF viewer when the
          // blob says application/pdf, and uploads often arrive octet-stream.
          objectUrl = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
          if (!cancelled) setBlobUrl(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this file.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file?.id, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) {
    return <FileGrid />;
  }

  const folderSegments = dirname(filename) ? dirname(filename).split('/') : [];

  /** Close the preview, optionally landing the browser in a specific folder. */
  const closePreview = (path?: string) => {
    if (path !== undefined) setCurrentFilePath(path);
    setSelectedFileId(null);
  };

  const handleDownload = () => {
    // We can't attach headers to an <a download>, so the tokenised URL opens
    // in a new tab and the route's Content-Disposition does the rest.
    window.open(sourceUrl, '_blank');
  };

  const handleDelete = async () => {
    try {
      await deleteFile(file.id);
      toast.success(`Deleted ${basename(filename)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (error) {
      return (
        <UnsupportedStage
          filename={filename}
          contentType={contentType}
          reason={error}
          onDownload={handleDownload}
        />
      );
    }

    switch (kind) {
      case 'image':
        return <ImageStage src={sourceUrl} alt={basename(filename)} />;

      case 'video':
        return (
          <div className="flex h-full items-center justify-center bg-black/90 p-4">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={sourceUrl} controls className="max-h-full max-w-full rounded" />
          </div>
        );

      case 'audio':
        return <AudioStage src={sourceUrl} filename={filename} contentType={contentType} />;

      case 'pdf':
        return blobUrl ? (
          <iframe src={blobUrl} title={basename(filename)} className="h-full w-full border-0" />
        ) : null;

      case 'web':
        if (isHtml(contentType, filename)) {
          return (
            <iframe
              src={sourceUrl}
              title={basename(filename)}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
            />
          );
        }
        return (
          <UnsupportedStage
            filename={filename}
            contentType={contentType}
            reason="This is a link, not a document."
            onDownload={handleDownload}
          />
        );

      case 'markdown':
        return content === null ? null : (
          <div className="mx-auto max-w-3xl p-5 text-sm">
            <MarkdownContent content={content} agentNames={[]} />
          </div>
        );

      case 'sheet': {
        const delimiter = delimiterFor(contentType, filename);
        if (delimiter && content !== null) {
          return <SheetStage content={content} delimiter={delimiter} />;
        }
        return (
          <UnsupportedStage
            filename={filename}
            contentType={contentType}
            reason="Excel workbooks can't be rendered in the browser — download it to open in a spreadsheet app."
            onDownload={handleDownload}
          />
        );
      }

      case 'text':
      case 'code':
        return content === null ? null : <TextStage content={content} />;

      default:
        return (
          <UnsupportedStage
            filename={filename}
            contentType={contentType}
            onDownload={handleDownload}
          />
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header — the path IS the navigation, so it has to replace the app
          header's derived title. Without `titleInHeader` the desktop header
          falls back to a plain, unclickable filename and the preview has no
          way out at all. */}
      <DetailHeader
        titleInHeader
        title={<>
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            onClick={() => {
              if (isMobile) openMobileList();
              else closePreview();
            }}
            aria-label="Back to files"
            className="shrink-0 text-muted-foreground"
          >
            <ChevronLeft className="size-5" />
          </Button>
          {/* The path is the way out: every segment walks back to that folder,
              so an opened file is never a dead end. */}
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground">
            <button
              onClick={() => closePreview('')}
              className="shrink-0 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-muted hover:text-foreground"
            >
              All files
            </button>
            {folderSegments.map((segment, i) => (
              <span key={i} className="flex shrink-0 items-center gap-0.5">
                <ChevronRight className="size-3.5 opacity-40" />
                <button
                  onClick={() => closePreview(folderSegments.slice(0, i + 1).join('/'))}
                  className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                >
                  {segment}
                </button>
              </span>
            ))}
            <ChevronRight className="size-3.5 shrink-0 opacity-40" />
            <span className="flex min-w-0 items-center gap-1.5 px-1.5">
              {getFileIcon(contentType, filename)}
              <p className="truncate text-sm font-medium text-foreground">{basename(filename)}</p>
            </span>
          </div>
        </>}
      >
        {/* File metadata — the single-line header keeps it beside the actions */}
        <span className="hidden max-w-105 truncate text-xs text-muted-foreground lg:inline">
          {formatSize(file.size)} · {getFileTypeMeta(contentType, filename).label} ·{' '}
          {(file.uploadedBy || 'unknown').replace(/^(openagents:|human:)/, '')}
        </span>
        {/* Media and PDFs are worth a full window; the pane is narrow. */}
        {(kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'web') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                onClick={() => window.open(blobUrl || sourceUrl, '_blank')}
                aria-label="Open in new tab"
                className="text-muted-foreground"
              >
                <ExternalLink className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in new tab</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={handleDownload}
              aria-label="Download"
              className="text-muted-foreground"
            >
              <Download className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={handleDelete}
              aria-label="Delete"
              className="text-muted-foreground hover:text-red-500"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      </DetailHeader>

      {/* Content — image/video/PDF stages manage their own scrolling. */}
      <div
        className={cn(
          'flex-1',
          kind === 'image' || kind === 'video' || kind === 'pdf' || kind === 'web'
            ? 'overflow-hidden'
            : 'overflow-auto',
        )}
      >
        {renderBody()}
      </div>
    </div>
  );
}
