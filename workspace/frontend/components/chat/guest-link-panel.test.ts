// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GuestLink } from '@/lib/guest-links';

const state = vi.hoisted(() => ({
  copy: vi.fn(),
  context: {
    workspace: { slug: 'team', workspaceId: 'workspace-id' },
    sessions: [{ sessionId: 'share-abc', participants: ['pr-reviewer'] }],
    agents: [{ agentName: 'pr-reviewer', displayName: 'PR Reviewer' }],
  },
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => state.context }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  useFormatters: () => ({ formatDateTime: (iso: string) => `DT(${iso.slice(0, 10)})` }),
}));
vi.mock('@/lib/api', () => {
  class ApiError extends Error { constructor(public status: number) { super(`API ${status}`); } }
  return {
    ApiError,
    workspaceApi: {
      createShare: vi.fn(),
      getThreadLink: vi.fn(async (sessionId: string) => ({ id: 'thread-link-id', session_id: sessionId })),
      listGuestLinks: vi.fn(),
      createGuestLink: vi.fn(),
      updateGuestLinkExpiry: vi.fn(),
      revokeGuestLink: vi.fn(),
    },
  };
});
vi.mock('@/lib/share-origin', () => ({ shareOrigin: () => 'https://app.test' }));
vi.mock('@/hooks/use-copy-to-clipboard', () => ({ useCopyToClipboard: () => ({ isCopied: false, copyToClipboard: state.copy }) }));

import { ShareDialog } from './share-dialog';
import { ApiError, workspaceApi } from '@/lib/api';

vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const LIVE: GuestLink = {
  id: 'link-1', channel: 'share-abc', url: 'https://app.test/share/thread/tok-1', canPost: true,
  expiresAt: null, revokedAt: null, createdAt: '2026-11-20T00:00:00Z',
};

let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workspaceApi.listGuestLinks).mockResolvedValue([LIVE]);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

async function render(sessionId = 'share-abc') {
  await act(async () => root.render(React.createElement(ShareDialog, { open: true, sessionId, onOpenChange: () => {} })));
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
}
const text = () => document.body.textContent || '';
const buttons = () => [...document.querySelectorAll('button')];
function button(label: string) { return buttons().find((b) => b.textContent === label); }
async function click(el: Element | undefined) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
}

it('opens a shared thread on its live guest link, with copy and the plain-language hint', async () => {
  await render();
  expect(workspaceApi.listGuestLinks).toHaveBeenCalledWith('share-abc');
  expect(document.querySelector('button[role="tab"][data-state="active"]')?.textContent).toBe('share.guestLink');
  expect(document.querySelector<HTMLInputElement>('input[aria-label="share.guestLink"]')?.value).toBe(LIVE.url);
  expect(text()).toContain('share.guestLinkHint:{"agent":"PR Reviewer"}');
  expect(text()).toContain('share.guestLinkNeverExpires');
  expect(document.querySelector('[data-expiry-choice="never"]')?.getAttribute('aria-pressed')).toBe('true');
  await click(button('share.copyLink'));
  expect(state.copy).toHaveBeenCalledWith(LIVE.url);
});

it('changes the expiry with PATCH and shows the new date', async () => {
  vi.useFakeTimers({ now: Date.parse('2026-11-22T12:00:00Z'), toFake: ['Date'] });
  try {
    vi.mocked(workspaceApi.updateGuestLinkExpiry).mockImplementation(async (id, expiresAt) => ({ ...LIVE, id, expiresAt }));
    await render();
    await click(document.querySelector('[data-expiry-choice="7d"]')!);
    expect(workspaceApi.updateGuestLinkExpiry).toHaveBeenCalledWith('link-1', '2026-11-29T12:00:00.000Z');
    expect(document.querySelector('[data-guest-link-expiry]')?.textContent).toBe('share.guestLinkExpiresOn:{"date":"DT(2026-11-29)"}');
    expect(document.querySelector('[data-expiry-choice="7d"]')?.getAttribute('aria-pressed')).toBe('true');
    await click(document.querySelector('[data-expiry-choice="never"]')!);
    expect(workspaceApi.updateGuestLinkExpiry).toHaveBeenLastCalledWith('link-1', null);
    expect(document.querySelector('[data-guest-link-expiry]')?.textContent).toBe('share.guestLinkNeverExpires');
  } finally {
    vi.useRealTimers();
  }
});

