'use client';

import { useCallback, useMemo } from 'react';
import { Download, Eye, FileIcon, Folder } from 'lucide-react';
import { toast } from 'sonner';
import { isWebProject, projectDisplayName } from '@/lib/web-projects';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { AuthenticatedImage } from '@/components/files/authenticated-image';
import { Attachment, AttachmentContent, AttachmentGroup, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from '@/components/ui/attachment';
import { workspaceApi } from '@/lib/api';
import { isHtmlAttachment } from '@/lib/brief';
import { HtmlArtifactPreview } from './html-artifact-preview';

export interface MessageAttachment {
  fileId: string;
  filename: string;
  contentType: string;
  url: string;
}

function isPreviewable(contentType: string, filename: string): boolean {
  if (isWebProject(contentType, filename) || /\.docx$/i.test(filename)) return true;
  if (contentType?.startsWith('image/')) return true;
  if (contentType === 'text/html' || /\.html?$/i.test(filename)) return true;
  if (contentType === 'text/markdown' || /\.mdx?$/i.test(filename)) return true;
  if (contentType?.startsWith('text/') || /\.(json|js|ts|tsx|jsx|py|rs|go|java|rb|sh|yaml|yml)$/i.test(filename)) return true;
  return false;
}

/** Normalises the loose attachment records stored in message metadata. */
export function attachmentsFromMetadata(metadata: Record<string, unknown> | undefined): MessageAttachment[] {
  const raw = (metadata?.attachments as Record<string, unknown>[]) || [];
  return raw.map((a) => ({
    fileId: (a.fileId || a.file_id || '') as string,
    filename: (a.filename || '') as string,
    contentType: (a.contentType || a.content_type || '') as string,
    url: '',
  }));
}

export function MessageAttachments({ items, senderAgentName = null }: { items: MessageAttachment[]; senderAgentName?: string | null }) {
  const openPreview = useCallback((fileId: string) => {
    openArtifactPreview({ kind: 'file', id: fileId });
  }, []);

  // Regenerate URLs from fileId to ensure they include current auth token
  const fixedItems = useMemo(() =>
    (items || []).map((a) => ({ ...a, url: workspaceApi.getFileUrl(a.fileId) })),
    [items]
  );
  if (fixedItems.length === 0) return null;

  const images = fixedItems.filter((a) => a.contentType?.startsWith('image/'));
  // v1.1 M5: HTML artifacts get an inline sandboxed preview card instead of
  // a chip that only opens the Files pane.
  const htmlFiles = fixedItems.filter((a) => !a.contentType?.startsWith('image/') && isHtmlAttachment(a.contentType, a.filename));
  const files = fixedItems.filter((a) => !a.contentType?.startsWith('image/') && !isHtmlAttachment(a.contentType, a.filename));

  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img) => (
            <button
              key={img.fileId}
              type="button"
              onClick={() => openPreview(img.fileId)}
              aria-label={img.filename}
              className="block max-w-sm overflow-hidden rounded-lg border text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <AuthenticatedImage
                fileId={img.fileId}
                alt={img.filename}
                className="max-h-64 w-auto object-contain"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      {htmlFiles.length > 0 && (
        <div className="flex flex-col gap-2">
          {htmlFiles.map((file) => (
            <HtmlArtifactPreview
              key={file.fileId}
              fileId={file.fileId}
              filename={file.filename}
              url={file.url}
              senderAgentName={senderAgentName}
              onOpenFull={openPreview}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <AttachmentGroup>
          {files.map((file) => {
            const name = projectDisplayName(file.filename, file.contentType);
            const previewable = isPreviewable(file.contentType, file.filename);
            const download = () => void workspaceApi.downloadFile(file.fileId, file.filename)
              .catch(error => toast.error(error instanceof Error ? error.message : 'Download failed'));
            return (
              <Attachment key={file.fileId} size="sm" className="max-w-64">
                <AttachmentTrigger aria-label={name} onClick={previewable ? () => openPreview(file.fileId) : download} />
                <AttachmentMedia>
                  {previewable
                    ? (isWebProject(file.contentType, file.filename) ? <Folder /> : <Eye />)
                    : <FileIcon />}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle title={name}>{name}</AttachmentTitle>
                </AttachmentContent>
                {!previewable && <Download aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />}
              </Attachment>
            );
          })}
        </AttachmentGroup>
      )}
    </div>
  );
}
