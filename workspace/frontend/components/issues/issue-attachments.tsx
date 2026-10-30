'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Paperclip } from 'lucide-react';
import { AuthenticatedImage } from '@/components/files/authenticated-image';
import { VideoStage } from '@/components/files/media-stage';
import { useFileObjectUrl } from '@/hooks/use-file-object-url';
import { useT } from '@/lib/i18n';
import { resourcePath } from '@/lib/resource-link';
import type { IssueDetail } from '@/lib/types';

type Attachment = NonNullable<IssueDetail['attachments']>[number];

const isImage = (file: Attachment, name: string) =>
  file.content_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name);
const isVideo = (file: Attachment, name: string) =>
  file.content_type?.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name);

/** Plays from an authenticated blob: the Files route only knows the files in
 *  the viewer's own list, and an attachment seen through the issue is not
 *  always there, so linking out ended on "unavailable". */
function AttachmentVideo({ file }: { file: Attachment }) {
  const t = useT();
  const { url, failed } = useFileObjectUrl(file.file_id);
  if (failed) return <span className="p-3 text-xs text-muted-foreground" role="status">{t('files.loadFailed')}</span>;
  if (!url) return <span className="block h-full w-full animate-pulse bg-muted" aria-label={t('common.loading')} />;
  return <VideoStage src={url} filename={file.filename} contentType={file.content_type} size={file.size} infoOpen={false} />;
}

export function IssueAttachments({ files, workspaceId }: {
  files: NonNullable<IssueDetail['attachments']>;
  workspaceId: string;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = files.find(file => file.file_id === previewId);
  if (!files.length) return null;
  return <><div className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
    {files.map(file => {
      const name = file.filename.split(/[\\/]/).pop() || file.filename;
      const image = isImage(file, name);
      const previewable = image || isVideo(file, name);
      const cardClass ="group min-w-0 overflow-hidden rounded-lg border bg-background transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
      const content = <>
        {image && <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border-b bg-muted/30 p-1.5">
          <AuthenticatedImage fileId={file.file_id} alt={name} loading="lazy" className="h-full w-full object-contain" />
        </div>}
        <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </div>
      </>;
      return previewable
        ? <button key={file.file_id} type="button" title={file.filename} className={`${cardClass} text-left ${image ? 'cursor-zoom-in' : ''}`} onClick={() => setPreviewId(file.file_id)}>{content}</button>
        : <a key={file.file_id} href={resourcePath(workspaceId, 'files', file.file_id)} title={file.filename} className={cardClass}>{content}</a>;
    })}
  </div>
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreviewId(null); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl p-4" aria-describedby={undefined}>
        <DialogTitle className="truncate pr-8 text-sm">{preview?.filename.split(/[\\/]/).pop()}</DialogTitle>
        {preview && (isImage(preview, preview.filename)
          ? <div className="flex min-h-0 items-center justify-center overflow-auto rounded-md bg-muted/20">
            <AuthenticatedImage fileId={preview.file_id} alt={preview.filename} className="max-h-[75vh] max-w-full object-contain" />
          </div>
          : <div className="h-[70vh] min-h-0 overflow-hidden rounded-md">
            <AttachmentVideo file={preview} />
          </div>)}
      </DialogContent>
    </Dialog>
  </>;
}
