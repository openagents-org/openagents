'use client';

import type { ReactNode } from 'react';
import { ArrowUpRight, Globe } from 'lucide-react';
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
function ResourceTile({ label, hint = label, pressed, onOpen, preview }: {
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
