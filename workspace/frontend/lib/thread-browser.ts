import type { BrowserTab, WorkspaceMessage } from './types';

/** Only BrowserFabric's public live-view route may be embedded from prose. */
export function browserFabricLiveUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['browserfabric.com', 'www.browserfabric.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
    if (!/^\/live\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}

export function browserLinksInText(content: string): string[] {
  const prose = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`]*`/g, '');
  return [...new Set([...prose.matchAll(/https:\/\/[^\s<>"'`]+/g)].map(match => browserFabricLiveUrl(match[0].replace(/[),.;!?]+$/, ''))).filter((url): url is string => !!url))];
}

/** Keep shared live links discoverable even after the active tab list drops them. */
export function threadBrowserLinks(messages: WorkspaceMessage[], channel: string): string[] {
  const seen = new Set<string>();
  return messages.filter(message => message.sessionId === channel && !message.metadata?.recalled && message.senderType === 'agent' && message.messageType === 'chat')
    .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))
    .flatMap(message => {
      const links = browserLinksInText(message.content);
      const sender = message.senderAddress || message.senderId || message.senderName;
      if (!links.length || seen.has(sender)) return [];
      seen.add(sender);
      return links;
    }).filter((url, i, urls) => urls.indexOf(url) === i);
}

/** Read literal tab references in tool activity, including a shell variable
 * assigned in the same command. Never execute/expand arbitrary shell text or
 * carry variables between messages (agents can run concurrent processes). */
export function browserTabIdsInToolStatus(content: string): Set<string> {
  const ids = new Set<string>();
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  // Keep this a regex literal: the production minifier can emit an unescaped
  // backtick when this character class is constructed inside a template literal.
  for (const match of content.matchAll(/\/v1\/browser\/tabs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/\s?"'`]|$)/gi)) ids.add(match[1]);
  const variables = new Map<string, { value: string; at: number }[]>();
  for (const match of content.matchAll(/(?:^|[;\s])\$?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\s]+)/g)) {
    const value = match[2].replace(/^["']|["']$/g, '');
    variables.set(match[1], [...(variables.get(match[1]) || []), { value, at: match.index! }]);
  }
  for (const match of content.matchAll(/\/v1\/browser\/tabs\/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))(?=[/\s?"'`]|$)/g)) {
    const values = variables.get(match[1] || match[2]);
    if (values?.length === 1 && values[0].at < match.index! && new RegExp(`^${uuid}$`, 'i').test(values[0].value)) ids.add(values[0].value);
  }
  return ids;
}

/** Explicit agent tool references can use a human-created or shared tab.
 * Creation identity is not the identity of the agent currently driving it. */
export function agentReferencedBrowserTabs(tabs: BrowserTab[], channel: string, messages: WorkspaceMessage[], actor?: string): Set<string> {
  const ids = new Set<string>();
  const accessible = new Set(tabs.map(tab => tab.id));
  for (const message of messages) {
    if (message.sessionId !== channel || message.metadata?.recalled || message.senderType !== 'agent' || message.messageType !== 'status') continue;
    if (actor && message.senderAddress !== actor) continue;
    for (const id of browserTabIdsInToolStatus(message.content)) if (accessible.has(id)) ids.add(id);
  }
  return ids;
}

/** Older connectors share the live URL without sending a thread association.
 * Match only an exact live URL of an already accessible workspace tab. A page
 * URL or an agent's presence is not evidence that a tab belongs here. */
function referencedTabs(tabs: BrowserTab[], channel: string, messages: WorkspaceMessage[]): Set<string> {
  const links = new Set<string>();
  const ids = agentReferencedBrowserTabs(tabs, channel, messages);
  for (const message of messages) {
    if (message.sessionId !== channel || message.metadata?.recalled) continue;
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

/** Resolve a connector's latest shared link through stable tab references in
 * this conversation when a reconnect has rotated the ephemeral live URL.
 * Never guess from the website or agent alone, or choose between multiple tabs. */
export function resolveThreadBrowserLink(url: string, tabs: BrowserTab[], channel: string, messages: WorkspaceMessage[]): BrowserTab | undefined {
  const live = browserFabricLiveUrl(url);
  if (!live) return undefined;
  const exact = tabs.find(tab => browserFabricLiveUrl(tab.liveUrl || '') === live);
  if (exact) return exact;
  if (!threadBrowserLinks(messages, channel).includes(live)) return undefined;
  const publisher = messages.filter(message => message.sessionId === channel && message.senderType === 'agent' && message.messageType === 'chat' && !message.metadata?.recalled && browserLinksInText(message.content).includes(live))
    .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0))[0];
  if (!publisher?.senderAddress) return undefined;
  const referenced = agentReferencedBrowserTabs(tabs, channel, messages, publisher.senderAddress);
  const candidates = threadBrowserTabs(tabs, channel, messages).filter(tab => referenced.has(tab.id) || tab.createdBy === publisher.senderAddress);
  return candidates.length === 1 ? candidates[0] : undefined;
}
