// @vitest-environment jsdom
import React, { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
const formatters = { formatTime: () => 'T', formatDate: () => 'D', formatDateTime: () => 'DT' };
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => formatters }));
vi.mock('@/lib/api-base', () => ({ getApiBaseUrl: () => 'https://api.test' }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => React.createElement('img', { alt: props.alt }) }));
vi.mock('@/components/chat/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => React.createElement('div', { 'data-testid': 'markdown' }, content),
}));

import SharedThreadPage from './page';

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const INFO = {
  thread: { name: 'channel-1', title: 'PR reviewer' },
  workspace: { name: 'Alex’s shared workspace' },
  owner: { name: 'Alex' },
  agents: [{ name: 'claude-code', displayName: 'Claude Code', type: 'claude', online: true }],
  expiresAt: null,
  canPost: true,
  guest: { id: 'g-1', name: 'Maya' },
};
const MESSAGES = [
  { id: 'e1', type: 'workspace.message', source: 'human:alex@example.com', target: 'channel/channel-1', payload: { content: 'Review PR #18', sender_name: 'Alex' }, metadata: { share_seed: true }, timestamp: 1, visibility: 'channel' },
  { id: 'e2', type: 'workspace.message', source: 'openagents:claude-code', target: 'channel/channel-1', payload: { content: 'Found one issue' }, metadata: { share_seed: true }, timestamp: 2, visibility: 'channel' },
  { id: 'e3', type: 'workspace.message', source: 'guest:g-1', target: 'channel/channel-1', payload: { content: 'Thanks!', sender_name: 'Maya' }, metadata: { guest: { id: 'g-1', name: 'Maya' } }, timestamp: 3, visibility: 'channel' },
];

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200 });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function serve(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
}

async function open(token = 'tok') {
  const params = Object.assign(Promise.resolve({ token }), { status: 'fulfilled', value: { token } });
  await act(async () => root.render(React.createElement(Suspense, { fallback: null }, React.createElement(SharedThreadPage, { params }))));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function urls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

it('renders the thread for a guest without any workspace context', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  serve((url) => (url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO)));
  await open();
  const text = host.textContent || '';
  expect(text).toContain('PR reviewer');
  expect(text).toContain('guestThread.seedDivider:{"owner":"Alex","agent":"Claude Code"}');
  expect(text).toContain('Claude Code');
  expect(text).toContain('guestThread.agentBadge');
  expect(text).toContain('guestThread.you'); // the viewer's own guest message
  expect(text).toContain('guestThread.runsOn:{"agent":"Claude Code","owner":"Alex"}');
  // "Ask Claude Code" is on by default with one agent.
  const chip = host.querySelector('[data-slot="toggle"]');
  expect(chip?.getAttribute('data-state')).toBe('on');
  // The stored session went along with the info request.
  const infoCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/v1/thread-links/public/tok'));
  expect((infoCall?.[1] as RequestInit).headers).toEqual({ 'X-Guest-Session': 'secret' });
  for (const url of urls()) expect(url).toMatch(/^https:\/\/api\.test\/v1\/thread-links\/public\/tok/);
});

it.each([
  [404, 'not_found'],
  [410, 'expired'],
])('shows a final page for HTTP %s without retrying', async (status, state) => {
  serve(() => new Response(JSON.stringify({ code: status, message: 'x' }), { status }));
  await open();
  expect(host.querySelector(`[data-guest-link-state="${state}"]`)).not.toBeNull();
  const calls = fetchMock.mock.calls.length;
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  expect(fetchMock.mock.calls.length).toBe(calls);
  expect(urls().some((u) => /\/v1\/events|\/v1\/workspaces/.test(u))).toBe(false);
});

it('sends with the @agent prefix, the guest session and an idempotency key', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  serve((url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return ok({ id: 'e9', type: 'workspace.message', source: 'guest:g-1', target: 'channel/channel-1', payload: { content: body.content, sender_name: 'Maya' }, metadata: { guest: INFO.guest }, timestamp: 9, visibility: 'channel' });
    }
    return url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO);
  });
  await open();
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, 'review https://github.com/example/repo/pull/42');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST');
  expect(post?.[0]).toBe('https://api.test/v1/thread-links/public/tok/messages');
  const init = post?.[1] as RequestInit;
  expect((init.headers as Record<string, string>)['X-Guest-Session']).toBe('secret');
  const body = JSON.parse(String(init.body));
  expect(body.content).toBe('@claude-code review https://github.com/example/repo/pull/42');
  expect(typeof body.idempotency_key).toBe('string');
  expect(body.idempotency_key.length).toBeGreaterThan(8);
  expect(textarea.value).toBe('');
  // Reconciled: the stored event replaces the optimistic row, shown once.
  expect(host.querySelectorAll('[data-guest-message="e9"]').length).toBe(1);
  expect(host.querySelector('[data-guest-message^="optimistic-"]')).toBeNull();
});
