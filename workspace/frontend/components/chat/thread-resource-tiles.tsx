'use client';

import type { ReactNode } from 'react';
import { ArrowUpRight, CalendarClock, ChevronRight, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Item, ItemContent, ItemHeader, ItemTitle } from '@/components/ui/item';
import { BrowserThumbnail } from '@/components/artifacts/browser-thumbnail';
import { FileTile } from '@/components/files/file-utils';
import { tabHasFreshAgentActivity } from '@/components/browser/agent-activity';
import { useT } from '@/lib/i18n';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { projectDisplayName } from '@/lib/web-projects';
import type { BrowserTab, WorkspaceFile } from '@/lib/types';
import { WithTooltip } from '@/components/ui/with-tooltip';

/** One artifact tile in the thread shelf: a preview on top, its name below. */
export function ResourceTile({ label, hint = label, pressed, onOpen, preview }: {
  label: string;
  hint?: string;
  pressed?: boolean;
  onOpen: () => void;
  preview: ReactNode;
}) {
  return (
    <li className="w-40 shrink-0 snap-start">
      <WithTooltip label={hint}>
        <Item asChild variant="outline" size="xs" className="h-full gap-1.5 bg-background p-1.5 text-left hover:bg-muted/50 aria-pressed:bg-muted">
          <button type="button" onClick={onOpen} aria-pressed={pressed}>
            <ItemHeader>{preview}</ItemHeader>
            <ItemContent className="min-w-0 px-0.5">
              <ItemTitle className="w-full truncate text-xs">{label}</ItemTitle>
            </ItemContent>
            <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </Item>
      </WithTooltip>
    </li>
  );
}

export function BrowserResourceTile({ tab, pressed }: { tab: BrowserTab; pressed: boolean }) {
  const t = useT();
  const label = tab.title || tab.url;
  return (
    <ResourceTile label={label} pressed={pressed} onOpen={() => openArtifactPreview({ kind: 'browser', id: tab.id })} preview={
      <span className="relative flex h-16 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-muted text-muted-foreground">
        <Globe className="size-6" />
        <span className="max-w-full truncate px-2 text-xs">{tabHasFreshAgentActivity(tab) ? t('threadResources.browsing', { agent: (tab.activity?.actor || '').replace(/^openagents:/, '') }) : t('threadResources.liveBrowser')}</span>
        <BrowserThumbnail tabId={tab.id} pageUrl={tab.url} title={label} enabled={!tab.asleep} className="absolute inset-0 h-full border-0" />
      </span>
    } />
  );
}

export function LinkedBrowserResourceTile({ url }: { url: string }) {
  const t = useT();
  return (
    <ResourceTile label={t('threadLiveBrowser.shared')} hint={url} onOpen={() => openArtifactPreview({ kind: 'browser', id: url })} preview={
      <span className="flex h-16 w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Globe className="size-6" />
      </span>
    } />
  );
}

export function FileResourceTile({ file, pressed }: { file: WorkspaceFile; pressed: boolean }) {
  const label = projectDisplayName(file.filename.split('/').at(-1) || file.filename, file.contentType);
  return (
    <ResourceTile label={label} pressed={pressed} onOpen={() => openArtifactPreview({ kind: 'file', id: file.id })} preview={
      <FileTile file={file} className="h-16 w-full rounded-md shadow-none" />
    } />
  );
}

/**
 * A routine in the thread shelf: its name and when it runs (or that it is
 * paused or needs attention). Without `onOpen` it is a read-only card.
 */
export function RoutineResourceTile({ name, detail, attention = false, pressed = false, onOpen }: {
  name: string;
  /** The schedule, "Paused", or the attention note. */
  detail: string;
  attention?: boolean;
  pressed?: boolean;
  onOpen?: () => void;
}) {
  const body = <>
    <span className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"/><strong className="flex-1 text-xs font-medium">{name}</strong>{onOpen && <ChevronRight className="size-3 text-muted-foreground"/>}</span>
    <span className="mt-1.5 block text-[11px] text-muted-foreground">{attention ? <span className="text-warning">{detail}</span> : detail}</span>
  </>;
  const frame = 'w-full rounded-lg border bg-background p-2.5 text-left';
  return <li className="w-60 shrink-0 snap-start">
    {onOpen
      ? <button aria-pressed={pressed} onClick={onOpen} className={cn(frame, 'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring', pressed && 'border-ring bg-muted')}>{body}</button>
      : <div className={frame} data-routine-tile="">{body}</div>}
  </li>;
}
