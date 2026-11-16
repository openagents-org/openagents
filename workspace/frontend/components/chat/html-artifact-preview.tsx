'use client';

import { Eye, FileCode2, MessageSquareReply } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { buildRevisionPrompt } from '@/lib/brief';
import { prefillComposer } from './composer-prefill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Attachment, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle } from '@/components/ui/attachment';

interface HtmlArtifactPreviewProps {
  fileId: string;
  filename: string;
  /** The same download URL the Files pane uses (carries the workspace token). */
  url: string;
  /** Agent that posted the message, or null for a human upload. */
  senderAgentName: string | null;
  /** Open this artifact in the thread preview panel. */
  onOpenFull: (fileId: string) => void;
}

/** Open HTML outputs alongside the conversation; rendering lives in ArtifactContent. */
export function HtmlArtifactPreview({ fileId, filename, senderAgentName, onOpenFull }: HtmlArtifactPreviewProps) {
  const t = useT();

  const requestRevision = () => {
    prefillComposer(buildRevisionPrompt(senderAgentName, filename));
  };

  return (
    <Attachment className="w-full max-w-2xl" data-html-artifact={fileId}>
      <AttachmentMedia>
        <FileCode2 />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle title={filename}>{filename}</AttachmentTitle>
      </AttachmentContent>
      <Badge variant="secondary" className="hidden sm:inline-flex">{t('artifact.html')}</Badge>
      <AttachmentActions className="gap-1">
        <Button variant="outline" size="xs" onClick={() => onOpenFull(fileId)} title={t('artifactPanel.open')}>
          <Eye data-icon="inline-start" />
          {t('artifact.preview')}
        </Button>
        <Button variant="outline" size="xs" onClick={requestRevision} title={t('artifact.requestRevision')} aria-label={t('artifact.requestRevision')}>
          <MessageSquareReply data-icon="inline-start" />
          <span className="hidden sm:inline">{t('artifact.requestRevision')}</span>
        </Button>
      </AttachmentActions>
    </Attachment>
  );
}
