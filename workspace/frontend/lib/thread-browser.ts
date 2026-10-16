import type { BrowserTab, WorkspaceMessage } from './types';

/** Older connectors share the live URL without sending a thread association.
 * Match only an exact live URL of an already accessible workspace tab. A page
 * URL or an agent's presence is not evidence that a tab belongs here. */
function referencedTabs(tabs: BrowserTab[], channel: string, messages: WorkspaceMessage[]): Set<string> {
  const links = new Set<string>();
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.sessionId !== channel || message.metadata?.recalled) continue;
    if (message.senderType === 'agent' && message.messageType === 'status') {
      for (const match of message.content.matchAll(/\/v1\/browser\/tabs\/([0-9a-f-]{36})(?=[/\s?"'`]|$)/gi)) {
        const tab = tabs.find(tab => tab.id === match[1] && tab.createdBy === message.senderAddress);
        if (tab) ids.add(tab.id);
      }
    }
    for (const match of message.content.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
      try { links.add(new URL(match[0].replace(/[),.;!?]+$/, '')).href); } catch { /* Not a URL. */ }
    }
  }
  for (const tab of tabs.filter(tab => {
    if (!tab.liveUrl) return false;
    try { return links.has(new URL(tab.liveUrl).href); } catch { return false; }
  })) ids.add(tab.id);
  return ids;
}

export function threadBrowserArtifacts(tabs: BrowserTab[], channel: string, messages: WorkspaceMessage[] = []): BrowserTab[] {
  const referenced = referencedTabs(tabs, channel, messages);
  return tabs.filter(tab => tab.status === 'active' && (tab.artifactChannels?.includes(channel) || referenced.has(tab.id)))
    .sort((a, b) => timestamp(b) - timestamp(a));
}

/** The first association is the latest thread driving this shared tab. */
export function threadBrowserTabs(tabs: BrowserTab[], channel: string, messages: WorkspaceMessage[] = []): BrowserTab[] {
  return threadBrowserArtifacts(tabs, channel, messages)
    .filter(tab => !tab.artifactChannels?.length || tab.artifactChannels[0] === channel);
}

function timestamp(tab: BrowserTab): number {
  const value = Date.parse(tab.activity?.at || tab.lastActiveAt || tab.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}
