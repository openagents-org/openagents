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
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
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
  const prevBlobRef = useRef<string | null>(null);
  const failCountRef = useRef(0);
  const refreshFrameRef = useRef<(() => void) | null>(null);
  useEffect(() => { setRecoveryError(null); }, [selectedBrowserTabId]);

  // Focus once on takeover (or when the first frame arrives), not on every
  // screenshot refresh: people can still deliberately return to the composer.
  const hasScreenshot = !!screenshotUrl;
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

  // Screenshot polling — only for local (non-cloud) tabs without a live view.
  useEffect(() => {
    if (!selectedBrowserTabId || !tab || tab.liveUrl) {
      setScreenshotUrl(null);
      return;
    }
    let cancelled = false;
    setScreenshotUrl(null);
    failCountRef.current = 0;
    setSessionDead(false);
    let fetching = false;
    const fetchScreenshot = async () => {
      if (fetching || cancelled) return;
      fetching = true;
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
          if (failCountRef.current >= 3) { setSessionDead(true); setLoading(false); }
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
        if (!cancelled && failCountRef.current >= 3) { setSessionDead(true); setLoading(false); }
      } finally { fetching = false; }
    };
    refreshFrameRef.current = fetchScreenshot;
    setLoading(true);
    fetchScreenshot();
    const interval = setInterval(fetchScreenshot, 2000);
    return () => {
      cancelled = true;
      refreshFrameRef.current = null;
      clearInterval(interval);
      if (prevBlobRef.current) { URL.revokeObjectURL(prevBlobRef.current); prevBlobRef.current = null; }
    };
  }, [selectedBrowserTabId, !!tab, hasLiveUrl]);

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
