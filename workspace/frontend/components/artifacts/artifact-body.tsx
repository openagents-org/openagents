'use client';

import { Download } from 'lucide-react';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { SheetStage, delimiterFor } from '@/components/files/sheet-stage';
import { MAX_XLSX_BYTES, isXlsx, parseXlsx, type WorkbookSheet } from '@/components/files/xlsx';
import { WorkbookView } from '@/components/files/xlsx-stage';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { WEB_PROJECT_TYPE } from '@/lib/web-projects';

/** A file's bytes, read into what the artifact viewer renders. */
export interface LoadedArtifact {
  text?: string;
  /** Blob URL for images, PDFs and anything only downloadable; the caller revokes it. */
  url?: string;
  type?: string;
  sheets?: WorkbookSheet[];
  failed?: boolean;
}

/**
 * Read a file response the way the thread's artifact viewer shows it: HTML
 * and text as text, spreadsheets parsed, everything else into a blob URL.
 * Shared by the workspace panel and the shared-thread pages.
 */
export async function readArtifactResponse(
  response: Response,
  meta: { contentType?: string | null; filename?: string | null; size?: number | null },
  signal?: AbortSignal,
): Promise<LoadedArtifact | null> {
  const type = meta.contentType || response.headers.get('content-type') || '';
  const filename = meta.filename || '';
  if (type.includes(WEB_PROJECT_TYPE)) {
    await response.body?.cancel();
    return { type: 'project' };
  }
  if (/text\/html/.test(type) || /\.html?$/i.test(filename)) {
    const text = await response.text();
    return signal?.aborted ? null : { text, type: 'html' };
  }
  if (type.startsWith('text/') || /\.(mdx?|json|csv|tsv|txt|log|ya?ml|py|js|ts|tsx|jsx|sh)$/i.test(filename)) {
    const text = await response.text();
    return signal?.aborted ? null : { text, type: /markdown/.test(type) || /\.mdx?$/i.test(filename) ? 'markdown' : type || 'text' };
  }
  if (isXlsx(type, filename) && (meta.size ?? 0) <= MAX_XLSX_BYTES) {
    const bytes = await response.arrayBuffer();
    const sheets = await parseXlsx(bytes).catch(() => null);
    if (signal?.aborted) return null;
    return sheets ? { type: 'xlsx', sheets } : { url: URL.createObjectURL(new Blob([bytes], { type })), type };
  }
  const blob = await response.blob();
  if (signal?.aborted) return null;
  return { url: URL.createObjectURL(blob), type: type || blob.type };
}

/**
 * The artifact viewer's body for loaded bytes. HTML always renders in a
 * sandboxed frame without same-origin rights.
 */
export function ArtifactBody({ loaded, filename, onDownload }: {
  loaded: LoadedArtifact;
  filename: string;
  /** Replaces the plain download link (e.g. the share pages' download button). */
  onDownload?: () => void;
}) {
  const t = useT();
  if (loaded.failed) return <p role="alert" className="p-6 text-sm text-muted-foreground">{t('artifactPanel.unavailable')}</p>;
  if (loaded.type === 'html') return <iframe title={filename || t('artifactPanel.html')} srcDoc={loaded.text} sandbox="allow-scripts" referrerPolicy="no-referrer" className="h-full w-full border-0 bg-white" data-artifact-html="" />;
  if (loaded.type === 'markdown') return <article className="h-full overflow-auto p-6"><MarkdownContent content={loaded.text || ''} agentNames={[]} /></article>;
  if (loaded.sheets) return <div className="h-full overflow-auto"><WorkbookView sheets={loaded.sheets} /></div>;
  const delimiter = loaded.text !== undefined ? delimiterFor(loaded.type || '', filename) : null;
  if (delimiter) return <div className="h-full overflow-auto"><SheetStage content={loaded.text || ''} delimiter={delimiter} /></div>;
  if (loaded.text !== undefined) return <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-5 text-sm" data-artifact-text="">{loaded.text}</pre>;
  if (loaded.type?.startsWith('image/')) return <div className="flex h-full items-center justify-center overflow-auto p-4"><img src={loaded.url} alt={filename} className="max-h-full max-w-full object-contain" /></div>;
  if (loaded.type?.includes('pdf')) return <iframe src={loaded.url} title={filename || t('artifactPanel.document')} className="h-full w-full border-0" />;
  if (onDownload) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-artifact-download="">
        <p className="text-sm text-muted-foreground">{filename}</p>
        <Button variant="outline" onClick={onDownload}><Download data-icon="inline-start" />{t('artifactPanel.download')}</Button>
      </div>
    );
  }
  return <div className="p-6"><a className="text-sm text-primary underline" href={loaded.url} download={filename}>{t('artifactPanel.download')}</a></div>;
}
