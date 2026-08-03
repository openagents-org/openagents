'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, X, RefreshCw, Users, ChevronLeft, Lock, Unlock, Maximize2, Minimize2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';
import { useT } from '@/lib/i18n';

export function BrowserView() {
  const t = useT();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const {
    browserTabs, selectedBrowserTabId, setSelectedBrowserTabId,
    closeBrowserTab, navigateBrowserTab, reconnectBrowserTab, persistBrowserTab, unpersistBrowserTab, browserContexts,
    refreshBrowserTabs,
  } = useWorkspace();
  const { isMobile, openMobileList, isDetailExpanded, toggleDetailExpanded } = useLayout();
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionDead, setSessionDead] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const prevBlobRef = useRef<string | null>(null);
  const failCountRef = useRef(0);

  const tab = browserTabs.find((t) => t.id === selectedBrowserTabId);

  // Validate the live session on mount / tab switch, then keep checking. The
  // backend probes the BF session and auto-reconnects if it can, returning
  // fresh tab data (including a new live_url).
  //
  // The repeat check matters because a live tab has no other health signal: the
  // screenshot poll below is skipped entirely while liveUrl is set, and when a
  // share link expires the iframe silently swaps in BrowserFabric's own error
  // page — cross-origin, so nothing here can read it. Without this the tab
  // looked healthy indefinitely while showing BF's "expired share link" screen.
  //
  // Depends on whether there IS a live URL, not on its value: validate can hand
  // back a new one, and depending on the string would re-trigger itself.
  const hasLiveUrl = !!tab?.liveUrl;
  useEffect(() => {
    if (!selectedBrowserTabId || !hasLiveUrl) return;
    let cancelled = false;

    const validate = async (initial: boolean) => {
      if (initial) setReconnecting(true);
      try {
        await workspaceApi.validateBrowserTab(selectedBrowserTabId);
        if (cancelled) return;
        setSessionDead(false);
        await refreshBrowserTabs();
      } catch {
        if (!cancelled) setSessionDead(true);
      } finally {
        if (!cancelled && initial) setReconnecting(false);
      }
    };

    validate(true);
    const interval = setInterval(() => validate(false), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedBrowserTabId, hasLiveUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll screenshot every 2 seconds (only when no live URL)
  useEffect(() => {
    if (!selectedBrowserTabId || !tab || tab.liveUrl) {
      setScreenshotUrl(null);
      return;
    }

    let cancelled = false;
    failCountRef.current = 0;
    setSessionDead(false);

    const fetchScreenshot = async () => {
      try {
        const url = workspaceApi.getBrowserScreenshotUrl(selectedBrowserTabId);
        const headers: Record<string, string> = {};
        const token = (workspaceApi as unknown as { token: string }).token;
        if (token) headers['X-Workspace-Token'] = token;
        const bearerToken = (workspaceApi as unknown as { bearerToken: string }).bearerToken;
        if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

        const res = await fetch(url, { headers });
        if (cancelled) return;
        if (!res.ok) {
          failCountRef.current++;
          if (failCountRef.current >= 3) {
            setSessionDead(true);
            setLoading(false);
          }
          return;
        }

        const blob = await res.blob();
        if (cancelled) return;

        failCountRef.current = 0;
        setSessionDead(false);

        if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);

        const blobUrl = URL.createObjectURL(blob);
        prevBlobRef.current = blobUrl;
        setScreenshotUrl(blobUrl);
        setLoading(false);
      } catch {
        failCountRef.current++;
        if (failCountRef.current >= 3) {
          setSessionDead(true);
          setLoading(false);
        }
      }
    };

    setLoading(true);
    fetchScreenshot();
    const interval = setInterval(fetchScreenshot, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (prevBlobRef.current) {
        URL.revokeObjectURL(prevBlobRef.current);
        prevBlobRef.current = null;
      }
    };
  }, [selectedBrowserTabId, tab]);

  const handleReconnect = async () => {
    if (!tab || reconnecting) return;
    setReconnecting(true);
    try {
      await reconnectBrowserTab(tab.id);
      setSessionDead(false);
      failCountRef.current = 0;
      setLoading(true);
      toast.success(t('browser.reconnected'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.reconnectFailed'));
    } finally {
      setReconnecting(false);
    }
  };

  const startEditingUrl = () => {
    setUrlDraft(tab?.url || '');
    setEditingUrl(true);
    setTimeout(() => urlInputRef.current?.select(), 0);
  };

  const handleNavigate = async () => {
    setEditingUrl(false);
    const trimmed = urlDraft.trim();
    if (!trimmed || !tab || trimmed === tab.url) return;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    setNavigating(true);
    try {
      await navigateBrowserTab(tab.id, url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.navigateFailed'));
    } finally {
      setNavigating(false);
    }
  };

  const handleClose = async () => {
    if (!selectedBrowserTabId) return;
    try {
      await closeBrowserTab(selectedBrowserTabId);
      toast.success(t('browser.tabClosed'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.tabCloseFailed'));
    }
  };

  const handlePersist = async () => {
    if (!tab || tab.contextId) return;
    const name = await prompt({
      title: t('browser.savePersistentTitle'),
      description: t('browser.savePersistentDescription'),
      placeholder: t('browser.savePersistentPlaceholder'),
      confirmText: t('common.save'),
    });
    if (!name?.trim()) return;
    try {
      await persistBrowserTab(tab.id, name.trim());
      toast.success(t('browser.nowPersistent', { name: name.trim() }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.makePersistentFailed'));
    }
  };

  const handleUnpersist = async () => {
    if (!tab || !tab.contextId) return;
    const ctx = browserContexts.find((c) => c.id === tab.contextId);
    const label = ctx?.name || t('browser.thisTab');
    const ok = await confirm({
      title: t('browser.removePersistentTitle'),
      description: t('browser.removePersistentDescription', { label }),
      confirmText: t('common.remove'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await unpersistBrowserTab(tab.id);
      toast.success(t('browser.nowTemporal'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('browser.removePersistentFailed'));
    }
  };

  // No tab selected
  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <Globe className="size-12 mx-auto opacity-20" />
          <p className="text-sm font-medium">{t('browser.selectTabTitle')}</p>
          <p className="text-xs">{t('browser.selectTabBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header — title in the app header, actions portalled into its toolbar */}
      <DetailHeader
        title={<>
          {isMobile && (
            <button
              onClick={openMobileList}
              className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          <Globe className={cn("size-4 shrink-0", navigating ? "text-amber-500 animate-pulse" : "text-foreground/70")} />
          <p className="text-sm font-medium truncate">{tab.title || t('browser.untitled')}</p>
        </>}
      >
        {/* Shared with badges */}
        {tab.sharedWith.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <Users className="size-3.5 text-muted-foreground" />
            {tab.sharedWith.map((agent) => (
              <span
                key={agent}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground"
              >
                {agent}
              </span>
            ))}
          </div>
        )}

        <span className="text-[10px] text-muted-foreground shrink-0">
          by {(tab.createdBy || 'unknown').replace(/^(openagents:|human:)/, '')}
        </span>

        {tab.contextId ? (
          <button
            onClick={handleUnpersist}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-green-600 dark:text-green-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-orange-500 dark:hover:text-orange-400 transition-colors shrink-0"
            title={t('browser.removePersistentHint')}
          >
            <Lock className="size-3" />
            {browserContexts.find((c) => c.id === tab.contextId)?.name || 'persistent'}
          </button>
        ) : (
          <button
            onClick={handlePersist}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-green-600 transition-colors shrink-0"
            title={t('browser.makePersistentHint')}
          >
            <Lock className="size-3" />
            {t('browser.makePersistent')}
          </button>
        )}

        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-50"
          title={t('browser.reconnectHint')}
        >
          <RefreshCw className={cn("size-4", reconnecting && "animate-spin")} />
        </button>

        {!isMobile && (
          <button
            onClick={toggleDetailExpanded}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
            title={isDetailExpanded ? t('browser.restoreSize') : t('browser.expandFullPage')}
          >
            {isDetailExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}

        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
          title={t('browser.closeTab')}
        >
          <X className="size-4" />
        </button>
      </DetailHeader>

      {/* Address bar — a browser needs its URL visible and editable, and the
          single-line app header has no room for it. */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 lg:px-4">
        <Globe className="size-3 shrink-0 text-muted-foreground/60" />
        {editingUrl ? (
          <input
            ref={urlInputRef}
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={() => setEditingUrl(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNavigate();
              if (e.key === 'Escape') setEditingUrl(false);
            }}
            className="w-full rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs outline-none focus:border-foreground/50 dark:border-zinc-600 dark:bg-zinc-800"
            autoFocus
          />
        ) : (
          <p
            className="min-w-0 flex-1 cursor-pointer truncate font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={startEditingUrl}
            title={t('browser.editUrl')}
          >
            {tab.url}
          </p>
        )}
      </div>

      {/* Browser view area */}
      <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-900 flex items-start justify-center">
        {/* Dead is checked before liveUrl: an expired tab still carries the
            stale share URL, and rendering it just showed BrowserFabric's own
            "invalid or expired share link" page inside the frame. */}
        {sessionDead ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-3">
              <Globe className="size-10 mx-auto opacity-20" />
              <p className="text-sm font-medium">{t('browser.expiredTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('browser.expiredBody')}</p>
              <button
                onClick={handleReconnect}
                disabled={reconnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={cn("size-3.5", reconnecting && "animate-spin")} />
                {reconnecting ? 'Reconnecting…' : t('browser.reconnect')}
              </button>
            </div>
          </div>
        ) : tab.liveUrl && !reconnecting ? (
          <iframe
            src={tab.liveUrl}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title={t('browser.liveBrowser', { url: tab.url })}
          />
        ) : loading && !screenshotUrl ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <RefreshCw className="size-6 animate-spin" />
          </div>
        ) : screenshotUrl ? (
          <div className="p-4 w-full flex justify-center">
            <img
              src={screenshotUrl}
              alt={t('browser.screenshotOf', { url: tab.url })}
              className="max-w-full border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">{t('browser.noScreenshot')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
