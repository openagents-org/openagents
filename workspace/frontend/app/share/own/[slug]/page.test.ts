// @vitest-environment jsdom
import React, { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { user: null as null | { email: string }, idToken: null as null | string, loading: false, signIn: vi.fn() },
}));
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
const formatters = { formatTime: () => 'T', formatDate: () => 'D', formatDateTime: () => 'DT' };
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => formatters }));
vi.mock('@/lib/api-base', () => ({ getApiBaseUrl: () => 'https://api.test' }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => state.auth }));
vi.mock('@/lib/auth-redirects', () => ({ goToCentralLogin: vi.fn() }));
vi.mock('@/hooks/use-copy-to-clipboard', () => ({ useCopyToClipboard: () => ({ isCopied: false, copyToClipboard: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => React.createElement('img', { alt: props.alt }) }));
vi.mock('@/components/chat/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => React.createElement('div', { 'data-testid': 'markdown' }, content),
}));
vi.mock('@/components/ui/responsive-dialog', () => {
  const pass = (tag: string) => ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-'))), children);
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? React.createElement('div', { 'data-open': '' }, children) : null),
    DialogContent: pass('div'), DialogHeader: pass('div'), DialogBody: pass('div'), DialogFooter: pass('div'),
    DialogTitle: pass('h2'), DialogDescription: pass('p'),
  };
});

import OwnerRoomPage from './page';
import { rememberKeepIntent } from '@/components/share/keep-conversation-dialog';

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const LINK = { id: 'l1', channel: 'share-abc', url: 'https://app.test/share/thread/gtok', canPost: true, expiresAt: null, revokedAt: null, createdAt: '2026-11-20T00:00:00Z' };
const ROOM = {
  workspace: { id: 'ws-1', slug: 'alex-share', name: 'Alex’s shared workspace' },
  thread: { name: 'share-abc', title: 'PR reviewer' },
  owner: { name: 'Alex' },
  agents: [{ name: 'claude-code', displayName: 'Claude Code', type: 'claude', online: true, acceptsGuests: true }],
  link: LINK,
  share: { claimed: false, movedTo: null },
};
const MESSAGES = [
  { id: 'e1', type: 'workspace.message', source: 'openagents:claude-code', target: 'channel/share-abc', payload: { content: 'Found one issue' }, metadata: { share_seed: true }, timestamp: 1, visibility: 'channel' },
  { id: 'e2', type: 'workspace.message', source: 'guest-g1@guest.invalid', target: 'channel/share-abc', payload: { content: 'Thanks!', sender_name: 'Maya' }, metadata: { guest: { id: 'g1', name: 'Maya' } }, timestamp: 2, visibility: 'channel' },
  { id: 'e3', type: 'workspace.message', source: 'human:owner', target: 'channel/share-abc', payload: { content: 'Glad it helped' }, metadata: { share_owner: true }, timestamp: 3, visibility: 'channel' },
];

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200 });
}
function serve(handler: (url: string, init?: RequestInit) => Response) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
}
function roomServer(room: unknown = ROOM, onPost?: (body: { content: string; idempotency_key: string }) => unknown) {
  return (url: string, init?: RequestInit) => {
    if (url.includes('/room/messages') && init?.method === 'POST') return ok(onPost?.(JSON.parse(String(init.body))));
    if (url.includes('/room/messages')) return ok({ messages: MESSAGES, hasMore: false });
    if (url.includes('/v1/guest-links/room')) return ok(room);
    if (url.includes('/v1/guest-links?')) return ok({ links: [LINK] });
    return new Response('{}', { status: 500 });
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  state.auth.user = null;
  state.auth.idToken = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function open(token: string | null = 'ws-token', slug = 'alex-share') {
  const thenable = <T,>(value: T) => Object.assign(Promise.resolve(value), { status: 'fulfilled', value });
  const props = { params: thenable({ slug }), searchParams: thenable(token === null ? {} : { token }) };
  await act(async () => root.render(React.createElement(Suspense, { fallback: null }, React.createElement(OwnerRoomPage, props))));
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

it('shows the room with the owner as "You", guests badged, and the guest link inline', async () => {
  serve(roomServer());
  await open();
  const text = host.textContent || '';
  expect(text).toContain('PR reviewer');
  const own = host.querySelector('[data-guest-message="e3"]')!;
  expect(own.textContent).toContain('guestThread.you');
  const guest = host.querySelector('[data-guest-message="e2"]')!;
  expect(guest.textContent).toContain('Maya');
  expect(guest.textContent).toContain('guestThread.guestBadge');
  expect(text).toContain('shareRoom.runsOn:{"agent":"Claude Code","owner":"Alex"}');
  expect(text).not.toContain('guestThread.guestNotice');
  expect(host.querySelector('[data-owner-keep]')).not.toBeNull();
  // Guest link card, loaded with the owner token.
  const card = host.querySelector('[data-owner-guest-link]')!;
  expect((card.querySelector('input') as HTMLInputElement).value).toBe(LINK.url);
  expect(card.querySelector('[data-expiry-choice="7d"]')).not.toBeNull();
  for (const call of fetchMock.mock.calls) {
    expect(String(call[0])).toMatch(/^https:\/\/api\.test\/v1\/guest-links/);
    expect(((call[1] as RequestInit).headers as Record<string, string>)['X-Workspace-Token']).toBe('ws-token');
  }
});

it('posts as the owner with the token, the @agent prefix and an idempotency key', async () => {
  serve(roomServer(ROOM, (body) => ({
    id: 'e9', type: 'workspace.message', source: 'human:owner', target: 'channel/share-abc',
    payload: { content: body.content }, metadata: { share_owner: true, client_key: body.idempotency_key }, timestamp: 9, visibility: 'channel',
  })));
  await open();
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, 'check PR 42');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit).method === 'POST')!;
  expect(post[0]).toBe('https://api.test/v1/guest-links/room/messages?network=alex-share');
  const body = JSON.parse(String((post[1] as RequestInit).body));
  expect(body.content).toBe('@claude-code check PR 42');
  expect(body.idempotency_key.length).toBeGreaterThan(8);
  expect(host.querySelector('[data-guest-message="e9"]')?.textContent).toContain('guestThread.you');
  expect(host.querySelector('[data-guest-message^="optimistic-"]')).toBeNull();
});

