'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Maximize2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { BrowserTab } from '@/lib/types';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

function tabSortTime(tab: BrowserTab): number {
  const raw = tab.lastActiveAt || tab.createdAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function BrowserView() {
  const { browserTabs, refreshBrowserTabs } = useWorkspace();

  const sortedTabs = useMemo(
    () => [...browserTabs].sort((a, b) => tabSortTime(b) - tabSortTime(a)),
    [browserTabs],
  );

  if (sortedTabs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center space-y-2">
          <Globe className="size-12 mx-auto opacity-20" />
          <p className="text-sm font-medium">No browser sessions</p>
          <p className="text-xs">Ask an agent to browse, then sessions appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-zinc-50 dark:bg-zinc-900 p-2.5 space-y-2.5">
      {sortedTabs.map((tab) => (
        <BrowserSessionCard
          key={tab.id}
          tab={tab}
          refreshBrowserTabs={refreshBrowserTabs}
        />
      ))}
    </div>
  );
}

function BrowserSessionCard({
  tab,
  refreshBrowserTabs,
}: {
  tab: BrowserTab;
  refreshBrowserTabs: () => Promise<void>;
}) {
  const { reconnectBrowserTab } = useWorkspace();
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionDead, setSessionDead] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const prevBlobRef = useRef<string | null>(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    if (!tab.liveUrl) return;
    let cancelled = false;

    const validate = async () => {
      setReconnecting(true);
      try {
        await workspaceApi.validateBrowserTab(tab.id);
        if (!cancelled) await refreshBrowserTabs();
      } catch {
        if (!cancelled) setSessionDead(true);
      } finally {
        if (!cancelled) setReconnecting(false);
      }
    };

    validate();
    return () => { cancelled = true; };
  }, [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab.liveUrl) {
      setScreenshotUrl(null);
      return;
    }

    let cancelled = false;
    failCountRef.current = 0;
    setSessionDead(false);

    const fetchScreenshot = async () => {
      try {
        const url = workspaceApi.getBrowserScreenshotUrl(tab.id);
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
  }, [tab.id, tab.liveUrl]);

  const handleReconnect = async () => {
    if (reconnecting) return;
    setReconnecting(true);
    try {
      await reconnectBrowserTab(tab.id);
      await refreshBrowserTabs();
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

  return (
    <section className="relative bg-background border border-input rounded-lg overflow-hidden shadow-xs">
      {tab.liveUrl && !reconnecting && (
        <button
          type="button"
          onClick={() => setFullscreenOpen(true)}
          className="absolute right-3 top-3 z-10 size-9 flex items-center justify-center rounded-full bg-black/60 text-white shadow-sm hover:bg-black/75 transition-colors"
          title="Open browser fullscreen"
          aria-label="Open browser fullscreen"
        >
          <Maximize2 className="size-4" />
        </button>
      )}

      <div className="h-[42vh] min-h-[300px] max-h-[420px] min-w-0 overflow-x-hidden overflow-y-auto bg-zinc-50 dark:bg-zinc-900 flex items-start justify-center">
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
                <RefreshCw className={cn('size-3.5', reconnecting && 'animate-spin')} />
                {reconnecting ? 'Reconnecting...' : 'Reconnect'}
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

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent variant="fullscreen" className="flex flex-col p-0 gap-0" showCloseButton>
          <DialogTitle className="sr-only">{tab.title || tab.url || 'Browser session'}</DialogTitle>
          {tab.liveUrl && (
            <iframe
              src={tab.liveUrl}
              className="w-full h-full border-0 bg-black"
              allow="clipboard-read; clipboard-write"
              title={`Live browser fullscreen: ${tab.url}`}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
