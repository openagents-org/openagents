import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { briefFromApi } from '@/lib/brief';
import type { ChannelBrief } from '@/lib/types';

const REFRESH_MS = 30_000;
const MESSAGE_REFRESH_DEBOUNCE_MS = 800;

/**
 * The thread's brief, refreshed on thread change, whenever `refreshKey`
 * changes (the caller passes the message count so an agent's update shows up
 * with its reply), and every 30s while the tab is visible.
 */
export function useBrief(channelName: string | null, refreshKey: unknown): { brief: ChannelBrief | null } {
  const [brief, setBrief] = useState<ChannelBrief | null>(null);
  const channelRef = useRef(channelName);
  channelRef.current = channelName;

  const reload = useCallback(async () => {
    const ch = channelRef.current;
    if (!ch || !workspaceApi.isConfigured()) return;
    try {
      const raw = await workspaceApi.getBriefRaw(ch);
      if (channelRef.current === ch) setBrief(briefFromApi(raw, ch));
    } catch {
      // Not fatal — the thread still works without its brief.
    }
  }, []);

  // Thread switch: drop the old brief and fetch the new one.
  useEffect(() => {
    setBrief(null);
    void reload();
  }, [channelName, reload]);

  // New messages: an agent may just have updated the brief.
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    const id = setTimeout(() => { void reload(); }, MESSAGE_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [refreshKey, reload]);

  // Slow poll while visible.
  useEffect(() => {
    if (!channelName) return;
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void reload();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [channelName, reload]);


  return { brief };
}
