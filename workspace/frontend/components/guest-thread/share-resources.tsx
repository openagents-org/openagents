'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CalendarClock, ChevronDown, Download, ExternalLink, Eye, EyeOff, Globe, Layers, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { ArtifactBody, readArtifactResponse, type LoadedArtifact } from '@/components/artifacts/artifact-body';
import { ScreenshotThumbnail } from '@/components/artifacts/browser-thumbnail';
import type { AttachmentSource, MessageAttachment } from '@/components/chat/message-attachments';
import { RESOURCE_ROW, ResourceShelf } from '@/components/chat/thread-resource-shelf';
import { ResourceTile, RoutineResourceTile } from '@/components/chat/thread-resource-tiles';
import { useDragScroll } from '@/components/chat/use-drag-scroll';
import { canThumbnail, FileTypeTile } from '@/components/files/file-tiles';
import { getFileIcon } from '@/components/files/file-utils';
import { useRoutineFormat } from '@/components/routines/use-routine-format';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { TabsContent } from '@/components/ui/tabs';
import { WithTooltip } from '@/components/ui/with-tooltip';
import type { GuestThreadAgent } from '@/lib/guest-thread-api';
import { agentDisplayName, agentTypeLabel } from '@/lib/guest-thread';
import { useT } from '@/lib/i18n';
import { artifactCount, routineForFormat, type ShareBrowser, type ShareFile, type ShareResourceSource, type ShareResources } from '@/lib/share-resources';
import { cn } from '@/lib/utils';
import { useShareFileUrl } from './use-share-resources';

/** What the artifact viewer has open. Attachments may not be in the shelf, so the file carries its own name and type. */
export type ShareSelection =
  | { kind: 'file'; id: string; name: string; contentType: string; size?: number }
  | { kind: 'browser'; id: string; title: string; url: string };

export function fileSelection(file: Pick<ShareFile, 'id' | 'name' | 'contentType' | 'size'>): ShareSelection {
  return { kind: 'file', id: file.id, name: file.name, contentType: file.contentType, size: file.size };
}

/** An image from the thread, fetched with the link's credentials into a blob URL. */
export function ShareImage({ source, fileId, alt, className, onFailed }: {
  source: ShareResourceSource;
  fileId: string;
  alt: string;
  className?: string;
  onFailed?: () => void;
}) {
  const { url, failed } = useShareFileUrl(source, fileId);
  useEffect(() => { if (failed) onFailed?.(); }, [failed, onFailed]);
  if (failed) return null;
  if (!url) return <span className={cn('block h-20 w-32 animate-pulse rounded bg-muted', className)} aria-label={alt} role="img" />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}

