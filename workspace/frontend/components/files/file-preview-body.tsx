'use client';

import { useMemo } from 'react';
import { ProjectPreview } from '@/components/artifacts/project-preview';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import type { WorkspaceFile } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { WEB_PROJECT_TYPE, projectDisplayName } from '@/lib/web-projects';
import { DocxStage } from './docx-stage';
import { basename, dirname, getFileKind, type FileKind } from './file-utils';
import { ImageStage } from './image-stage';
import { AudioStage, VideoStage } from './media-stage';
import { isHtml, type LoadStrategy } from './preview-load';
import { MarkdownEditStage, TextStage, UnsupportedStage } from './preview-stages';
import { SheetStage, delimiterFor } from './sheet-stage';
import type { usePreviewContent } from './use-preview-content';

/** The stage for an open file — whichever renderer its kind calls for. */
export function FilePreviewBody({
  file,
  kind,
  strategy,
  sourceUrl,
  media,
  preview,
  infoOpen,
  onDownload: handleDownload,
}: {
  file: WorkspaceFile;
  kind: FileKind;
  strategy: LoadStrategy;
  sourceUrl: string;
  media: { url?: string | null; failed?: boolean };
  preview: ReturnType<typeof usePreviewContent>;
  infoOpen: boolean;
  onDownload: () => void;
}) {
  const { files, setSelectedFileId } = useWorkspace();
  const t = useT();
  const { contentType, filename } = file;
  const { content, blobUrl, loading, error, draft, setDraft, handleSave } = preview;

  /**
   * The other pictures in this file's own folder, in the order the grid shows
   * them, so the preview can step between them.
   *
   * Its own folder, not the whole workspace: the grid you opened this from was
   * a folder's contents, and "next" landing three folders away would be a
   * different set than the one you were looking at.
   */
  const imageSiblings = useMemo(() => {
    if (kind !== 'image') return [];
    const folder = dirname(filename);
    return files
      .filter(
        (candidate) =>
          dirname(candidate.filename) === folder &&
          getFileKind(candidate.contentType, candidate.filename) === 'image',
      )
      .sort((a, b) => basename(a.filename).localeCompare(basename(b.filename)));
  }, [files, kind, filename]);

  if (contentType === WEB_PROJECT_TYPE) return <ProjectPreview id={file.id} />;
  if (loading || (strategy === 'url' && !media.url && !media.failed)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (error || (strategy === 'url' && media.failed)) {
    return (
      <UnsupportedStage
        filename={filename}
        contentType={contentType}
        reason={error || t('files.loadFailed')}
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

    case 'doc':
      if (/\.docx$/i.test(filename)) return <DocxStage key={file.id} fileId={file.id} filename={basename(filename)} size={file.size} onDownload={handleDownload} />;
      return <UnsupportedStage filename={filename} contentType={contentType} onDownload={handleDownload} />;

    case 'pdf':
      return blobUrl ? (
        <iframe src={blobUrl} title={projectDisplayName(basename(filename),contentType)} className="h-full w-full border-0" />
      ) : null;

    case 'web':
      if (isHtml(contentType, filename)) {
        return (
          <iframe
            src={sourceUrl}
            title={projectDisplayName(basename(filename),contentType)}
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
      if (content === null) return null;
      if (draft !== null) return <MarkdownEditStage draft={draft} onChange={setDraft} onSave={handleSave} />;
      return (
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
}
