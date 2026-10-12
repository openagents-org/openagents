import { expect, it } from 'vitest';
import { threadLink, resolveThreadLink } from './thread-link';

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
