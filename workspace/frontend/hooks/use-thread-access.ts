'use client';
import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import type { ChannelParticipants } from '@/lib/types';

/** Permissions come from the authenticated server response, never a workspace token role. */
export function useThreadAccess(channel: string) {
  const { idToken } = useOpenAgentsAuth();
  const [state, setState] = useState<{ channel: string; identity: string | null; data: ChannelParticipants } | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => workspaceApi.getChannelParticipants(channel)
      .then(data => { if (active) setState({ channel, identity: idToken, data }); })
      .catch(() => { if (active) setState(null); });
    void load();
    const changed = () => { void load(); };
    window.addEventListener(THREAD_PARTICIPANTS_CHANGED, changed);
    return () => { active = false; window.removeEventListener(THREAD_PARTICIPANTS_CHANGED, changed); };
  }, [channel, idToken]);
  return state?.channel === channel && state.identity === idToken ? state.data : null;
}
