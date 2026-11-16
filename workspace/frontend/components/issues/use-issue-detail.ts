'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { issueSignalChannel } from '@/lib/signals';
import type { IssueDetail } from '@/lib/types';
import { errorMessage, useConfirmIssueDelete } from './issue-ui';

/** Signals arriving while the tab is hidden or unfocused stay unread until the
 * person comes back to the issue. */
function useMarkIssueSignalsRead(id: string) {
  const { unreadSignals, markChannelSignalsRead } = useWorkspace();
  const signalChannel = issueSignalChannel(id);
  const hasUnreadMention = !!unreadSignals?.[signalChannel];
  useEffect(() => {
    if (!hasUnreadMention) return;
    const attentive = () => document.visibilityState === 'visible' && document.hasFocus();
    if (attentive()) {
      markChannelSignalsRead(signalChannel);
      return;
    }
    const onReturn = () => { if (attentive()) markChannelSignalsRead(signalChannel); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [hasUnreadMention, signalChannel, markChannelSignalsRead]);
}

/**
 * One issue's detail: polled every 10s while no change is in flight, with
 * `mutate` serialising changes (one at a time) and refreshing afterwards.
 */
export function useIssueDetail(id: string, { onBack, onChanged }: { onBack: () => void; onChanged: () => void }) {
  useMarkIssueSignalsRead(id);
  const confirmDelete = useConfirmIssueDelete();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const mounted = useRef(true);
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const result = await workspaceApi.getIssue(id);
      if (mounted.current && request === version.current) {
        setIssue(result);
        setLoadError('');
      }
    } catch (e) {
      if (mounted.current && request === version.current) setLoadError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    mounted.current = true;
    const load = () => {
      if (!busyRef.current) void refresh();
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      mounted.current = false;
      ++version.current;
      clearInterval(interval);
    };
  }, [refresh]);

  async function mutate(work: () => Promise<unknown>, onSuccess?: () => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    ++version.current;
    setBusy(true);
    setError('');
    try {
      await work();
      if (mounted.current) {
        onSuccess?.();
        onChanged();
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      // Also refresh after a partial failure, so a created thread stays visible.
      if (mounted.current) await refresh();
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function removeIssue() {
    if (busyRef.current || !issue) return;
    const ok = await confirmDelete(issue.title);
    if (!ok || busyRef.current) return;
    busyRef.current = true;
    // Drop any refresh in flight: it would report the issue as missing.
    ++version.current;
    setBusy(true);
    setError('');
    try {
      await workspaceApi.deleteIssue(id);
      busyRef.current = false;
      if (mounted.current) onBack();
    } catch (e) {
      busyRef.current = false;
      if (mounted.current) {
        setError(errorMessage(e));
        setBusy(false);
      }
    }
  }

  return { issue, error, setError, loadError, busy, busyRef, refresh, mutate, removeIssue };
}

export type IssueMutate = ReturnType<typeof useIssueDetail>['mutate'];
