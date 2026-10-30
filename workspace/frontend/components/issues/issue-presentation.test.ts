// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IssueAvatar } from './issue-ui';
import { IssueAttachments } from './issue-attachments';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/use-team-roster', () => ({ useTeamRoster: () => [
  { email: 'owner@example.com', avatarUrl: '/owner.png' },
  { email: 'assignee@example.com', avatarUrl: '/assignee.png' },
] }));
vi.mock('@/components/files/authenticated-image', () => ({
  AuthenticatedImage: ({ fileId, ...props }: { fileId: string }) => createElement('img', { ...props, src: `/test/${fileId}` }),
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('uses profile photos for owner and assignee identities, including case differences', async () => {
  await act(async () => root.render(createElement('div', {},
    createElement(IssueAvatar, { name: 'Owner', source: 'human:OWNER@example.com', size: 18 }),
    createElement(IssueAvatar, { name: 'Assignee', source: 'human:assignee@example.com', size: 18 }),
  )));
  expect(Array.from(host.querySelectorAll('img')).map(image => image.getAttribute('src'))).toEqual(['/owner.png', '/assignee.png']);
});
it('opens and closes an image preview without navigating away from the issue', async () => {
  window.history.replaceState(null, '', '/workspace/issues/issue-one');
  await act(async () => root.render(createElement(IssueAttachments, { workspaceId: 'workspace', files: [
    { file_id: 'image-one', filename: 'folder/screenshot.png', content_type: 'image/png', size: 20 },
  ] })));
  expect(host.querySelector('a')).toBeNull();
  await act(async () => host.querySelector('button')!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/test/image-one');
  expect(window.location.pathname).toBe('/workspace/issues/issue-one');
  const close = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Close')!;
  await act(async () => close.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
