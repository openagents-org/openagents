import { describe, expect, it } from 'vitest';
import { resolveThreadBrowserLink, browserFabricLiveUrl, browserLinksInText, threadBrowserLinks, threadBrowserArtifacts, threadBrowserTabs } from './thread-browser';
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
    expect(threadBrowserTabs([stable], 'paper-review', [{ ...step, senderAddress: 'openagents:other' }])).toEqual([stable]);
    expect(threadBrowserTabs([stable], 'paper-review', [{ ...step, sessionId: 'other' }])).toEqual([]);
    expect(threadBrowserTabs([stable], 'paper-review', [{ ...step, messageType: 'chat' }])).toEqual([]);
  });
});

it('accepts only BrowserFabric live-view URLs from prose', () => {
  const url = 'https://www.browserfabric.com/live/session-1';
  expect(browserLinksInText(`Watch [here](${url}). Or ${url}?embed=1`)).toEqual([url]);
  expect(browserLinksInText('`' + url + '`')).toEqual([]);
  for (const bad of ['https://browserfabric.com.evil.test/live/x', 'http://browserfabric.com/live/x', 'https://user@browserfabric.com/live/x', 'https://browserfabric.com/settings', 'https://browserfabric.com:8443/live/x']) expect(browserFabricLiveUrl(bad)).toBeNull();
});
it('keeps the newest live link per agent in this thread, excluding recalled and status messages', () => {
  const msg = (suffix: string, createdAt: string, extra = {}) => ({ ...message('https://browserfabric.com/live/' + suffix), senderType: 'agent', senderName: 'bot', messageType: 'chat', createdAt, ...extra });
  const messages = [msg('old', '2026-10-15'), msg('new', '2026-10-16'), msg('recalled', '2026-10-17', {metadata:{recalled:true}}), msg('tool', '2026-10-17', {messageType:'status'}), msg('elsewhere', '2026-10-17', {sessionId:'other'})];
  expect(threadBrowserLinks(messages, 'paper-review')).toEqual(['https://browserfabric.com/live/new']);
});

it('follows a rotated link only through an unambiguous stable tab in this thread', () => {
  const current = { ...tab, id: 'ac86e88a-be87-4c2b-b936-43524957a00d', liveUrl: 'https://www.browserfabric.com/live/new-token' };
  const oldLink = 'https://www.browserfabric.com/live/old-token';
  const published = { ...message(oldLink), senderType: 'agent', messageType: 'chat', senderAddress: current.createdBy };
  const tool = { ...message(`/v1/browser/tabs/${current.id}/snapshot`), senderType: 'agent', messageType: 'status', senderAddress: current.createdBy };
  expect(resolveThreadBrowserLink(oldLink, [current], 'paper-review', [published, tool])).toEqual(current);
  expect(resolveThreadBrowserLink(oldLink, [current], 'paper-review', [published])).toBeUndefined();
  expect(resolveThreadBrowserLink(oldLink, [{...current, artifactChannels:['other']}], 'paper-review', [published, tool])).toBeUndefined();
  const second = {...current, id:'second', artifactChannels:['paper-review']};
  expect(resolveThreadBrowserLink(oldLink, [current, second], 'paper-review', [published, tool])).toBeUndefined();
});

it('recovers a human-created tab from explicit shell activity and follows its rotated URL', () => {
  const reused = { ...tab, id: '3100acd9-8150-4729-a2ff-af059d440335', createdBy: 'human:user', liveUrl: 'https://www.browserfabric.com/live/reconnected' };
  const step = { ...message(`Bash › TAB=${reused.id} curl -X POST "$B/v1/browser/tabs/$TAB/navigate" -d '{"url":"https://example.com"}'`), senderType: 'agent', senderAddress: 'openagents:bot', messageType: 'status' };
  const reply = { ...message('https://www.browserfabric.com/live/expired'), senderType: 'agent', senderAddress: 'openagents:bot', messageType: 'chat' };
  expect(threadBrowserArtifacts([reused], 'paper-review', [step])).toEqual([reused]);
  expect(resolveThreadBrowserLink(reply.content, [reused], 'paper-review', [step, reply])).toEqual(reused);
  expect(resolveThreadBrowserLink(reply.content, [reused], 'paper-review', [{ ...step, senderAddress: 'openagents:other' }, reply])).toBeUndefined();
  for (const content of [`TAB=${reused.id}; TAB=unknown; curl /v1/browser/tabs/$TAB/snapshot`, `curl /v1/browser/tabs/$TAB/snapshot; TAB=${reused.id}`, `TAB=${reused.id}; echo unrelated`]) {
    expect(threadBrowserTabs([reused], 'paper-review', [{...step,content}])).toEqual([]);
  }
  expect(threadBrowserTabs([], 'paper-review', [step])).toEqual([]);
  expect(threadBrowserTabs([reused], 'other', [step])).toEqual([]);
});

it('binds a rotated reply to the last preceding browser action in a multi-browser thread', () => {
  const older = { ...tab, id: 'b74094a9-d5c9-4680-9c7a-1b694bc8ef51', createdBy: 'human:user', lastActiveAt: '2026-10-27T09:00:00Z' };
  const current = { ...tab, id: 'a4d76856-7089-46fd-a4c9-a3a9447e277f', lastActiveAt: '2026-10-27T08:40:00Z' };
  const expired = 'https://www.browserfabric.com/live/rotated';
  const step = (id: string, createdAt: string, extra = {}) => ({ ...message(`T=${id}; curl /v1/browser/tabs/$T/evaluate`), createdAt, senderType: 'agent', messageType: 'status', senderAddress: 'openagents:bot', ...extra });
  const reply = { ...message(expired), createdAt: '2026-10-27T08:44:00Z', senderType: 'agent', messageType: 'chat', senderAddress: 'openagents:bot' };
  const earlier = step(older.id, '2026-10-27T08:40:00Z');
  const latest = step(current.id, '2026-10-27T08:43:00Z');
  const messages = [reply, earlier, latest];
  expect(resolveThreadBrowserLink(expired, [older, current], 'paper-review', messages)).toEqual(current);
  expect(threadBrowserTabs([older, current], 'paper-review', messages)).toEqual([current, older]);
  // Later jobs and another agent's activity cannot reinterpret this reply.
  expect(resolveThreadBrowserLink(expired, [older, current], 'paper-review', [...messages, step(older.id, '2026-10-27T08:45:00Z'), step(older.id, '2026-10-27T08:43:30Z', {senderAddress:'openagents:other'})])).toEqual(current);
  expect(resolveThreadBrowserLink(expired, [older], 'paper-review', messages)).toBeUndefined();
  expect(resolveThreadBrowserLink(expired, [older, {...current, artifactChannels:['other']}], 'paper-review', messages)).toBeUndefined();
  expect(resolveThreadBrowserLink(expired, [older, current], 'paper-review', [...messages, step(older.id, latest.createdAt)])).toBeUndefined();
  const ambiguous = {...latest, content: `/v1/browser/tabs/${older.id}/snapshot /v1/browser/tabs/${current.id}/snapshot`};
  expect(resolveThreadBrowserLink(expired, [older, current], 'paper-review', [earlier, ambiguous, reply])).toBeUndefined();
});
