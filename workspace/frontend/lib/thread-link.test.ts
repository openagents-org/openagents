import { expect, it } from 'vitest';
import { threadLink, resolveThreadLink, workspaceThreadLink } from './thread-link';

it('creates a stable, encoded live link without copying tokens or other page state', () => {
  const url = threadLink('https://workspace-preview.openagents.org', 'team', 'thread/内测 & review');
  const parsed = new URL(url);
  expect(parsed.pathname).toBe('/team/threads/thread%2F%E5%86%85%E6%B5%8B%20%26%20review');
  expect(parsed.search).toBe('');
  expect(resolveThreadLink(parsed.pathname, ['thread/内测 & review'], 'human:me@example.com')).toBe('thread/内测 & review');
});
it('only resolves channels returned by access-filtered discovery', () => {
  expect(resolveThreadLink('?thread=private', ['public'], 'human:me@example.com')).toBeNull();
  expect(resolveThreadLink('?thread=deleted', [], 'human:me@example.com')).toBeNull();
});
it('opens a participant’s DM but rejects another person’s DM', () => {
  const dm = 'dm:human:me@example.com,human:sam@example.com';
  const search = new URL(threadLink('https://example.com', 'team', dm)).pathname;
  expect(resolveThreadLink(search, [], 'human:me@example.com')).toBe(dm);
  expect(resolveThreadLink(search, [], 'human:outsider@example.com')).toBeNull();
});

it('continues to resolve old query links and rejects inaccessible path links', () => {
  expect(resolveThreadLink('?thread=old', ['old'], 'human:me@example.com')).toBe('old');
  expect(resolveThreadLink('/team/threads/private', ['public'], 'human:me@example.com')).toBeNull();
  expect(resolveThreadLink('/team/threads/%ZZ', [], 'human:me@example.com')).toBeNull();
});


it('message links encode the exact target without credentials', async () => {
  const { messageLink, requestedMessageId } = await import('./thread-link');
  const url = new URL(messageLink('https://workspace.test', 'acme', 'thread-id', 'event#123&456'));
  expect(url.pathname).toBe('/acme/threads/thread-id/messages/event%23123%26456');
  expect(requestedMessageId(url.href)).toBe('event#123&456');
  expect(url.search).toBe('');
  expect(resolveThreadLink(url.href, ['thread-id'], 'human:me@example.com')).toBe('thread-id');
});


it('reads old message arguments and rejects malformed path IDs', async () => {
  const { requestedMessageId } = await import('./thread-link');
  expect(requestedMessageId('/acme/threads/thread-id?message=old-message')).toBe('old-message');
  expect(requestedMessageId('/acme/threads/thread-id/messages/%ZZ')).toBeNull();
  expect(requestedMessageId('/acme/threads/thread-id/messages/event/extra')).toBeNull();
  expect(resolveThreadLink('/acme/threads/private/messages/event', ['public'], 'human:me@example.com')).toBeNull();
});
it('recognises web links to a thread of this workspace, with or without a message', () => {
  const origins = ['https://workspace.openagents.org'];
  expect(workspaceThreadLink('https://workspace.openagents.org/team/threads/abc/messages/m%201', origins, ['team', 'ws-id']))
    .toEqual({ thread: 'abc', message: 'm 1' });
  expect(workspaceThreadLink('https://workspace.openagents.org/ws-id/threads/abc', origins, ['team', 'ws-id']))
    .toEqual({ thread: 'abc', message: null });
});
it('leaves other workspaces, other sites and other pages to the browser', () => {
  const origins = ['https://workspace.openagents.org'];
  expect(workspaceThreadLink('https://workspace.openagents.org/other/threads/abc', origins, ['team'])).toBeNull();
  expect(workspaceThreadLink('https://example.com/team/threads/abc', origins, ['team'])).toBeNull();
  expect(workspaceThreadLink('https://workspace.openagents.org/team/issues/abc', origins, ['team'])).toBeNull();
  expect(workspaceThreadLink('/team/threads/abc', origins, ['team'])).toBeNull();
});
