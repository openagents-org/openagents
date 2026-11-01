'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { BrowserThumbnail } from '@/components/artifacts/browser-thumbnail';
import { BrowserArtifactPreview } from '@/components/artifacts/browser-artifact-preview';
import { tabHasFreshAgentActivity } from '@/components/browser/agent-activity';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { agentReferencedBrowserTabs, resolveThreadBrowserLink, threadBrowserTabs } from '@/lib/thread-browser';
import { openArtifactPreview } from '@/lib/thread-artifacts';
import { browserPreviewPreferenceKey, browserPreviewDismissed, dismissBrowserPreview } from '@/lib/browser-preview-preference';
import type { WorkspaceMessage } from '@/lib/types';

/** A browser stays over the conversation; opening it never narrows the thread. */
export function ThreadLiveBrowser({ messages = [] }: { messages?: WorkspaceMessage[] }) {
  const { browserTabs, currentSessionId, activeSessionIds, refreshBrowserTabs, workspace, currentUser } = useWorkspace();
  const { selectedArtifact, setSelectedArtifact } = useLayout();
  const t = useT();
  const [minimized, setMinimized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [frameFailed, setFrameFailed] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const preferenceKey = browserPreviewPreferenceKey(workspace?.workspaceId || '', currentUser.id, currentSessionId || '');
  const [dismissal, setDismissal] = useState<{ key: string; dismissed: boolean } | null>(null);
  useEffect(() => { setDismissal({ key: preferenceKey, dismissed: browserPreviewDismissed(preferenceKey) }); }, [preferenceKey]);
  const panel = useRef<HTMLElement>(null);
  const agentReferences = agentReferencedBrowserTabs(browserTabs, currentSessionId || '', messages);
  const working = !!currentSessionId && activeSessionIds.has(currentSessionId);
  // Historical links remain in Artifacts. Only fresh activity in the current
  // working thread may open a preview without an explicit click.
  const automaticTab = working && currentSessionId ? threadBrowserTabs(browserTabs, currentSessionId, messages)
    .find(tab => !tab.asleep && tabHasFreshAgentActivity(tab)) : undefined;
  const selectedRef = selectedArtifact?.kind === 'browser' ? selectedArtifact.id : null;
  const selectedTab = selectedRef ? browserTabs.find(tab => tab.id === selectedRef)
    || resolveThreadBrowserLink(selectedRef, browserTabs, currentSessionId || '', messages) : undefined;
  const selected = selectedRef ? selectedTab?.id || selectedRef : null;
  const automatic = dismissal?.key === preferenceKey && !dismissal.dismissed ? automaticTab?.id : null;
  const id = selected || automatic;
  const tab = selected ? selectedTab : automaticTab;
  const interactive = !!selected || !tab || !!tab.asleep || agentReferences.has(tab.id);

  useEffect(() => { setMinimized(false); setFullscreen(false); setFrameFailed(null); }, [id]);
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
  const close = () => { dismissBrowserPreview(preferenceKey); setDismissal({ key: preferenceKey, dismissed: true }); if (selected) setSelectedArtifact(null); setFullscreen(false); };
  return <aside ref={panel} tabIndex={-1} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={label}
    data-browser-overlay={fullscreen ? 'fullscreen' : 'compact'}
    className={fullscreen ? 'fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background outline-none' : `absolute right-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border bg-background shadow-xl outline-none ${interactive ? 'w-[400px]' : 'w-60'}`}>
    <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5">
      <Globe className="size-3.5 shrink-0 text-emerald-500" />
      <button type="button" onClick={() => setMinimized(!minimized)} title={t(minimized ? 'threadLiveBrowser.restore' : 'threadLiveBrowser.minimize')} className="min-w-0 flex-1 truncate text-left text-xs font-medium">{tab?.title || tab?.url || label}</button>
      <button type="button" onClick={() => { setMinimized(false); setFullscreen(!fullscreen); }} aria-label={t(fullscreen ? 'threadLiveBrowser.collapse' : 'threadLiveBrowser.expand')} className="rounded p-1 text-muted-foreground hover:bg-muted">{fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
      {!minimized && !fullscreen && <button type="button" onClick={() => setMinimized(true)} aria-label={t('threadLiveBrowser.minimize')} className="rounded p-1 text-muted-foreground hover:bg-muted"><Minus className="size-4" /></button>}
      <button type="button" onClick={close} aria-label={t('common.close')} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
    </div>
    {tab?.url && !minimized && <p className="truncate border-b px-3 py-1 text-[11px] text-muted-foreground" title={tab.url}>{tab.url}</p>}
    <div className={`${minimized && !fullscreen ? 'hidden' : ''} relative min-h-0 overflow-auto bg-muted/40 ${fullscreen ? 'flex-1' : interactive ? 'h-[320px] max-h-[65vh]' : 'h-[135px]'}`}>
      {interactive ? <BrowserArtifactPreview tabId={id} revision={0} /> : fullscreen ? <BrowserArtifactPreview tabId={id} revision={0} /> : <>
        <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">{t('threadLiveBrowser.waiting')}</span>
        {live ? <iframe key={live} src={live} title={t('browser.liveBrowser', { url: tab!.url })} inert tabIndex={-1} onError={() => setFrameFailed(tab!.liveUrl)} className="pointer-events-none absolute left-0 top-0 h-[576px] w-[1024px] origin-top-left scale-[0.234375] border-0" />
          : <BrowserThumbnail tabId={id} pageUrl={tab!.url} title={tab!.title || tab!.url} enabled refreshMs={2000} className="absolute inset-0 h-full border-0" />}
      </>}
    </div>
    {!interactive && tab && !minimized && !fullscreen && <button type="button" onClick={() => openArtifactPreview({ kind: 'browser', id })} title={tab.url} className="block w-full truncate px-2 py-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground">{tab.title || tab.url}</button>}
  </aside>;
}
