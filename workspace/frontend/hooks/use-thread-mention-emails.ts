'use client';

import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { dmPair } from '@/lib/dm';
import { THREAD_PARTICIPANTS_CHANGED } from '@/lib/thread-participants';
import { useWorkspace } from '@/lib/workspace-context';

/** Suggestions follow actual membership, not everyone who can view a public thread. */
export function useThreadMentionParticipants(channel: string | null, pickerOpen: boolean): { emails: string[]; agents: string[] } {
  const { workspace, currentUser } = useWorkspace();
  const key = JSON.stringify([workspace?.workspaceId, currentUser.id, channel]);
  const isDM = channel?.startsWith('dm:');
  const [state, setState] = useState<{ key: string; emails: string[]; agents: string[] } | null>(null);

  useEffect(() => {
    if (!channel || isDM) return;
    let active = true;
    let request = 0;
    const refresh = async () => {
      const version = ++request;
      try {
        const data = await workspaceApi.getChannelParticipants(channel);
        if (active && version === request) setState({ key, emails: data.humans.map(p => p.email.toLowerCase()), agents: data.agents.filter(a => a.request_access === 'yes' || a.request_access === 'approval').map(a => a.agent_name) });
      } catch {
        if (active && version === request) setState(null);
      }
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === channel) void refresh();
    };
    void refresh();
    window.addEventListener(THREAD_PARTICIPANTS_CHANGED, changed);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener(THREAD_PARTICIPANTS_CHANGED, changed);
      window.removeEventListener('focus', refresh);
    };
  }, [channel, isDM, key, pickerOpen]);

  if (isDM) return { emails: dmPair(channel).filter(p => p.startsWith('human:')).map(p => p.slice(6).toLowerCase()), agents: dmPair(channel).filter(p => p.startsWith('openagents:')).map(p => p.slice(11)) };
  return state?.key === key ? state : { emails: [], agents: [] };
}

export function useThreadMentionEmails(channel: string | null, pickerOpen: boolean): string[] {
  return useThreadMentionParticipants(channel, pickerOpen).emails;
}
