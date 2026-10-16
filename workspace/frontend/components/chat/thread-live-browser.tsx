'use client';

import { useEffect, useState } from 'react';
import { Globe, Maximize2, Minus } from 'lucide-react';
import { BrowserThumbnail } from '@/components/artifacts/browser-thumbnail';
import { isAgentActor, tabHasFreshAgentActivity } from '@/components/browser/agent-activity';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useT } from '@/lib/i18n';
import { threadBrowserTabs } from '@/lib/thread-browser';
import { openArtifactPreview } from '@/lib/thread-artifacts';

/** Watch only tabs explicitly associated with this conversation, never infer
 * association from an agent name (an agent can work in several threads). */
export function ThreadLiveBrowser() {
  const { browserTabs, currentSessionId, activeSessionIds, refreshBrowserTabs } = useWorkspace();
  const { selectedArtifact, showBrowserPreview } = useLayout();
  const t = useT();
  const [minimized, setMinimized] = useState(false);
  const [frameFailed, setFrameFailed] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const tab = currentSessionId ? threadBrowserTabs(browserTabs, currentSessionId)
    .find(tab => !tab.asleep && (isAgentActor(tab.activity?.actor) || isAgentActor(tab.createdBy))) : undefined;
  const working = !!currentSessionId && activeSessionIds.has(currentSessionId);

  useEffect(() => { setMinimized(false); setFrameFailed(null); }, [tab?.id]);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  // Discover the agent's new tab promptly while it works, with no overlapping
  // requests or polling in background tabs. The regular workspace poll remains.
  useEffect(() => {
    if (!working) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { if (!document.hidden) await refreshBrowserTabs(); }
      catch { /* Keep the last preview and retry on the next tick. */ }
      finally { if (!stopped) timer = setTimeout(() => void poll(), 5000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [working, refreshBrowserTabs]);

  if (!tab || !visible || (showBrowserPreview && selectedArtifact?.kind === 'browser' && selectedArtifact.id === tab.id)) return null;
  const label = tabHasFreshAgentActivity(tab)
    ? t('threadResources.browsing', { agent: (tab.activity?.actor || '').replace(/^openagents:/, '') })
    : t('threadLiveBrowser.title');
  const live = tab.liveUrl && frameFailed !== tab.liveUrl ? `${tab.liveUrl}${tab.liveUrl.includes('?') ? '&' : '?'}embed=1` : null;
  return <aside aria-label={t('threadLiveBrowser.title')} className="absolute right-3 top-3 z-20 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-lg border bg-background shadow-lg">
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Globe className="size-3.5 shrink-0 text-emerald-500" />
      <button type="button" onClick={() => setMinimized(!minimized)} title={t(minimized ? 'threadLiveBrowser.restore' : 'threadLiveBrowser.minimize')} className="min-w-0 flex-1 truncate text-left text-[11px] font-medium">{label}</button>
      <button type="button" onClick={() => openArtifactPreview({ kind: 'browser', id: tab.id })} aria-label={t('threadLiveBrowser.expand')} className="rounded p-1 text-muted-foreground hover:bg-muted"><Maximize2 className="size-3" /></button>
      {!minimized && <button type="button" onClick={() => setMinimized(true)} aria-label={t('threadLiveBrowser.minimize')} className="rounded p-1 text-muted-foreground hover:bg-muted"><Minus className="size-3" /></button>}
    </div>
    {!minimized && <>
      <div className="relative h-[135px] w-60 overflow-hidden border-y bg-muted/40">
        <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-muted-foreground">{t('threadLiveBrowser.waiting')}</span>
        {live ? <iframe key={live} src={live} title={t('browser.liveBrowser', { url: tab.url })} inert tabIndex={-1} onError={() => setFrameFailed(tab.liveUrl)} className="pointer-events-none absolute left-0 top-0 h-[576px] w-[1024px] origin-top-left scale-[0.234375] border-0" />
          : <BrowserThumbnail tabId={tab.id} pageUrl={tab.url} title={tab.title || tab.url} enabled refreshMs={2000} className="absolute inset-0 h-full border-0" />}
      </div>
      <button type="button" onClick={() => openArtifactPreview({ kind: 'browser', id: tab.id })} title={tab.url} className="block w-60 truncate px-2 py-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground">{tab.title || tab.url}</button>
    </>}
  </aside>;
}
