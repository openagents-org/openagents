'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, workspaceApi } from '@/lib/api';
import type { ShareRequest } from '@/lib/jam-api';
import type { DecideOutcome } from '@/components/guest-thread/share-request-status';
import { GuestRequestsBanner } from './guest-requests-banner';

const POLL_MS = 15000;

/**
 * Guests' requests waiting in a shared thread, for its owner in the full
 * workspace (after keeping it): the same banner as the owner page. Quietly
 * absent for people who can't decide (the list answers 401/403).
 */
export function WorkspaceGuestRequests({ channel }: { channel: string }) {
  const [requests, setRequests] = useState<ShareRequest[]>([]);
  const [allowed, setAllowed] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await workspaceApi.listGuestRequests(channel);
      setRequests(list.filter((r) => r.status === 'pending'));
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404)) setAllowed(false);
    }
  }, [channel]);

  useEffect(() => {
    setRequests([]);
    setAllowed(true);
  }, [channel]);

  useEffect(() => {
    if (!allowed) return;
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, POLL_MS);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [allowed, load]);

  const decide = useCallback(async (id: string, decision: 'approve' | 'decline'): Promise<DecideOutcome> => {
    try {
      await workspaceApi.decideGuestRequest(id, channel, decision);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      return 'ok';
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setRequests((prev) => prev.filter((r) => r.id !== id));
        void load();
        return 'conflict';
      }
      return 'failed';
    }
  }, [channel, load]);

  if (!allowed) return null;
  return <GuestRequestsBanner requests={requests} onDecide={decide} />;
}
