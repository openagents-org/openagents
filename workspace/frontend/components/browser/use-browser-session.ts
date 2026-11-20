'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, workspaceApi } from '@/lib/api';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/dialogs-provider';
import { useT } from '@/lib/i18n';
import type { BrowserTab } from '@/lib/types';

/**
 * The open tab's connection: probing it, polling screenshots for local tabs,
 * and bringing a dead or sleeping session back.
 */
export function useBrowserSession({ selectedBrowserTabId, tab, refreshBrowserTabs, controlling, frameRevision }: {
  selectedBrowserTabId: string | null | undefined;
  tab: BrowserTab | undefined;
  refreshBrowserTabs: () => Promise<unknown>;
  controlling: boolean;
  frameRevision: number;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [screenshot, setScreenshot] = useState<{ tabId: string; url: string } | null>(null);
  const screenshotUrl = screenshot && screenshot.tabId === selectedBrowserTabId ? screenshot.url : null;
  const [validatedLiveKey, setValidatedLiveKey] = useState<string | null>(null);
  // Keep a bounded set of frames while this view is mounted. Never persist page
  // contents to localStorage or share blob URLs between workspace views.
  const frames = useRef(new Map<string, string>());
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [sessionDead, setSessionDead] = useState(false);
  const [sessionAsleep, setSessionAsleep] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [liveRevision, setLiveRevision] = useState(0);
  const recoveryInFlight = useRef(false);
  const validationGeneration = useRef(0);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const liveFrameRef = useRef<HTMLIFrameElement>(null);
  const failCountRef = useRef(0);
  const refreshFrameRef = useRef<(() => void) | null>(null);
  useEffect(() => { setRecoveryError(null); }, [selectedBrowserTabId]);

  useEffect(() => {
    const cache = frames.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  // Focus once on takeover (or when the first frame arrives), not on every
  // screenshot refresh: people can still deliberately return to the composer.
  const hasScreenshot = !tab?.liveUrl && !!screenshotUrl;
  useEffect(() => {
    if (controlling) (liveFrameRef.current || keyboardRef.current)?.focus({ preventScroll: true });
    else if (document.activeElement === keyboardRef.current) keyboardRef.current?.blur();
  }, [controlling, hasScreenshot]);

  // Probe without waking sleeping browsers. Only an explicit user action
  // reactivates a session; a provider outage must not destroy a saved login.
  const hasLiveUrl = !!tab?.liveUrl;
  useEffect(() => {
    if (!selectedBrowserTabId || !hasLiveUrl) return;
    let cancelled = false;
    let validating = false;
    setSessionAsleep(false);
    setSessionDead(false);
    const validate = async (initial: boolean) => {
      if (validating || recoveryInFlight.current) return;
      validating = true;
      const generation = validationGeneration.current;
      if (initial) setReconnecting(true);
      try {
        const checked = await workspaceApi.validateBrowserTab(selectedBrowserTabId);
        if (cancelled || recoveryInFlight.current || generation !== validationGeneration.current) return;
        setSessionDead(checked.connectionStatus === 'unknown' || checked.connectionStatus === 'dead');
        setSessionAsleep(!!checked.asleep);
        setValidatedLiveKey(checked.connectionStatus === 'alive' && !checked.asleep ? `${selectedBrowserTabId}:${tab?.liveUrl}` : null);
        // Another worker may have recreated this saved tab since the iframe
        // mounted. Refresh its current URL even after the agent has finished.
        if (checked.liveUrl && checked.liveUrl !== tab?.liveUrl) await refreshBrowserTabs();
      } catch {
        if (!cancelled && generation === validationGeneration.current) setSessionDead(true);
      } finally {
        validating = false;
        if (!cancelled && initial && !recoveryInFlight.current) setReconnecting(false);
      }
    };
    validate(true);
    const interval = setInterval(() => validate(false), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedBrowserTabId, hasLiveUrl, tab?.liveUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Local browsers use these frames as their live view. Cloud browsers keep a
  // low-frequency backup only after validation, without waking an unavailable
  // or sleeping session just to obtain a preview.
  const cloudReady = validatedLiveKey === `${selectedBrowserTabId}:${tab?.liveUrl}`
    && !sessionDead && !sessionAsleep && !tab?.asleep && !reconnecting;
  useEffect(() => {
    if (!selectedBrowserTabId || !tab) { setScreenshot(null); return; }
    const tabId = selectedBrowserTabId;
    const cached = frames.current.get(tabId);
    setScreenshot(cached ? { tabId, url: cached } : null);
    if (hasLiveUrl && !cloudReady) return;
    const abort = new AbortController();
    failCountRef.current = 0;
    if (!hasLiveUrl) { setSessionDead(false); setSessionAsleep(false); }
    let fetching = false;
    const fetchScreenshot = async () => {
      if (fetching || abort.signal.aborted || (hasLiveUrl && document.hidden)) return;
      fetching = true;
      try {
        const res = await workspaceApi.fetchBrowserScreenshot(tabId, abort.signal);
        const blob = await res.blob();
        if (abort.signal.aborted) return;
        failCountRef.current = 0;
        // A backup frame succeeding/failing must not override cloud liveness.
        if (!hasLiveUrl) setSessionDead(false);
        const previous = frames.current.get(tabId);
        const url = URL.createObjectURL(blob);
        frames.current.delete(tabId);
        frames.current.set(tabId, url);
        setScreenshot({ tabId, url });
        if (previous) URL.revokeObjectURL(previous);
        while (frames.current.size > 8) {
          const oldest = frames.current.keys().next().value!;
          URL.revokeObjectURL(frames.current.get(oldest)!);
          frames.current.delete(oldest);
        }
        setLoading(false);
      } catch {
        if (!abort.signal.aborted && !hasLiveUrl) {
          failCountRef.current++;
          if (failCountRef.current >= 3) { setSessionDead(true); setLoading(false); }
        }
        // Preserve the last successful frame on network/provider failure.
      } finally { fetching = false; }
    };
    refreshFrameRef.current = hasLiveUrl ? null : fetchScreenshot;
    if (!hasLiveUrl) setLoading(true);
    void fetchScreenshot();
    const interval = setInterval(fetchScreenshot, hasLiveUrl ? 30000 : 2000);
    return () => {
      abort.abort();
      refreshFrameRef.current = null;
      clearInterval(interval);
    };
  }, [selectedBrowserTabId, !!tab, hasLiveUrl, cloudReady]);

  useEffect(() => { refreshFrameRef.current?.(); }, [frameRevision]);

  const handleReconnect = async () => {
    if (!tab || reconnecting) return;
    setReconnecting(true);
    setRecoveryError(null);
    recoveryInFlight.current = true;
    validationGeneration.current++;
    try {
      await workspaceApi.reactivateBrowserTab(tab.id);
      await refreshBrowserTabs();
      setSessionAsleep(false);
      setLiveRevision((value) => value + 1);
      setSessionDead(false);
      failCountRef.current = 0;
      setLoading(true);
      toast.success(t('browser.reconnected'));
    } catch (err) {
      setSessionDead(true);
      const message = err instanceof ApiError
        ? err.serverMessage || t('browser.reconnectFailed')
        : t('browser.reconnectFailed');
      setRecoveryError(message);
    } finally {
      recoveryInFlight.current = false;
      setReconnecting(false);
    }
  };

  const handleReplace = async () => {
    if (!tab || reconnecting) return;
    setReconnecting(true);
    recoveryInFlight.current = true;
    validationGeneration.current++;
    try {
      const current = await workspaceApi.getBrowserTab(tab.id);
      const ok = await confirm({
        title: t('browser.replaceTitle'),
        description: t('browser.replaceDescription'),
        confirmText: t('browser.replace'),
        destructive: true,
      });
      if (!ok) return;
      await workspaceApi.replaceBrowserTab(current.id, current.sessionId);
      await refreshBrowserTabs();
      setRecoveryError(null);
      setSessionAsleep(false);
      setSessionDead(false);
      setLiveRevision((value) => value + 1);
      failCountRef.current = 0;
      setLoading(true);
    } catch (err) {
      setRecoveryError(err instanceof ApiError
        ? err.serverMessage || t('browser.reconnectFailed') : t('browser.reconnectFailed'));
    } finally {
      recoveryInFlight.current = false;
      setReconnecting(false);
    }
  };

  return {
    screenshotUrl, loading, reconnecting, sessionDead, sessionAsleep, recoveryError, liveRevision,
    keyboardRef, liveFrameRef, handleReconnect, handleReplace,
  };
}

export type BrowserSession = ReturnType<typeof useBrowserSession>;