it('turns the link off only after confirming, then offers a new link', async () => {
  vi.mocked(workspaceApi.revokeGuestLink).mockResolvedValue({ ...LIVE, revokedAt: '2026-11-22T12:00:00Z' });
  vi.mocked(workspaceApi.createGuestLink).mockResolvedValue({ ...LIVE, id: 'link-2', url: 'https://app.test/share/thread/tok-2', createdAt: '2026-11-22T12:01:00Z' });
  await render();
  await click(button('share.guestLinkTurnOff'));
  expect(workspaceApi.revokeGuestLink).not.toHaveBeenCalled();
  expect(text()).toContain('share.guestLinkTurnOffConfirm');
  // Cancel keeps the link.
  await click(button('common.cancel'));
  expect(text()).not.toContain('share.guestLinkTurnOffConfirm');
  await click(button('share.guestLinkTurnOff'));
  const confirm = document.querySelector('[role="alertdialog"]')!;
  await click([...confirm.querySelectorAll('button')].find((b) => b.textContent === 'share.guestLinkTurnOff'));
  expect(workspaceApi.revokeGuestLink).toHaveBeenCalledWith('link-1');
  expect(document.querySelector('[data-guest-link-state="off"]')).not.toBeNull();
  expect(text()).toContain('share.guestLinkOff');
  expect(document.querySelector('input[aria-label="share.guestLink"]')).toBeNull();

  await click(button('share.createGuestLink'));
  expect(workspaceApi.createGuestLink).toHaveBeenCalledWith('share-abc', null);
  expect(document.querySelector('[data-guest-link-state="live"]')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('input[aria-label="share.guestLink"]')?.value).toBe('https://app.test/share/thread/tok-2');
});

it('shows an expired link as stopped, with a way to make a new one', async () => {
  vi.mocked(workspaceApi.listGuestLinks).mockResolvedValue([{ ...LIVE, expiresAt: '2026-01-01T00:00:00Z' }]);
  await render();
  expect(text()).toContain('share.guestLinkExpired:{"date":"DT(2026-01-01)"}');
  expect(button('share.createGuestLink')).toBeTruthy();
});

it('keeps the link when a change fails, and says so', async () => {
  vi.mocked(workspaceApi.revokeGuestLink).mockRejectedValue(new Error('boom'));
  await render();
  await click(button('share.guestLinkTurnOff'));
  const confirm = document.querySelector('[role="alertdialog"]')!;
  await click([...confirm.querySelectorAll('button')].find((b) => b.textContent === 'share.guestLinkTurnOff'));
  expect(text()).toContain('share.guestLinkUpdateFailed');
  expect(document.querySelector('[data-guest-link-state="live"]')).not.toBeNull();
});

it('adds the guest tab to an ordinary thread only when it has guest links', async () => {
  vi.mocked(workspaceApi.listGuestLinks).mockResolvedValue([]);
  await render('channel-1');
  expect(button('share.guestLink')).toBeUndefined();
  expect(document.querySelector('button[role="tab"][data-state="active"]')?.textContent).toBe('share.threadLink');

  vi.mocked(workspaceApi.listGuestLinks).mockResolvedValue([{ ...LIVE, channel: 'channel-2' }]);
  await render('channel-2');
  expect(button('share.guestLink')).toBeTruthy();
});

it('falls back to the thread link for people who cannot manage guest links', async () => {
  vi.mocked(workspaceApi.listGuestLinks).mockRejectedValue(new (ApiError as unknown as new (status: number) => Error)(403));
  await render();
  expect(button('share.guestLink')).toBeUndefined();
  expect(document.querySelector('button[role="tab"][data-state="active"]')?.textContent).toBe('share.threadLink');
});
