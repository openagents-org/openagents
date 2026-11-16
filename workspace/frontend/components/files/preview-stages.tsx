'use client';

import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useT } from '@/lib/i18n';
import { getFileIconLarge, getFileTypeMeta } from './file-utils';

/** Plain text and source: line numbers, no wrapping, no highlighting. */
export function TextStage({ content }: { content: string }) {
  const lines = useMemo(() => content.replace(/\n$/, '').split('\n'), [content]);

  return (
    <div className="flex min-h-full font-mono text-xs leading-5">
      <div
        aria-hidden
        className="sticky left-0 shrink-0 border-r bg-muted/30 px-2.5 py-4 text-right text-muted-foreground/60 tabular-nums select-none"
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 px-3 py-4 whitespace-pre text-foreground">
        {lines.map((line, i) => (
          <div key={i}>{line || '​'}</div>
        ))}
      </pre>
    </div>
  );
}

/** Everything we can't render in the browser — Office formats, archives,
 *  binaries. Named, typed, and one click from being downloaded. */
export function UnsupportedStage({
  filename,
  contentType,
  reason,
  onDownload,
}: {
  filename: string;
  contentType: string;
  reason?: string;
  onDownload: () => void;
}) {
  const t = useT();
  const { color, labelKey } = getFileTypeMeta(contentType, filename);

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia>
          <div
            className="flex size-20 items-center justify-center rounded-2xl"
            style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }}
          >
            {getFileIconLarge(contentType, filename)}
          </div>
        </EmptyMedia>
        <EmptyTitle>{t(labelKey)}</EmptyTitle>
        <EmptyDescription>{reason ?? t('files.cannotPreview')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download data-icon="inline-start" />
          {t('files.downloadFile')}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Markdown source on the left, the rendered result on the right — the right
 *  pane drops away where there's no room for two. */
export function MarkdownEditStage({
  draft,
  onChange,
  onSave,
}: {
  draft: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0">
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSave();
          }
        }}
        autoFocus
        spellCheck={false}
        aria-label={t('files.editMarkdown')}
        className="h-full min-w-0 flex-1 resize-none bg-transparent p-5 font-mono text-sm leading-6 text-foreground outline-none"
      />
      <div className="hidden h-full min-w-0 flex-1 overflow-auto border-l lg:block">
        <p className="px-5 pt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('files.editPreview')}</p>
        <div className="p-5 pt-2 text-sm">
          <MarkdownContent content={draft} agentNames={[]} />
        </div>
      </div>
    </div>
  );
}
