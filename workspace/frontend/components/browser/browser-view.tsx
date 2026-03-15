'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, X, RefreshCw, Users, ChevronLeft, Lock, Unlock, Maximize2, Minimize2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function BrowserView() {
  const {
    browserTabs, selectedBrowserTabId, setSelectedBrowserTabId,
    closeBrowserTab, reconnectBrowserTab, persistBrowserTab, unpersistBrowserTab, browserContexts,
  } = useWorkspace();
  const { isMobile, openMobileList, isDetailExpanded, toggleDetailExpanded } = useLayout();
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const prevBlobRef = useRef<string | null>(null);

  const tab = browserTabs.find((t) => t.id === selectedBrowserTabId);

  // Poll screenshot every 2 seconds (only when no live URL)
  useEffect(() => {
    if (!selectedBrowserTabId || !tab || tab.liveUrl) {
      setScreenshotUrl(null);
      return;
    }

    let cancelled = false;

    const fetchScreenshot = async () => {
      try {
        const url = workspaceApi.getBrowserScreenshotUrl(selectedBrowserTabId);
        const headers: Record<string, string> = {};
        const token = (workspaceApi as unknown as { token: string }).token;
        if (token) headers['X-Workspace-Token'] = token;
        const bearerToken = (workspaceApi as unknown as { bearerToken: string }).bearerToken;
        if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

        const res = await fetch(url, { headers });
        if (!res.ok || cancelled) return;

        const blob = await res.blob();
        if (cancelled) return;

        if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);

        const blobUrl = URL.createObjectURL(blob);
        prevBlobRef.current = blobUrl;
        setScreenshotUrl(blobUrl);
        setLoading(false);
      } catch {
        // Non-critical — screenshot will retry
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
      toast.success('Tab reconnected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reconnect');
    } finally {
      setReconnecting(false);
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
    const name = prompt('Give this session a name (e.g. "LinkedIn Account", "Google Search Console"):');
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
    if (!confirm(`Remove persistent state from "${label}"? The saved cookies and login state will be deleted.`)) return;
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
        <Globe className="size-4 text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{tab.title || 'Untitled'}</p>
          <p className="text-xs text-muted-foreground truncate">{tab.url}</p>
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
        {tab.liveUrl ? (
          /* Browserbase live view — interactive iframe */
          <iframe
            src={tab.liveUrl}
            className="w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title={`Live browser: ${tab.url}`}
          />
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
