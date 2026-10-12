'use client';

import { Eye, FileCode2, MessageSquareReply } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { buildRevisionPrompt } from '@/lib/brief';
import { prefillComposer } from './composer-prefill';

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
    <div className="w-full max-w-2xl overflow-hidden rounded-lg border bg-muted/40" data-html-artifact={fileId}>
      <div className="flex items-center gap-2 px-3 py-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={filename}>{filename}</span>
        <span className="hidden rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 sm:inline dark:bg-zinc-800 dark:text-zinc-400">
          {t('artifact.html')}
        </span>
        <button
          type="button"
          onClick={() => onOpenFull(fileId)}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
          title={t('artifactPanel.open')}
        >
          <Eye className="size-3.5" />
          {t('artifact.preview')}
        </button>
        <button
          type="button"
          onClick={requestRevision}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
          title={t('artifact.requestRevision')}
        >
          <MessageSquareReply className="size-3.5" />
          <span className="hidden sm:inline">{t('artifact.requestRevision')}</span>
        </button>
      </div>

    </div>
  );
}
