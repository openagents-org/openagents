'use client';

import { FileIcon, X } from 'lucide-react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { useFormatters, useT } from '@/lib/i18n';
import type { PendingFile } from './use-composer-files';

/**
 * Files queued in the composer. They upload when the message is sent, so each
 * one is shown as ready (`done`) until then.
 */
export function ComposerAttachments({ files, onRemove }: { files: PendingFile[]; onRemove: (index: number) => void }) {
  const t = useT();
  const { formatFileSize } = useFormatters();
  return (
    <AttachmentGroup className="w-full">
      {files.map((pf, i) => (
        <Attachment key={i} size="sm" className="max-w-60">
          {pf.preview ? (
            <AttachmentMedia variant="image">
              <img src={pf.preview} alt={pf.file.name} />
            </AttachmentMedia>
          ) : (
            <AttachmentMedia>
              <FileIcon />
            </AttachmentMedia>
          )}
          <AttachmentContent>
            <AttachmentTitle>{pf.file.name}</AttachmentTitle>
            <AttachmentDescription>{formatFileSize(pf.file.size)}</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label={`${t('common.remove')} ${pf.file.name}`} title={t('common.remove')} onClick={() => onRemove(i)}>
              <X />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}
