'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, X, RefreshCw, Users, ChevronLeft, Lock, Unlock, Maximize2, Minimize2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useConfirm, usePrompt } from '@/components/ui/dialogs-provider';

export function BrowserView() {
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

  // Validate live session on mount / tab switch. The backend checks if the
  // BF session is still alive and auto-reconnects if dead, returning fresh
  // tab data (including a new live_url).
  useEffect(() => {
    if (!selectedBrowserTabId || !tab?.liveUrl) return;
    let cancelled = false;

    const validate = async () => {
      setReconnecting(true);
      try {
        await workspaceApi.validateBrowserTab(selectedBrowserTabId);
        if (!cancelled) await refreshBrowserTabs();
      } catch {
        if (!cancelled) setSessionDead(true);
      } finally {
        if (!cancelled) setReconnecting(false);
      }
    };

    validate();
    return () => { cancelled = true; };
  }, [selectedBrowserTabId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      toast.success('Tab reconnected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reconnect');
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
      toast.error(err instanceof Error ? err.message : 'Failed to navigate');
    } finally {
      setNavigating(false);
    }
  };

  const handleClose = async () => {
    if (!selectedBrowserTabId) return;
    try {
      await closeBrowserTab(selectedBrowserTabId);
      toast.success('Tab closed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close tab');
    }
  };

  const handlePersist = async () => {
    if (!tab || tab.contextId) return;
    const name = await prompt({
      title: 'Save this session',
      description: 'Give it a name so you can reuse the saved login later.',
      placeholder: 'e.g. LinkedIn Account, Google Search Console',
      confirmText: 'Save',
    });
    if (!name?.trim()) return;
    try {
      await persistBrowserTab(tab.id, name.trim());
      toast.success(`"${name.trim()}" is now persistent`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to make persistent');
    }
  };

  const handleUnpersist = async () => {
    if (!tab || !tab.contextId) return;
    const ctx = browserContexts.find((c) => c.id === tab.contextId);
    const label = ctx?.name || 'this tab';
    const ok = await confirm({
      title: 'Remove persistent state?',
      description: `The saved cookies and login state for "${label}" will be deleted.`,
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await unpersistBrowserTab(tab.id);
      toast.success('Tab is now temporal');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove persistent state');
    }
  };

  // No tab selected
  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <Globe className="size-12 mx-auto opacity-20" />
          <p className="text-sm font-medium">Select a browser tab</p>
          <p className="text-xs">Choose a tab from the list or open a new one</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 lg:px-4 py-2 lg:py-2.5 border-b border-input shrink-0">
        {isMobile && (
          <button
            onClick={openMobileList}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        <Globe className={cn("size-4 shrink-0", navigating ? "text-amber-500 animate-pulse" : "text-blue-500")} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{tab.title || 'Untitled'}</p>
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
              className="w-full text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded px-1.5 py-0.5 outline-none focus:border-blue-500 font-mono"
              autoFocus
            />
          ) : (
            <p
              className="text-xs text-muted-foreground truncate cursor-pointer hover:text-foreground transition-colors"
              onClick={startEditingUrl}
              title="Click to edit URL"
            >
              {tab.url}
            </p>
          )}
        </div>

        {/* Shared with badges */}
        {tab.sharedWith.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <Users className="size-3.5 text-muted-foreground" />
            {tab.sharedWith.map((agent) => (
              <span
                key={agent}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
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
            title="Remove persistent state — revert to temporal tab"
          >
            <Lock className="size-3" />
            {browserContexts.find((c) => c.id === tab.contextId)?.name || 'persistent'}
          </button>
        ) : (
          <button
            onClick={handlePersist}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-green-600 transition-colors shrink-0"
            title="Make persistent — preserve login state for agents to reuse"
          >
            <Lock className="size-3" />
            Make Persistent
          </button>
        )}

        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 disabled:opacity-50"
          title="Reconnect — create a new browser session"
        >
          <RefreshCw className={cn("size-4", reconnecting && "animate-spin")} />
        </button>

        {!isMobile && (
          <button
            onClick={toggleDetailExpanded}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0"
            title={isDetailExpanded ? 'Restore size' : 'Expand to full page'}
          >
            {isDetailExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        )}

        <button
          onClick={handleClose}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
          title="Close tab"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Browser view area */}
      <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-900 flex items-start justify-center">
        {tab.liveUrl && !reconnecting ? (
          <iframe
            src={tab.liveUrl}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title={`Live browser: ${tab.url}`}
          />
        ) : sessionDead ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-3">
              <Globe className="size-10 mx-auto opacity-20" />
              <p className="text-sm font-medium">Browser session expired</p>
              <p className="text-xs text-muted-foreground">The remote browser timed out. Click reconnect to start a new session.</p>
              <button
                onClick={handleReconnect}
                disabled={reconnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={cn("size-3.5", reconnecting && "animate-spin")} />
                {reconnecting ? 'Reconnecting…' : 'Reconnect'}
              </button>
            </div>
          </div>
        ) : loading && !screenshotUrl ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <RefreshCw className="size-6 animate-spin" />
          </div>
        ) : screenshotUrl ? (
          <div className="p-4 w-full flex justify-center">
            <img
              src={screenshotUrl}
              alt={`Screenshot of ${tab.url}`}
              className="max-w-full border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-sm"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">No screenshot available</p>
          </div>
        )}
      </div>
    </div>
  );
}
