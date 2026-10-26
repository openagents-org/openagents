'use client';

import { Paperclip } from 'lucide-react';
import { AuthenticatedImage } from '@/components/files/authenticated-image';
import { resourcePath } from '@/lib/resource-link';
import type { IssueDetail } from '@/lib/types';

export function IssueAttachments({ files, workspaceId }: {
  files: NonNullable<IssueDetail['attachments']>;
  workspaceId: string;
}) {
  if (!files.length) return null;
  return <div className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
    {files.map(file => {
      const name = file.filename.split(/[\\/]/).pop() || file.filename;
      const image = file.content_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name);
      return <a key={file.file_id} href={resourcePath(workspaceId, 'files', file.file_id)} title={file.filename}
        className="group min-w-0 overflow-hidden rounded-lg border bg-background transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {image && <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border-b bg-muted/30 p-1.5">
          <AuthenticatedImage fileId={file.file_id} alt={name} loading="lazy" className="h-full w-full object-contain" />
        </div>}
        <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{name}</span>
        </div>
      </a>;
    })}
  </div>;
}
