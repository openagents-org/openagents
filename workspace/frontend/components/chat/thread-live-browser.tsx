'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { BrowserThumbnail } from '@/components/artifacts/browser-thumbnail';
import { BrowserArtifactPreview } from '@/components/artifacts/browser-artifact-preview';
import { ForcedStreamQuality } from '@/lib/browser-stream-quality';
import { liveThreadBrowserTab, tabHasFreshAgentActivity, tabStillFollowsThread } from '@/components/browser/agent-activity';
import type { BrowserView } from '@/components/layout/use-thread-view-state';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { agentReferencedBrowserTabs, resolveThreadBrowserLink } from '@/lib/thread-browser';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { browserPreviewPreferenceKey, browserPreviewDismissed, dismissBrowserPreview } from '@/lib/browser-preview-preference';
import type { WorkspaceMessage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { cn } from '@/lib/utils';

/** A browser stays over the conversation; opening it never narrows the thread. */
export function ThreadLiveBrowser({ messages = [] }: { messages?: WorkspaceMessage[] }) {
  const { browserTabs, currentSessionId, activeSessionIds, refreshBrowserTabs, workspace, currentUser } = useWorkspace();
  const { selectedBrowser, browserView, browserWatchOnly, setBrowserView } = useLayout();
  const t = useT();
  const minimized = browserView === 'minimized';
  // Resizing keeps the tab on screen while the agent pauses between actions.
  // A preview that opened automatically stays "followed" (watch-only), so it
  // is still bound to this thread; see `followLost`.
  const keep = (view: BrowserView) => setBrowserView(view, id ? { kind: 'browser', id } : undefined, selected ? browserWatchOnly : true);
  const setMinimized = (value: boolean) => keep(value ? 'minimized' : 'compact');
  const fullscreen = browserView === 'fullscreen';
  const setFullscreen = (value: boolean) => keep(value ? 'fullscreen' : 'compact');
  const [frameFailed, setFrameFailed] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const preferenceKey = browserPreviewPreferenceKey(workspace?.workspaceId || '', currentUser.id, currentSessionId || '');
  const [dismissal, setDismissal] = useState<{ key: string; dismissed: boolean } | null>(null);
  useEffect(() => { setDismissal({ key: preferenceKey, dismissed: browserPreviewDismissed(preferenceKey) }); }, [preferenceKey]);
  const panel = useRef<HTMLElement>(null);
  const agentReferences = agentReferencedBrowserTabs(browserTabs, currentSessionId || '', messages);
  const working = !!currentSessionId && activeSessionIds.has(currentSessionId);
  // Historical links and pins remain in Artifacts. Only fresh activity made
  // for this working thread may open a preview without an explicit click.
  const automaticTab = working && currentSessionId ? liveThreadBrowserTab(browserTabs, currentSessionId) : undefined;
  const selectedRef = selectedBrowser?.id || null;
  const selectedTab = selectedRef ? browserTabs.find(tab => tab.id === selectedRef)
    || resolveThreadBrowserLink(selectedRef, browserTabs, currentSessionId || '', messages) : undefined;
  // A followed preview ends as soon as another thread (or an unattributed call)
  // drives the tab: only a browser the viewer opened by hand ignores ownership.
  const followLost = !!selectedRef && browserWatchOnly && !!selectedTab && !tabStillFollowsThread(selectedTab, currentSessionId || '');
  const selected = selectedRef && !followLost ? selectedTab?.id || selectedRef : null;
  const automatic = browserView !== 'closed' && dismissal?.key === preferenceKey && !dismissal.dismissed ? automaticTab?.id : null;
  const id = selected || automatic;
  const tab = selected ? selectedTab : automaticTab;
  const interactive = (!!selected && !browserWatchOnly) || !tab || !!tab.asleep || agentReferences.has(tab.id);

  useEffect(() => { setFrameFailed(null); }, [id]);
  useEffect(() => { if (followLost) setBrowserView('compact', null); }, [followLost, setBrowserView]);
  useEffect(() => {
    if (followLost) return;
    if (selectedRef && selectedTab && selectedRef !== selectedTab.id) {
      setBrowserView(browserView || 'compact', { kind: 'browser', id: selectedTab.id }, browserWatchOnly);
    }
  }, [followLost, selectedRef, selectedTab?.id, browserView, browserWatchOnly, setBrowserView]);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update(); document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!working) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { if (!document.hidden) await refreshBrowserTabs(); }
      catch { /* Keep the previous preview until the next refresh. */ }
      finally { if (!stopped) timer = setTimeout(() => void poll(), 5000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [working, refreshBrowserTabs]);
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setFullscreen(false); }
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button, a[href], iframe, input, textarea, select, [tabindex="0"]');
        const first = nodes?.[0], last = nodes?.[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [fullscreen]);

  if (!id || !visible) return null;
  const label = tab && !interactive && tabHasFreshAgentActivity(tab)
    ? t('threadResources.browsing', { agent: (tab.activity?.actor || '').replace(/^openagents:/, '') })
    : t(interactive ? 'threadLiveBrowser.shared' : 'threadLiveBrowser.title');
  const live = tab?.liveUrl && frameFailed !== tab.liveUrl ? `${tab.liveUrl}${tab.liveUrl.includes('?') ? '&' : '?'}embed=1` : null;
  const close = () => { dismissBrowserPreview(preferenceKey); setDismissal({ key: preferenceKey, dismissed: true }); setBrowserView('closed'); };
  return <aside ref={panel} tabIndex={-1} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={label}
    data-browser-overlay={fullscreen ? 'fullscreen' : 'compact'}
    className={fullscreen ? 'fixed inset-0 z-70 flex flex-col overflow-hidden bg-background outline-none' : cn('absolute top-3 right-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl bg-background shadow-xl ring-1 ring-foreground/10 outline-none', interactive ? 'w-100' : 'w-60')}>
    <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
      <WithTooltip label={t(minimized ? 'threadLiveBrowser.restore' : 'threadLiveBrowser.minimize')}>
        <Button variant="ghost" size="xs" onClick={() => setMinimized(!minimized)} aria-expanded={!minimized} className="min-w-0 flex-1 shrink justify-start">
          <Globe data-icon="inline-start" className="text-muted-foreground" />
          <span className="truncate">{tab?.title || tab?.url || label}</span>
        </Button>
      </WithTooltip>
      <Button variant="ghost" size="icon-xs" onClick={() => { setFullscreen(!fullscreen); }} aria-label={t(fullscreen ? 'threadLiveBrowser.collapse' : 'threadLiveBrowser.expand')} className="text-muted-foreground">{fullscreen ? <Minimize2 /> : <Maximize2 />}</Button>
      {!minimized && !fullscreen && <Button variant="ghost" size="icon-xs" onClick={() => setMinimized(true)} aria-label={t('threadLiveBrowser.minimize')} className="text-muted-foreground"><Minus /></Button>}
      <Button variant="ghost" size="icon-xs" onClick={close} aria-label={t('common.close')} className="text-muted-foreground"><X /></Button>
    </div>
    {/* The interactive and fullscreen views embed the browser with its own
        address bar; only the small thumbnail view needs the address here. */}
    {tab?.url && !minimized && !interactive && !fullscreen && <p className="truncate border-b px-3 py-1 text-xs text-muted-foreground" title={tab.url}>{tab.url}</p>}
    <div className={cn('relative min-h-0 overflow-auto bg-muted/40', minimized && !fullscreen && 'hidden', fullscreen ? 'flex-1' : interactive ? 'h-80 max-h-[65vh]' : 'h-34')}>
      {/* The compact overlay is too small for the sharp stream; full screen uses the person's choice. */}
      {fullscreen ? <BrowserArtifactPreview tabId={id} revision={0} /> : interactive ? <ForcedStreamQuality.Provider value="low"><BrowserArtifactPreview tabId={id} revision={0} /></ForcedStreamQuality.Provider> : <>
        <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">{t('threadLiveBrowser.waiting')}</span>
        {live ? <iframe key={live} src={live} title={t('browser.liveBrowser', { url: tab!.url })} inert tabIndex={-1} onError={() => setFrameFailed(tab!.liveUrl)} className="pointer-events-none absolute top-0 left-0 h-144 w-256 origin-top-left scale-[0.234375] border-0" />
          : <BrowserThumbnail tabId={id} pageUrl={tab!.url} title={tab!.title || tab!.url} enabled refreshMs={2000} className="absolute inset-0 h-full border-0" />}
      </>}
    </div>
    {!interactive && tab && !minimized && !fullscreen && <WithTooltip label={tab.url}><Button variant="ghost" size="xs" onClick={() => openArtifactPreview({ kind: 'browser', id })} className="w-full justify-start rounded-none font-normal text-muted-foreground"><span className="truncate">{tab.title || tab.url}</span></Button></WithTooltip>}
  </aside>;
}
