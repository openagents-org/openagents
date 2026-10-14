// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workspace: { slug: 'team' } }) }));
vi.mock('@/hooks/use-team-roster', () => ({ useHumanNames: () => ({ 'sam@example.com': 'Sam Wang' }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, args?: { name: string }) => args ? `Replying to ${args.name}` : key }));
import { ReplyCitation } from './reply-citation';
it('shows the actual author, links to the original message, and removes recalled excerpt text', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); const root = createRoot(host);
  const citation = { message_id: 'original-id', thread_id: 'thread-id', sender_name: 'Sam', sender_address: 'human:sam@example.com', content: 'Original words' };
  await act(async () => root.render(createElement(ReplyCitation, { citation })));
  expect(host.textContent).toContain('Replying to Sam Wang');
  expect(host.textContent).toContain('Original words');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/team/threads/thread-id/messages/original-id');
  await act(async () => root.render(createElement(ReplyCitation, { citation: { ...citation, recalled: true } })));
  expect(host.textContent).not.toContain('Original words');
  const cancel = vi.fn();
  await act(async () => root.render(createElement(ReplyCitation, { citation, onCancel: cancel })));
  await act(async () => host.querySelector('button')!.click());
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});
