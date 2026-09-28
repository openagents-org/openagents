'use client';

import { useEffect, useState } from 'react';
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
  const [me, setMe] = useState<WorkspaceMe | null>(() => (workspaceId ? cache.get(workspaceId) ?? null : null));

  useEffect(() => {
    if (!workspaceId || !workspaceApi.isConfigured()) return;
    const cached = cache.get(workspaceId);
    if (cached) { setMe(cached); return; }
    let cancelled = false;
    let p = inflight.get(workspaceId);
    if (!p) {
      p = workspaceApi.getMe();
      inflight.set(workspaceId, p);
      p.finally(() => inflight.delete(workspaceId));
    }
    p.then((m) => { cache.set(workspaceId, m); if (!cancelled) setMe(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);

  return me;
}

/** Drop the cache (e.g. after sign-in changes) so the next mount refetches. */
export function invalidateMe(workspaceId?: string) {
  if (workspaceId) cache.delete(workspaceId); else cache.clear();
}
