// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('@/lib/api', () => {
  class ApiError extends Error { constructor(public status: number) { super(`API ${status}`); } }
  return { ApiError, workspaceApi: { listGuestRequests: vi.fn(), decideGuestRequest: vi.fn() } };
});

import { WorkspaceGuestRequests } from './workspace-guest-requests';
import { ApiError, workspaceApi } from '@/lib/api';

const REQUEST = { id: 'r1', status: 'pending' as const, guest: { id: 'g1', name: 'Maya' }, messageId: 'e4', content: '@pr-reviewer check #42', createdAt: null };

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

async function render() {
  await act(async () => root.render(React.createElement(WorkspaceGuestRequests, { channel: 'share-abc' })));
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
}
async function click(selector: string) {
  await act(async () => { (document.querySelector(selector) as HTMLElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
}

it('shows waiting guest requests and approves one from the list', async () => {
  vi.mocked(workspaceApi.listGuestRequests).mockResolvedValue([REQUEST]);
  vi.mocked(workspaceApi.decideGuestRequest).mockResolvedValue({ ...REQUEST, status: 'approved' });
  await render();
  expect(workspaceApi.listGuestRequests).toHaveBeenCalledWith('share-abc');
  expect(document.querySelector('[data-guest-requests="1"]')?.textContent).toContain('share.guestRequestsWaiting:{"count":1}');
  await click('[data-guest-requests-review]');
  const row = document.querySelector('[data-guest-request="r1"]')!;
  expect(row.textContent).toContain('share.requestFrom:{"guest":"Maya"}');
  expect(row.textContent).toContain('@pr-reviewer check #42');
  await click('[data-guest-request-decide="approve"]');
  expect(workspaceApi.decideGuestRequest).toHaveBeenCalledWith('r1', 'share-abc', 'approve');
  expect(document.querySelector('[data-guest-requests]')).toBeNull();
});

it('drops a request someone else already decided', async () => {
  vi.mocked(workspaceApi.listGuestRequests).mockResolvedValueOnce([REQUEST]).mockResolvedValue([]);
  vi.mocked(workspaceApi.decideGuestRequest).mockRejectedValue(new (ApiError as unknown as new (s: number) => Error)(409));
  await render();
  await click('[data-guest-requests-review]');
  await click('[data-guest-request-decide="decline"]');
  expect(workspaceApi.decideGuestRequest).toHaveBeenCalledWith('r1', 'share-abc', 'decline');
  expect(document.querySelector('[data-guest-requests]')).toBeNull();
});

it('stays hidden for people who can’t decide', async () => {
  vi.mocked(workspaceApi.listGuestRequests).mockRejectedValue(new (ApiError as unknown as new (s: number) => Error)(403));
  await render();
  expect(document.querySelector('[data-guest-requests]')).toBeNull();
  expect(workspaceApi.listGuestRequests).toHaveBeenCalledTimes(1);
});
