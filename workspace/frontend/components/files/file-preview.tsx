'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  PanelRight,
  Trash2,
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
import { ImageStage } from './image-stage';
import { AudioStage, VideoStage } from './media-stage';
import {
  basename,
  dirname,
  getFileIcon,
  getFileIconLarge,
  getFileKind,
  getFileTypeMeta,
  type FileKind,
} from './file-utils';
import { useFormatters, useT } from '@/lib/i18n';

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
  const t = useT();
  const rows = useMemo(() => parseDelimited(content, delimiter), [content, delimiter]);
  const truncated = rows.length > MAX_SHEET_ROWS;
  const visible = truncated ? rows.slice(0, MAX_SHEET_ROWS) : rows;

  if (visible.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">{t('files.fileEmpty')}</p>;
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
          {t('files.rowsTruncated', { shown: MAX_SHEET_ROWS, total: rows.length })}
        </p>
      )}
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
  const t = useT();
  const { color, labelKey } = getFileTypeMeta(contentType, filename);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div
        className="flex size-20 items-center justify-center rounded-2xl"
        style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }}
      >
        {getFileIconLarge(contentType, filename)}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t(labelKey)}</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          {reason ?? t('files.cannotPreview')}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onDownload}>
        <Download className="size-3.5" />
        {t('files.downloadFile')}
      </Button>
    </div>
  );
}

/* ── Preview ─────────────────────────────────────────────────────────────── */

export function FilePreview() {
  const { files, selectedFileId, deleteFile, setSelectedFileId, setCurrentFilePath } = useWorkspace();
  const { isMobile, openMobileList } = useLayout();
  const t = useT();
  const { formatFileSize } = useFormatters();
  const [content, setContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether the stages that have a metadata column are showing it. Kept here
   *  rather than per stage so the choice survives moving between files. */
  const [infoOpen, setInfoOpen] = useState(true);

  const file = files.find((f) => f.id === selectedFileId);
  const contentType = file?.contentType || '';
  const filename = file?.filename || '';
  const kind = file ? getFileKind(contentType, filename) : 'unknown';
  const strategy = file ? loadStrategyFor(kind, contentType, filename) : 'none';
  const sourceUrl = file ? workspaceApi.getFileUrl(file.id) : '';
  // Images don't have one — the picture wants the width, and its footer says
  // everything a column would have.
  const hasInfoPanel = kind === 'audio' || kind === 'video';

  /**
   * The other pictures in this file's own folder, in the order the grid shows
   * them, so the preview can step between them.
   *
   * Its own folder, not the whole workspace: the grid you opened this from was
   * a folder's contents, and "next" landing three folders away would be a
   * different set than the one you were looking at.
   */
  const imageSiblings = useMemo(() => {
    if (kind !== 'image' || !file) return [];
    const folder = dirname(filename);
    return files
      .filter(
        (candidate) =>
          dirname(candidate.filename) === folder &&
          getFileKind(candidate.contentType, candidate.filename) === 'image',
      )
      .sort((a, b) => basename(a.filename).localeCompare(basename(b.filename)));
  }, [files, file, kind, filename]);

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
      setError(t('files.tooLargeToPreview', { size: formatFileSize(file.size) }));
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
        if (!cancelled) setError(t('files.loadFailed'));
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
      toast.success(t('files.movedToTrash', { name: basename(filename) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.deleteFailed'));
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
      case 'image': {
        const position = imageSiblings.findIndex((candidate) => candidate.id === file.id);
        const step = (delta: number) => {
          // Wraps, so the last picture's "next" is the first rather than a
          // dead button at the end of every folder.
          const next = imageSiblings[(position + delta + imageSiblings.length) % imageSiblings.length];
          if (next) setSelectedFileId(next.id);
        };
        return (
          <ImageStage
            key={sourceUrl}
            src={sourceUrl}
            filename={filename}
            contentType={contentType}
            siblings={
              position >= 0
                ? {
                    position: position + 1,
                    total: imageSiblings.length,
                    onPrevious: () => step(-1),
                    onNext: () => step(1),
                  }
                : undefined
            }
          />
        );
      }

      // Keyed on the URL: the stages hold player state (playhead, volume,
      // speed, the decoded waveform) that belongs to one file, and React would
      // otherwise reuse the instance and carry it into the next one.
      case 'video':
        return (
          <VideoStage
            key={sourceUrl}
            src={sourceUrl}
            filename={filename}
            contentType={contentType}
            size={file.size}
            infoOpen={infoOpen}
          />
        );

      case 'audio':
        return (
          <AudioStage
            key={sourceUrl}
            src={sourceUrl}
            filename={filename}
            contentType={contentType}
            size={file.size}
            infoOpen={infoOpen}
          />
        );

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
        title={
          /* Same single-row shell as the grid header — back button and trail in
             one flex container, so the path sits at the same offset in both and
             opening a file doesn't nudge the title sideways. */
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground">
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={() => {
                if (isMobile) openMobileList();
                else closePreview();
              }}
              title={t('files.backToFiles')}
              aria-label={t('files.backToFiles')}
              className="mr-1 shrink-0 text-muted-foreground"
            >
              <ArrowLeft className="size-4" />
            </Button>
            {/* The path is the way out: every segment walks back to that folder,
                so an opened file is never a dead end. It starts at the file's own
                top folder — there's no all-files listing above it to return to. */}
            {folderSegments.map((segment, i) => (
              <span key={i} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="size-3.5 opacity-40" />}
                <button
                  onClick={() => closePreview(folderSegments.slice(0, i + 1).join('/'))}
                  className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
                >
                  {segment}
                </button>
              </span>
            ))}
            {folderSegments.length > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-40" />}
            <span className="flex min-w-0 items-center gap-1.5 px-1.5">
              {getFileIcon(contentType, filename)}
              <p className="truncate text-sm font-medium text-foreground">{basename(filename)}</p>
            </span>
          </div>
        }
      >
        {/* File metadata — the single-line header keeps it beside the actions */}
        <span className="hidden max-w-105 truncate text-xs text-muted-foreground lg:inline">
          {formatFileSize(file.size)} · {t(getFileTypeMeta(contentType, filename).labelKey)} ·{' '}
          {(file.uploadedBy || 'unknown').replace(/^(openagents:|human:)/, '')}
        </span>
        {/* Only the stages that have a metadata column get the switch, and only
            at the width where that column exists — a toggle for something the
            viewport has already hidden is a button that does nothing. */}
        {hasInfoPanel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                onClick={() => setInfoOpen((open) => !open)}
                aria-label={infoOpen ? t('files.hideFileInfo') : t('files.showFileInfo')}
                aria-pressed={infoOpen}
                className={cn(
                  'hidden xl:inline-flex',
                  infoOpen ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <PanelRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{infoOpen ? t('files.hideFileInfo') : t('files.showFileInfo')}</TooltipContent>
          </Tooltip>
        )}
        {/* Media and PDFs are worth a full window; the pane is narrow. */}
        {(kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'web') && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                mode="icon"
                size="sm"
                onClick={() => window.open(blobUrl || sourceUrl, '_blank')}
                aria-label={t('files.openInNewTab')}
                className="text-muted-foreground"
              >
                <ExternalLink className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('files.openInNewTab')}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={handleDownload}
              aria-label={t('common.download')}
              className="text-muted-foreground"
            >
              <Download className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.download')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={handleDelete}
              aria-label={t('common.delete')}
              className="text-muted-foreground hover:text-red-500"
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.delete')}</TooltipContent>
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
