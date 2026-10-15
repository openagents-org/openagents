'use client';

import { useEffect, useState } from 'react';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceMe } from '@/lib/types';

/**
 * The caller's identity + role in the current workspace (GET /me), cached per
 * workspace for the life of the page. The main app context deliberately does
 * not carry this (only the settings dashboard needed it until approvals);
 * components that gate an action on role — the approval card — read it here.
 */
const cache = new Map<string, WorkspaceMe>();
const inflight = new Map<string, Promise<WorkspaceMe>>();

export function useMe(workspaceId: string | null | undefined): WorkspaceMe | null {
  const { idToken } = useOpenAgentsAuth();
  const cacheKey = `${workspaceId || ''}:${idToken || ''}`;
  const [identity, setIdentity] = useState(cacheKey);
  const [me, setMe] = useState<WorkspaceMe | null>(() => (workspaceId ? cache.get(cacheKey) ?? null : null));

  useEffect(() => {
    setIdentity(cacheKey);
    setMe(null);
    if (!workspaceId || !workspaceApi.isConfigured()) return;
    const cached = cache.get(cacheKey);
    if (cached) { setMe(cached); return; }
    let cancelled = false;
    let p = inflight.get(cacheKey);
    if (!p) {
      p = workspaceApi.getMe();
      inflight.set(cacheKey, p);
      void p.then(() => inflight.delete(cacheKey), () => inflight.delete(cacheKey));
    }
    p.then((m) => { cache.set(cacheKey, m); if (!cancelled) setMe(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId, cacheKey]);

  return identity === cacheKey ? me : null;
}

/** Drop the cache (e.g. after sign-in changes) so the next mount refetches. */
export function invalidateMe(workspaceId?: string) {
  if (workspaceId) { for (const key of cache.keys()) if (key.startsWith(`${workspaceId}:`)) cache.delete(key); } else cache.clear();
}