it('offers "Open in your workspace" once the conversation is kept', async () => {
  serve(roomServer({ ...ROOM, share: { claimed: true, movedTo: null } }));
  await open();
  expect(host.querySelector('[data-owner-keep]')).toBeNull();
  expect(host.querySelector('[data-owner-open]')?.getAttribute('href')).toBe('/alex-share/threads/share-abc');
});

it('says the conversation moved on a 410', async () => {
  serve(() => new Response(JSON.stringify({ code: 410, message: 'moved', data: { movedTo: { slug: 'team', channel: 'share-abc-2' } } }), { status: 410 }));
  await open();
  expect(host.querySelector('[data-guest-link-state="moved"]')).not.toBeNull();
  expect(host.textContent).toContain('shareRoom.movedTitle');
  expect(host.querySelector('[data-moved-open]')?.getAttribute('href')).toBe('/team/threads/share-abc-2');
});

it('shows a friendly page for an invalid owner link', async () => {
  serve(() => new Response(JSON.stringify({ code: 404, message: 'no' }), { status: 404 }));
  await open();
  expect(host.querySelector('[data-guest-link-state="not_found"]')).not.toBeNull();
  expect(host.textContent).toContain('shareRoom.notFoundTitle');
});

it('treats a link without a token as invalid, without calling the API', async () => {
  serve(roomServer());
  await open(null);
  expect(host.textContent).toContain('shareRoom.notFoundTitle');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reopens "Keep this conversation" on the choice step after signing in', async () => {
  rememberKeepIntent('alex-share');
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
  serve(roomServer());
  await open();
  expect(host.querySelector('[data-keep-dialog]')).not.toBeNull();
  expect(host.querySelector('[data-keep-step="choose"]')).not.toBeNull();
});

it('keeps the dialog closed when nobody was keeping it', async () => {
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
  serve(roomServer());
  await open();
  expect(host.querySelector('[data-keep-dialog]')).toBeNull();
  await act(async () => { (host.querySelector('[data-owner-keep]') as HTMLElement).click(); });
  expect(host.querySelector('[data-keep-step="choose"]')).not.toBeNull();
});
