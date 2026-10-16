'use client';

import { useEffect, useRef, useState } from 'react';
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
// A saved profile changes the name and avatar /me reports. Cleared here so a
// view that was hidden or unmounted during the save re-reads it on return.
if (typeof window !== 'undefined') window.addEventListener('workspace-profile-updated', () => cache.clear());

export function useMe(workspaceId: string | null | undefined): WorkspaceMe | null {
  const { idToken } = useOpenAgentsAuth();
  const cacheKey = `${workspaceId || ''}:${idToken || ''}`;
  const [identity, setIdentity] = useState(cacheKey);
  const [me, setMe] = useState<WorkspaceMe | null>(() => (workspaceId ? cache.get(cacheKey) ?? null : null));
  // A view still on screen during the save re-reads at once.
  const [revision, setRevision] = useState(0);
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    const onProfile = () => setRevision((r) => r + 1);
    window.addEventListener('workspace-profile-updated', onProfile);
    return () => window.removeEventListener('workspace-profile-updated', onProfile);
  }, [cacheKey]);

  useEffect(() => {
    setIdentity(cacheKey);
    // A different workspace or sign-in starts empty; a refresh of the same one
    // keeps showing the old values until the new ones arrive.
    if (shownKey.current !== cacheKey) { shownKey.current = cacheKey; setMe(null); }
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
  }, [workspaceId, cacheKey, revision]);

  return identity === cacheKey ? me : null;
}

/** Drop the cache (e.g. after sign-in changes) so the next mount refetches. */
export function invalidateMe(workspaceId?: string) {
  if (workspaceId) { for (const key of cache.keys()) if (key.startsWith(`${workspaceId}:`)) cache.delete(key); } else cache.clear();
}
