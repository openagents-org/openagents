'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { DetailHeader } from '@/components/layout/app-header';
import { useLayout } from '@/components/layout/layout-context';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { useFileObjectUrl } from '@/hooks/use-file-object-url';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { projectDisplayName } from '@/lib/web-projects';
import { FileGrid } from './file-grid';
import { FilePreviewActions } from './file-preview-actions';
import { FilePreviewBody } from './file-preview-body';
import { basename, dirname, getFileIcon, getFileKind } from './file-utils';
import { loadStrategyFor } from './preview-load';
import { usePreviewContent } from './use-preview-content';

/* ── Preview ─────────────────────────────────────────────────────────────── */

export function FilePreview() {
  const { files, selectedFileId, deleteFile, setSelectedFileId, setCurrentFilePath } = useWorkspace();
  const { isMobile, openMobileList } = useLayout();
  const t = useT();
  const confirm = useConfirm();
  /** Whether the stages that have a metadata column are showing it. Kept here
   *  rather than per stage so the choice survives moving between files. */
  const [infoOpen, setInfoOpen] = useState(true);

  const file = files.find((f) => f.id === selectedFileId);
  const contentType = file?.contentType || '';
  const filename = file?.filename || '';
  const kind = file ? getFileKind(contentType, filename) : 'unknown';
  const strategy = file ? loadStrategyFor(kind, contentType, filename) : 'none';
  const media = useFileObjectUrl(strategy === 'url' ? file?.id : undefined);
  const sourceUrl = strategy === 'url' ? (media.url || '') : (file ? workspaceApi.getFileUrl(file.id) : '');
  // Images don't have one — the picture wants the width, and its footer says
  // everything a column would have.
  const hasInfoPanel = kind === 'audio' || kind === 'video';

  const preview = usePreviewContent(file, kind, strategy);
  const { content, blobUrl, draft, setDraft, saving, dirty, handleSave, cancelEdit } = preview;

  if (!file) {
    return selectedFileId ? (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{t('resourceLinks.unavailable')}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => setSelectedFileId(null)}>{t('files.backToFiles')}</Button>
        </EmptyContent>
      </Empty>
    ) : <FileGrid />;
  }

  const folderSegments = dirname(filename) ? dirname(filename).split('/') : [];

  /** Close the preview, optionally landing the browser in a specific folder. */
  const closePreview = (path?: string) => {
    if (path !== undefined) setCurrentFilePath(path);
    setSelectedFileId(null);
  };

  const handleDownload = () => {
    void workspaceApi.downloadFile(file.id, filename).catch(error => toast.error(error instanceof Error ? error.message : t('files.loadFailed')));
  };

  // Same confirm as the grid and list: from here a stray click would also
  // drop an unsaved markdown draft.
  const handleDelete = async () => {
    const ok = await confirm({
      title: t('files.deleteTitle'),
      description: t('files.deleteDescription', { name: basename(filename) }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFile(file.id);
      toast.success(t('files.movedToTrash', { name: basename(filename) }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('files.deleteFailed'));
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
              size="icon-sm"
              onClick={() => {
                if (isMobile) openMobileList();
                else closePreview();
              }}
              title={t('files.backToFiles')}
              aria-label={t('files.backToFiles')}
              className="me-1 shrink-0 text-muted-foreground"
            >
              <ArrowLeft />
            </Button>
            {/* The path is the way out: every segment walks back to that folder,
                so an opened file is never a dead end. It starts at the file's own
                top folder — there's no all-files listing above it to return to. */}
            {folderSegments.map((segment, i) => (
              <span key={i} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="size-3.5 opacity-40" />}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => closePreview(folderSegments.slice(0, i + 1).join('/'))}
                  className="px-1.5 text-sm font-normal text-muted-foreground"
                >
                  {segment}
                </Button>
              </span>
            ))}
            {folderSegments.length > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-40" />}
            <span className="flex min-w-0 items-center gap-1.5 px-1.5">
              {getFileIcon(contentType, filename)}
              <p className="truncate text-sm font-medium text-foreground">{projectDisplayName(basename(filename),contentType)}</p>
            </span>
          </div>
        }
      >
        <FilePreviewActions
          file={file}
          kind={kind}
          editable={kind === 'markdown' && content !== null}
          editing={draft !== null}
          saving={saving}
          dirty={dirty}
          onEdit={() => setDraft(content)}
          onCancelEdit={cancelEdit}
          onSave={handleSave}
          hasInfoPanel={hasInfoPanel}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((open) => !open)}
          onOpenInNewTab={() => window.open(blobUrl || sourceUrl, '_blank')}
          onDownload={handleDownload}
          onDelete={handleDelete}
        />
      </DetailHeader>

      {/* Content — image/video/PDF stages manage their own scrolling. */}
      <div
        className={cn(
          'flex-1',
          kind === 'image' || kind === 'video' || kind === 'pdf' || kind === 'web' || draft !== null
            ? 'overflow-hidden'
            : 'overflow-auto',
        )}
      >
        <FilePreviewBody
          file={file}
          kind={kind}
          strategy={strategy}
          sourceUrl={sourceUrl}
          media={media}
          preview={preview}
          infoOpen={infoOpen}
          onDownload={handleDownload}
        />
      </div>
    </div>
  );
}
