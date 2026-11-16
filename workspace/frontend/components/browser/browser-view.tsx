'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { FeatureTourBanner } from '@/components/tours/feature-tour-banner';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n';
import type { BrowserTab } from '@/lib/types';
import { NewBrowserTabDialog } from './new-browser-tab-dialog';
import { actorName, tabHasFreshAgentActivity, useAgentActivity } from './agent-activity';
import { buildTabEntries, closeRisk, displayUrl, normalizeUrl, type PermanentEntry, type TabEntry } from './tab-model';
import { useBrowserControl } from './use-browser-control';
import { useBrowserSession } from './use-browser-session';
import { BrowserTabStrip } from './browser-tab-strip';
import { BrowserPlaceholder, BrowserStatusBar, BrowserToolbar, type LiveState } from './browser-chrome';
import { BrowserViewport } from './browser-viewport';

/**
 * The shared browser: a tab strip, an address bar, the live page, and
 * a status bar that says who is driving — with a take-over / hand-back switch.
 */
export function BrowserView({ artifactTabId }: { artifactTabId?: string } = {}) {
  const t = useT();
  const confirm = useConfirm();
  const {
    browserTabs, browserContexts, browserTabLimits, agents,
    selectedBrowserTabId: workspaceBrowserTabId, setSelectedBrowserTabId,
    selectedBrowserContextId, setSelectedBrowserContextId,
    closeBrowserTab, navigateBrowserTab,
    openBrowserTabWithContext, deleteBrowserContext, refreshBrowserTabs,
  } = useWorkspace();
  const { isMobile } = useLayout();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { toast.error(t("browser.fullscreenUnavailable")); }
  };

  const [navigating, setNavigating] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wakingId, setWakingId] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const selectedBrowserTabId = artifactTabId || workspaceBrowserTabId;
  const tab = browserTabs.find((x) => x.id === selectedBrowserTabId);
  const { permanent, temporary } = buildTabEntries(browserTabs, browserContexts);
  const asleepEntry = !tab && selectedBrowserContextId
    ? permanent.find((e) => e.context.id === selectedBrowserContextId && !e.tab) ?? null
    : null;
  const idleMinutes = browserTabLimits?.idleMinutes ?? 15;
  const activity = useAgentActivity(tab);

  // Bring the open tab into view in the strip, which hides its scrollbar:
  // past a handful of tabs the selected one could sit out of sight.
  const tabStripRef = useRef<HTMLDivElement>(null);
  const activeTabKey = tab
    ? (tab.contextId ? `ctx:${tab.contextId}` : `tab:${tab.id}`)
    : selectedBrowserContextId ? `ctx:${selectedBrowserContextId}` : null;
  useEffect(() => {
    if (!activeTabKey) return;
    const chip = tabStripRef.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(activeTabKey)}"]`);
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabKey, browserTabs.length, browserContexts.length]);

  const { controlling, busy: controlBusy, toggle: toggleControl, input: sendInput, frameRevision } = useBrowserControl(tab?.id);
  const session = useBrowserSession({ selectedBrowserTabId, tab, refreshBrowserTabs, controlling, frameRevision });
  const { reconnecting, sessionDead, sessionAsleep, loading, screenshotUrl } = session;

  // ── actions ──────────────────────────────────────────────────────────────

  const selectLive = (x: BrowserTab) => {
    setSelectedBrowserTabId(x.id);
    setSelectedBrowserContextId(null);
  };

  const wake = async (contextId: string) => {
    if (wakingId) return;
    setWakingId(contextId);
    try {
      const opened = await openBrowserTabWithContext(contextId);
      selectLive(opened);
      toast.success(t('browser.openedWithSession'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabOpenFailed'));
    } finally {
      setWakingId(null);
    }
  };

  const startEditingUrl = () => {
    if (!tab) return;
    setUrlDraft(tab.url);
    setEditingUrl(true);
    setTimeout(() => urlInputRef.current?.select(), 0);
  };

  const handleNavigate = async () => {
    setEditingUrl(false);
    const trimmed = urlDraft.trim();
    if (!trimmed || !tab || trimmed === tab.url) return;
    setNavigating(true);
    try {
      await navigateBrowserTab(tab.id, normalizeUrl(trimmed));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.navigateFailed'));
    } finally {
      setNavigating(false);
    }
  };

  /** Temporary tab → gone. Permanent tab → asleep (session freed, state kept). */
  const handleCloseOrSleep = async (x: BrowserTab) => {
    // The open tab also hears the live view's own activity, ahead of the poll.
    const agentActive = (x.id === tab?.id && activity.active) || tabHasFreshAgentActivity(x);
    const risk = closeRisk(x, agentActive);
    if (risk) {
      const name = x.contextName || x.title || displayUrl(x.url, 40) || t('browser.untitled');
      const ok = await confirm({
        title: t('browser.closeTabConfirmTitle', { name }),
        description: risk === 'agent'
          ? t(x.contextId ? 'browser.closeTabAgentSleepDescription' : 'browser.closeTabAgentDescription', {
              agent: actorName(x.activity?.actor ?? activity.actor, agents) || t('browser.agentGeneric'),
            })
          : t('browser.closeTabTemporaryDescription'),
        confirmText: t('browser.closeTab'),
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await closeBrowserTab(x.id);
      if (x.contextId) {
        if (selectedBrowserTabId === x.id) setSelectedBrowserContextId(x.contextId);
        toast.success(t('browser.sleptToast'));
      } else {
        toast.success(t('browser.tabClosed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabCloseFailed'));
    }
  };

  const handleForget = async (entry: PermanentEntry) => {
    const ok = await confirm({
      title: t('browser.deleteSavedSessionTitle'),
      description: t('browser.deleteSavedSessionDescription', { name: entry.context.name }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      if (entry.tab) await closeBrowserTab(entry.tab.id);
      await deleteBrowserContext(entry.context.id);
      if (selectedBrowserContextId === entry.context.id) setSelectedBrowserContextId(null);
      toast.success(t('browser.savedSessionDeleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.savedSessionDeleteFailed'));
    }
  };

  // ── derived labels ────────────────────────────────────────────────────────

  const agentWho = actorName(activity.actor, agents) || t('browser.agentGeneric');
  const activityLabel = activity.active
    ? t(`browser.agentAction.${activity.action ?? 'other'}` as MessageKey, { agent: agentWho })
    : null;
  const liveState: LiveState = !tab
    ? 'none'
    : sessionDead
      ? 'unavailable'
      : sessionAsleep || tab.asleep ? 'asleep'
      : reconnecting || (!tab.liveUrl && loading && !screenshotUrl)
        ? 'connecting'
        : 'live';

  const selectEntry = (entry: TabEntry) => {
    if (entry.tab) selectLive(entry.tab);
    else if (entry.kind === 'permanent') { setSelectedBrowserTabId(null); setSelectedBrowserContextId(entry.context.id); }
  };

  return (
    <div className="flex h-full flex-col" data-browser-controls>
      {!artifactTabId && <DetailHeader
        title={<>
          <Globe className={cn('size-4 shrink-0', navigating ? 'animate-pulse text-warning' : 'text-foreground/70')} />
          <p className="truncate text-sm font-medium">{tab?.title || asleepEntry?.context.name || t('browser.cloudBrowser')}</p>
        </>}
      >
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void toggleFullscreen()}
            className="text-muted-foreground"
            aria-label={fullscreen ? t('browser.restoreSize') : t('browser.expandFullPage')}
            title={fullscreen ? t('browser.restoreSize') : t('browser.expandFullPage')}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        )}
      </DetailHeader>}

      {!artifactTabId && <FeatureTourBanner feature="browser" />}

      {!artifactTabId && (
        <BrowserTabStrip
          stripRef={tabStripRef}
          permanent={permanent}
          temporary={temporary}
          tab={tab}
          selectedTabId={selectedBrowserTabId}
          selectedContextId={selectedBrowserContextId}
          wakingId={wakingId}
          limits={browserTabLimits}
          onSelectEntry={selectEntry}
          onSelectLive={selectLive}
          onCloseOrSleep={handleCloseOrSleep}
          onForget={handleForget}
          onNewTab={() => setDialogOpen(true)}
        />
      )}
      {tab && (
        <BrowserToolbar
          tab={tab}
          urlInputRef={urlInputRef}
          editingUrl={editingUrl}
          urlDraft={urlDraft}
          onUrlDraft={setUrlDraft}
          onStartEditing={startEditingUrl}
          onStopEditing={() => setEditingUrl(false)}
          onNavigate={handleNavigate}
          reconnecting={reconnecting}
          navigating={navigating}
          onReconnect={session.handleReconnect}
          controlling={controlling}
          controlDisabled={controlBusy || sessionDead || sessionAsleep || !!tab.asleep || reconnecting}
          onToggleControl={toggleControl}
          onClose={() => handleCloseOrSleep(tab)}
        />
      )}
      {tab && (
        <BrowserViewport
          tab={tab}
          session={session}
          controlling={controlling}
          controlBusy={controlBusy}
          onToggleControl={toggleControl}
          sendInput={sendInput}
          agentActive={activity.active}
          activityLabel={activityLabel}
        />
      )}
      {!tab && (
        <BrowserPlaceholder
          asleepEntry={asleepEntry}
          hasTabs={permanent.length + temporary.length > 0}
          wakingId={wakingId}
          onWake={wake}
          onForget={handleForget}
          onNewTab={() => setDialogOpen(true)}
        />
      )}
      {tab && <BrowserStatusBar tab={tab} liveState={liveState} controlling={controlling} />}

      <NewBrowserTabDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
