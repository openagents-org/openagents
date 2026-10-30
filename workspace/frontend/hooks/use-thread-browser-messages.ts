'use client';

import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { eventToMessage, type WorkspaceMessage } from '@/lib/types';
import { threadBrowserLinks } from '@/lib/thread-browser';

/** History omits tool steps. Recover only browser references for legacy tabs;
 * keep these steps out of the chat transcript and never infer from presence. */
export function useThreadBrowserMessages(messages: WorkspaceMessage[]): WorkspaceMessage[] {
  const { workspace, currentSessionId, browserTabs = [], refreshBrowserTabs } = useWorkspace();
  const tabIds = browserTabs.filter(tab => tab.status === 'active' && !tab.artifactChannels?.length)
    .map(tab => tab.id).sort().join(',');
  // Finishing a run removes live tool steps from the transcript. Reload the
  // references for a newly published link, even when the tab list is unchanged.
  const links = threadBrowserLinks(messages, currentSessionId || '').join(',');
  const key = `${workspace?.workspaceId}:${currentSessionId}:${tabIds}:${links}`;
  const [history, setHistory] = useState<{ key: string; messages: WorkspaceMessage[] } | null>(null);
  useEffect(() => {
    // The final browser can be created between the last working-state poll and
    // completion. Fetch it once the agent shares the result, even when idle.
    if (currentSessionId && links) void refreshBrowserTabs().catch(() => {});
  }, [currentSessionId, links, refreshBrowserTabs]);
  useEffect(() => {
    if (!currentSessionId || !tabIds) return;
    let cancelled = false;
    const pair = currentSessionId.startsWith('dm:') ? currentSessionId.slice(3).split(',') : null;
    if (pair && pair.length !== 2) return;
    const load = async () => {
      try {
        const result = pair
          ? await workspaceApi.pollConversation(pair[0], pair[1], { sort: 'desc', limit: 100 })
          : await workspaceApi.pollEvents({ channel: currentSessionId, type: 'workspace.message', search: '/v1/browser/tabs/', sort: 'desc', limit: 50 });
        const scoped = result.events.filter(event => pair
          ? pair.includes(event.source) && pair.includes(event.target) && event.source !== event.target
          : event.target === `channel/${currentSessionId}`);
        if (!cancelled) setHistory({ key, messages: scoped.map(event => ({ ...eventToMessage(event), sessionId: currentSessionId })) });
      } catch { /* Live updates and explicit associations continue to work. */ }
    };
    void load();
    return () => { cancelled = true; };
  }, [key, currentSessionId, tabIds]);
  return history?.key === key ? [...history.messages, ...messages] : messages;
}
