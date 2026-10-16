import { describe, expect, it } from 'vitest';
import { threadBrowserArtifacts, threadBrowserTabs } from './thread-browser';
import type { BrowserTab, WorkspaceMessage } from './types';

const tab = { id: 'openreview', status: 'active', artifactChannels: [], url: 'https://openreview.net/', liveUrl: 'https://www.browserfabric.com/live/session-one', createdBy: 'openagents:bot' } as unknown as BrowserTab;
const message = (content: string, sessionId = 'paper-review') => ({ sessionId, content, metadata: {} }) as WorkspaceMessage;

describe('browser links from connectors without thread association', () => {
  it('shows the exact published session in both the shelf and live preview', () => {
    const messages = [message(`OpenReview is ready: [watch live](${tab.liveUrl}).`)];
    expect(threadBrowserArtifacts([tab], 'paper-review', messages)).toEqual([tab]);
    expect(threadBrowserTabs([tab], 'paper-review', messages)).toEqual([tab]);
  });
  it('does not match a website, a different live session, or another thread', () => {
    for (const messages of [[message(tab.url)], [message(tab.liveUrl + '-other')], [message(tab.liveUrl!, 'other')]]) {
      expect(threadBrowserTabs([tab], 'paper-review', messages)).toEqual([]);
    }
    expect(threadBrowserTabs([tab], 'paper-review', [{ ...message(tab.liveUrl!), metadata: { recalled: true } }])).toEqual([]);
  });
  it('does not follow a linked tab that is now being driven in another thread', () => {
    const moved = { ...tab, artifactChannels: ['other'] };
    const messages = [message(tab.liveUrl!)];
    expect(threadBrowserArtifacts([moved], 'paper-review', messages)).toEqual([moved]);
    expect(threadBrowserTabs([moved], 'paper-review', messages)).toEqual([]);
    expect(threadBrowserArtifacts([{ ...tab, status: 'closed' }], 'paper-review', messages)).toEqual([]);
  });
  it('uses stable tab IDs from the owning agent tool activity after the live link changes', () => {
    const stable = { ...tab, id: '9fab4574-be88-4a5f-8b68-17504e4e2712' };
    const step = { ...message(`Bash curl https://workspace.example/v1/browser/tabs/${stable.id}/snapshot`), messageType: 'status', senderType: 'agent', senderAddress: stable.createdBy };
    expect(threadBrowserTabs([stable], 'paper-review', [step])).toEqual([stable]);
    expect(threadBrowserTabs([stable], 'paper-review', [{ ...step, senderAddress: 'openagents:other' }])).toEqual([]);
    expect(threadBrowserTabs([stable], 'paper-review', [{ ...step, sessionId: 'other' }])).toEqual([]);
    expect(threadBrowserTabs([stable], 'paper-review', [{ ...step, messageType: 'chat' }])).toEqual([]);
  });
});
