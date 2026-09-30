'use client';

import { useState } from 'react';
import { Eye, EyeOff, FileCode2, Maximize2, MessageSquareReply } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  /** Existing "open in the Files pane" behaviour. */
  onOpenFull: (fileId: string) => void;
}

const PREVIEW_HEIGHT = 360;

/**
 * v1.1 M5 — an HTML artifact rendered inline, collapsed by default.
 * The iframe is sandboxed WITHOUT allow-same-origin: scripts may run (charts,
 * interactive reports) but the document cannot read the app's storage or
 * cookies, or reach the workspace API as the signed-in user.
 */
export function HtmlArtifactPreview({ fileId, filename, url, senderAgentName, onOpenFull }: HtmlArtifactPreviewProps) {
  const t = useT();
  const [open, setOpen] = useState(false);

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
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
            open ? 'border-primary/30 bg-primary/5 text-primary' : 'bg-background hover:bg-muted',
          )}
          aria-expanded={open}
        >
          {open ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {open ? t('artifact.hidePreview') : t('artifact.preview')}
        </button>
        <button
          type="button"
          onClick={() => onOpenFull(fileId)}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
          title={t('artifact.openFull')}
        >
          <Maximize2 className="size-3.5" />
          <span className="hidden sm:inline">{t('artifact.openFull')}</span>
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
      {open && (
        <div className="border-t">
          <iframe
            src={url}
            title={filename}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="block w-full border-0 bg-white"
            style={{ height: PREVIEW_HEIGHT }}
          />
          <div className="px-3 py-1 text-[10px] text-muted-foreground">{t('artifact.sandboxNote')}</div>
        </div>
      )}
    </div>
  );
}
