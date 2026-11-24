'use client';
import { useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** A lightweight glance at a live tab. Only visible cards request screenshots;
 * authenticated bytes stay in a local blob URL, never a credential-bearing URL. */
export function BrowserThumbnail({ tabId, pageUrl, title, enabled, className, refreshMs = 30000 }: {
  tabId: string; pageUrl?: string; title: string; enabled: boolean; className?: string; refreshMs?: number;
}) {
  const { idToken } = useOpenAgentsAuth();
  return <ScreenshotThumbnail cacheKey={`${tabId}:${pageUrl}:${idToken}`} fetchScreenshot={signal => workspaceApi.fetchBrowserScreenshot(tabId, signal)}
    title={title} enabled={enabled} className={className} refreshMs={refreshMs} />;
}

/**
 * The refreshing screenshot behind {@link BrowserThumbnail}, for any source of
 * screenshot bytes (the workspace API, or a shared thread's link). Refreshes
 * only while on screen and the page is visible.
 */
export function ScreenshotThumbnail({ cacheKey, fetchScreenshot, title, enabled, className, imageClassName, refreshMs = 30000 }: {
  cacheKey: string; fetchScreenshot: (signal: AbortSignal) => Promise<Response>; title: string; enabled: boolean;
  className?: string; imageClassName?: string; refreshMs?: number;
}) {
  const t = useT();
  const host = useRef<HTMLSpanElement>(null);
  const fetchRef = useRef(fetchScreenshot);
  fetchRef.current = fetchScreenshot;
  const key = `${cacheKey}:${enabled}`;
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>({ key: '' });
  useEffect(() => {
    if (!enabled || !host.current) return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    let visible = typeof IntersectionObserver === 'undefined';
    let busy = false;
    const refresh = async () => {
      if (!visible || document.hidden || busy || abort.signal.aborted) return;
      busy = true;
      try {
        const response = await fetchRef.current(abort.signal);
        if (response.ok === false) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        const previous = objectUrl;
        objectUrl = URL.createObjectURL(blob);
        setState({ key, url: objectUrl });
        if (previous) URL.revokeObjectURL(previous);
      } catch {
        if (!abort.signal.aborted) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = undefined;
          setState({ key, failed: true });
        }
      } finally { busy = false; }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) void refresh();
    });
    // Observe the card, so hiding an unavailable image does not prevent a
    // later screenshot from loading when the browser becomes available again.
    observer?.observe(host.current.parentElement || host.current);
    void refresh();
    const timer = setInterval(() => void refresh(), Math.max(1000, refreshMs));
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      abort.abort(); observer?.disconnect(); clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, enabled, refreshMs]);
  const current = state.key === key ? state : null;
  return <span ref={host} className={current?.url ? cn("relative block h-44 w-full overflow-hidden border-b bg-muted/50", className) : "hidden"}>
    {current?.url && <img
      src={current.url}
      alt={t('browser.screenshotOf', { url: title })}
      onError={() => setState({ key, failed: true })}
      className={cn("h-full w-full object-cover object-top", imageClassName)}
    />}
  </span>;
}
