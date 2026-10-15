import type { BrowserTab } from './types';

/** The first association is the latest thread driving this shared tab. */
export function threadBrowserTabs(tabs: BrowserTab[], channel: string): BrowserTab[] {
  return tabs.filter(tab => tab.status === 'active' && tab.artifactChannels?.[0] === channel)
    .sort((a, b) => timestamp(b) - timestamp(a));
}

function timestamp(tab: BrowserTab): number {
  const value = Date.parse(tab.activity?.at || tab.lastActiveAt || tab.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}