/** Download one of the thread's files under its own name. */
export async function downloadShareFile(source: ShareResourceSource, fileId: string, filename: string) {
  const res = await source.fetchFile(fileId);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Message attachments on a share page: link-scoped bytes, opened in the share viewer. */
export function shareAttachmentSource(source: ShareResourceSource, open: (selection: ShareSelection) => void): AttachmentSource {
  return {
    image: (item: MessageAttachment, props) => <ShareImage source={source} fileId={item.fileId} alt={props.alt} className={props.className} />,
    open: (item) => open({ kind: 'file', id: item.fileId, name: item.filename, contentType: item.contentType }),
    download: (item) => { void downloadShareFile(source, item.fileId, item.filename).catch(() => {}); },
    readOnly: true,
  };
}

// ── Tiles ──

function ShareFileTile({ file, source, pressed, onOpen }: { file: ShareFile; source: ShareResourceSource; pressed: boolean; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const thumb = !broken && canThumbnail({ id: file.id, filename: file.path || file.name, contentType: file.contentType, size: file.size });
  return (
    <ResourceTile label={file.name} hint={file.path || file.name} pressed={pressed} onOpen={onOpen} preview={
      thumb
        ? <span className="block h-16 w-full overflow-hidden rounded-md border border-border/70 bg-muted"><ShareImage source={source} fileId={file.id} alt="" className="size-full object-cover" onFailed={() => setBroken(true)} /></span>
        : <FileTypeTile contentType={file.contentType} filename={file.name} className="h-16 w-full rounded-md shadow-none" />
    } />
  );
}

function ShareBrowserTile({ tab, source, pressed, onOpen }: { tab: ShareBrowser; source: ShareResourceSource; pressed: boolean; onOpen: () => void }) {
  const t = useT();
  const label = tab.title || tab.url;
  return (
    <ResourceTile label={label} hint={tab.url} pressed={pressed} onOpen={onOpen} preview={
      <span className="relative flex h-16 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md bg-muted text-muted-foreground">
        <Globe className="size-6" />
        <span className="max-w-full truncate px-2 text-xs">{t('threadResources.liveBrowser')}</span>
        <ScreenshotThumbnail cacheKey={`${source.key}:${tab.id}:${tab.url}`} fetchScreenshot={(signal) => source.fetchScreenshot(tab.id, signal)}
          title={label} enabled className="absolute inset-0 h-full border-0" />
      </span>
    } />
  );
}

/**
 * The workspace's thread shelf for a shared thread: artifacts (files and
 * browser sessions), the thread's agents, and its routines, read-only.
 * Hidden while the thread has no artifacts or routines (its agents are
 * already in the header and sidebar).
 */
export function ShareResourceShelf({ resources, agents, source, selected, onOpen }: {
  resources: ShareResources;
  agents: GuestThreadAgent[];
  source: ShareResourceSource;
  selected: ShareSelection | null;
  onOpen: (selection: ShareSelection) => void;
}) {
  const t = useT();
  const { formatSchedule } = useRoutineFormat();
  const [section, setSection] = useState('artifacts');
  const [collapsed, setCollapsed] = useState(false);
  const artifactDrag = useDragScroll();
  const agentDrag = useDragScroll();
  const artifactRow = useRef<HTMLUListElement>(null);
  const agentRow = useRef<HTMLUListElement>(null);
  const routineRow = useRef<HTMLUListElement>(null);
  const artifacts = artifactCount(resources);
  const routines = resources.routines;
  if (!artifacts && !routines.length) return null;

  const active = section === 'routines' && routines.length ? 'routines' : section === 'agents' && agents.length ? 'agents' : artifacts ? 'artifacts' : routines.length ? 'routines' : 'agents';
  const count = active === 'routines' ? routines.length : active === 'agents' ? agents.length : artifacts;
  const scroll = (direction: number) => (active === 'routines' ? routineRow : active === 'agents' ? agentRow : artifactRow).current?.scrollBy({ left: direction * 336, behavior: 'smooth' });
  const tabs = [
    { value: 'artifacts', label: t('artifactPanel.title'), icon: <Layers />, count: artifacts },
    ...(agents.length ? [{ value: 'agents', label: t('threadResources.agents'), icon: <Bot />, count: agents.length }] : []),
    ...(routines.length ? [{ value: 'routines', label: t('routines.title'), icon: <CalendarClock />, count: routines.length }] : []),
  ];
  return (
    <div data-share-resources="">
      <ResourceShelf tabs={tabs} active={active} onActiveChange={setSection} collapsed={collapsed} onCollapsedChange={setCollapsed} showArrows={count > 1} onScroll={scroll}>
        <TabsContent value="artifacts" className="mt-0 min-w-0">
          <ul {...artifactDrag} ref={artifactRow} aria-label={t('artifactPanel.title')} className={RESOURCE_ROW}>
            {resources.browsers.map((tab) => (
              <ShareBrowserTile key={tab.id} tab={tab} source={source} pressed={selected?.kind === 'browser' && selected.id === tab.id}
                onOpen={() => onOpen({ kind: 'browser', id: tab.id, title: tab.title, url: tab.url })} />
            ))}
            {resources.files.map((file) => (
              <ShareFileTile key={file.id} file={file} source={source} pressed={selected?.kind === 'file' && selected.id === file.id} onOpen={() => onOpen(fileSelection(file))} />
            ))}
          </ul>
          {!artifacts && <p className="py-2 text-xs text-muted-foreground">{t('threadResources.empty')}</p>}
        </TabsContent>
        <TabsContent value="agents" className="mt-0 min-w-0">
          <ul {...agentDrag} ref={agentRow} aria-label={t('threadResources.agents')} className={RESOURCE_ROW}>
            {agents.map((agent) => (
              <li key={agent.name} className="flex w-64 shrink-0 snap-start items-center gap-2 rounded-lg border bg-background p-2" data-agent-tile={agent.name}>
                <span className="shrink-0"><AgentAvatar name={agent.name} size={28} status={agent.online ? 'online' : 'offline'} showStatus /></span>
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="block truncate text-xs font-medium leading-4">{agentDisplayName(agent)}</span>
                  <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">{[agent.broughtBy ? t('jamAgents.broughtBy', { name: agent.broughtBy }) : null, agentTypeLabel(agent.type), agent.online ? t('guestThread.online') : t('guestThread.offline')].filter(Boolean).join(' · ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent value="routines" className="mt-0 min-w-0">
          <ul ref={routineRow} className={RESOURCE_ROW} aria-label={t('routines.title')}>
            {routines.map((r) => (
              <RoutineResourceTile key={r.id} name={r.name} detail={r.status === 'paused' ? t('routines.paused') : formatSchedule(routineForFormat(r))} />
            ))}
          </ul>
        </TabsContent>
      </ResourceShelf>
    </div>
  );
}

// ── Viewer ──

/**
 * The artifact viewer: the workspace panel's header and body for one file or
 * browser session of the shared thread. Files render client-side from
 * link-scoped bytes (HTML in a sandboxed frame without same-origin); a
 * browser session is a screenshot that refreshes while open, view only.
 */
export function ShareArtifactViewer({ source, selection, onClose, guestsSee, onGuestsSeeChange }: {
  source: ShareResourceSource;
  selection: ShareSelection;
  onClose: () => void;
  /** Owner page: guests see this artifact open. */
  guestsSee?: boolean;
  /** Owner page: show it to guests, or stop (it stays open for the owner). */
  onGuestsSeeChange?: (see: boolean) => void;
}) {
  const t = useT();
  const title = selection.kind === 'file' ? selection.name : (selection.title || selection.url);
  const download = selection.kind === 'file'
    ? () => { void downloadShareFile(source, selection.id, selection.name).catch(() => {}); }
    : null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-share-viewer={selection.kind}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {selection.kind === 'file' ? getFileIcon(selection.contentType, selection.name) : <Globe className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>{title}</span>
        {onGuestsSeeChange && (guestsSee ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="xs" className="shrink-0 gap-1 rounded-full" data-guests-see="on">
                <Eye data-icon="inline-start" /><span className="hidden sm:inline">{t('shareJam.guestsSeeThis')}</span><ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onGuestsSeeChange(false)} data-guests-see-hide=""><EyeOff />{t('shareJam.dontShowGuests')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" onClick={() => onGuestsSeeChange(true)} data-guests-see="off">
            <Eye data-icon="inline-start" /><span className="hidden sm:inline">{t('shareJam.showGuests')}</span>
          </Button>
        ))}
        {download && (
          <WithTooltip label={t('artifactPanel.download')}>
            <Button variant="ghost" size="icon-sm" onClick={download} aria-label={t('artifactPanel.download')} data-share-download=""><Download /></Button>
          </WithTooltip>
        )}
        {selection.kind === 'browser' && selection.url && /^https?:\/\//i.test(selection.url) && (
          <WithTooltip label={selection.url}>
            <Button variant="ghost" size="icon-sm" asChild aria-label={selection.url}>
              <a href={selection.url} target="_blank" rel="noopener noreferrer"><ExternalLink /></a>
            </Button>
          </WithTooltip>
        )}
        <WithTooltip label={t('artifactPanel.close')}>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('artifactPanel.close')} data-share-viewer-close=""><X /></Button>
        </WithTooltip>
      </header>
      <div className="min-h-0 flex-1">
        {selection.kind === 'file'
          ? <ShareFileBody key={`${source.key}:${selection.id}`} source={source} selection={selection} onDownload={download!} />
          : (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
                <ScreenshotThumbnail key={selection.id} cacheKey={`${source.key}:${selection.id}:viewer`} fetchScreenshot={(signal) => source.fetchScreenshot(selection.id, signal)}
                  title={title} enabled refreshMs={5000} className="h-auto rounded-md border bg-background" imageClassName="h-auto object-contain" />
              </div>
              <p className="shrink-0 truncate border-t px-3 py-2 text-xs text-muted-foreground" title={selection.url}>{selection.url}</p>
            </div>
          )}
      </div>
    </div>
  );
}

function ShareFileBody({ source, selection, onDownload }: {
  source: ShareResourceSource;
  selection: Extract<ShareSelection, { kind: 'file' }>;
  onDownload: () => void;
}) {
  const [loaded, setLoaded] = useState<LoadedArtifact | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    source.fetchFile(selection.id, abort.signal)
      .then((res) => readArtifactResponse(res, { contentType: selection.contentType, filename: selection.name, size: selection.size }, abort.signal))
      .then((result) => {
        if (!result) return;
        objectUrl = result.url;
        if (abort.signal.aborted) { if (objectUrl) URL.revokeObjectURL(objectUrl); return; }
        setLoaded(result);
      })
      .catch(() => { if (!abort.signal.aborted) setLoaded({ failed: true }); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, selection.id, selection.contentType, selection.name, selection.size]);
  if (!loaded) return <div className="flex h-full items-center justify-center"><Spinner className="size-5 text-muted-foreground" /></div>;
  // A web project needs the workspace's project host; on a share page it is a download.
  const body = loaded.type === 'project' ? { failed: false, type: 'application/octet-stream' } : loaded;
  return <ArtifactBody loaded={body} filename={selection.name} onDownload={onDownload} />;
}

/** The selection's identity, for keys and comparisons. */
export function selectionKey(selection: ShareSelection | null): string {
  return selection ? `${selection.kind}:${selection.id}` : '';
}

/** Keep the open browser session's title/URL current as the shelf refreshes. */
export function useFreshSelection(selection: ShareSelection | null, resources: ShareResources): ShareSelection | null {
  return useMemo(() => {
    if (selection?.kind !== 'browser') return selection;
    const tab = resources.browsers.find((b) => b.id === selection.id);
    return tab ? { kind: 'browser', id: tab.id, title: tab.title, url: tab.url } : selection;
  }, [selection, resources.browsers]);
}
