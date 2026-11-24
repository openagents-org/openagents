// @vitest-environment jsdom
import React, { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
const formatters = { formatTime: () => 'T', formatDate: () => 'D', formatDateTime: () => 'DT', weekdayLabels: () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => formatters }));
vi.mock('@/lib/api-base', () => ({ getApiBaseUrl: () => 'https://api.test' }));
const auth = vi.hoisted(() => ({ value: { user: null as null | { email: string }, idToken: null as null | string, loading: false, signIn: () => {} } }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => auth.value }));
vi.mock('@/lib/auth-redirects', () => ({ goToCentralLogin: vi.fn() }));
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
  const infoCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/v1/guest-links/public/tok'));
  expect((infoCall?.[1] as RequestInit).headers).toEqual({ 'X-Guest-Session': 'secret' });
  for (const url of urls()) expect(url).toMatch(/^https:\/\/api\.test\/v1\/guest-links\/public\/tok/);
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
  expect(post?.[0]).toBe('https://api.test/v1/guest-links/public/tok/messages');
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

function msg(id: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return { id, type: 'workspace.message', source: 'human:alex@example.com', target: 'channel/channel-1', payload: { content: `message ${id}`, sender_name: 'Alex' }, metadata: {}, timestamp, visibility: 'channel', ...extra };
}

/** jsdom has no layout: give the list a height of 100px per message row. */
function fakeLayout() {
  const list = host.querySelector<HTMLDivElement>('[aria-live="polite"]')!;
  let top = 0;
  Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => list.querySelectorAll('[data-guest-message]').length * 100 });
  Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 300 });
  Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
  return list;
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

it('loads earlier messages on request, keeps the reading position, and keeps the excerpts together', async () => {
  const latest = [msg('l2', 200), msg('l3', 300)];
  const older = [
    msg('s1', 10, { metadata: { share_seed: true } }),
    msg('s2', 20, { source: 'openagents:claude-code', payload: { content: 'Found one issue' }, metadata: { share_seed: true } }),
    msg('l1', 100),
  ];
  serve((url) => {
    if (url.includes('before=')) return ok({ messages: older, hasMore: false });
    if (url.includes('/messages')) return ok({ messages: url.includes('after=') ? [] : latest, hasMore: !url.includes('after=') });
    return ok(INFO);
  });
  await open();
  expect(host.querySelector('[data-guest-load-earlier]')).not.toBeNull();
  expect(host.textContent).not.toContain('guestThread.seedDivider');
  const list = fakeLayout();
  list.scrollTop = 40;

  const loadButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'guestThread.loadEarlier')!;
  await act(async () => loadButton.click());
  await settle();

  const earlier = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('before='));
  expect(earlier).toBe('https://api.test/v1/guest-links/public/tok/messages?limit=100&before=l2');
  // 2 rows (200px) became 5 rows (500px): the same message stays in view.
  expect(list.scrollTop).toBe(500 - 200 + 40);
  // Everything is loaded: no button, no "more" note.
  expect(host.querySelector('[data-guest-load-earlier]')).toBeNull();
  // The excerpts sit together under their divider, above the live thread.
  const seedSection = host.querySelector('section')!;
  expect(seedSection.textContent).toContain('guestThread.seedDivider');
  expect([...seedSection.querySelectorAll('[data-guest-message]')].map((el) => el.getAttribute('data-guest-message'))).toEqual(['s1', 's2']);
  const order = [...host.querySelectorAll('[data-guest-message]')].map((el) => el.getAttribute('data-guest-message'));
  expect(order).toEqual(['s1', 's2', 'l1', 'l2', 'l3']);
});

it('keeps the button and offers a retry when loading earlier messages fails', async () => {
  serve((url) => {
    if (url.includes('before=')) return new Response(JSON.stringify({ code: 500, message: 'x' }), { status: 500 });
    if (url.includes('/messages')) return ok({ messages: url.includes('after=') ? [] : [msg('l2', 200)], hasMore: !url.includes('after=') });
    return ok(INFO);
  });
  await open();
  const loadButton = [...host.querySelectorAll('button')].find((b) => b.textContent === 'guestThread.loadEarlier')!;
  await act(async () => loadButton.click());
  await settle();
  expect(host.textContent).toContain('guestThread.loadEarlierFailed');
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'guestThread.loadEarlier')).toBe(true);
});

it('shows a send once when the poll returns it before the POST does', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  let sentKey = '';
  let sentContent = '';
  let finishPost!: () => void;
  const stored = () => ({ id: 'e9', type: 'workspace.message', source: 'human:guest-g-1@guest.invalid', target: 'channel/channel-1', payload: { content: sentContent, sender_name: 'Maya' }, metadata: { guest: INFO.guest, client_key: sentKey }, timestamp: 9, visibility: 'channel' });
  serve((url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      sentKey = body.idempotency_key; sentContent = body.content;
      return new Promise<Response>((resolve) => { finishPost = () => resolve(ok(stored())); });
    }
    if (url.includes('after=')) return ok({ messages: sentKey ? [stored()] : [], hasMore: false });
    return url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO);
  });
  await open();
  const textarea = host.querySelector('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, 'hello there');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  expect(host.querySelectorAll('[data-guest-message^="optimistic-"]').length).toBe(1);

  // The poll lands first and carries the send's key back as client_key.
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await settle();
  expect(host.querySelectorAll('[data-guest-message="e9"]').length).toBe(1);
  expect(host.querySelector('[data-guest-message^="optimistic-"]')).toBeNull();

  // Then the POST resolves: still one copy.
  await act(async () => finishPost());
  await settle();
  expect(host.querySelectorAll('[data-guest-message="e9"]').length).toBe(1);
  expect(host.querySelector('[data-guest-message^="optimistic-"]')).toBeNull();
  expect([...host.querySelectorAll('[data-guest-message]')].filter((el) => el.textContent?.includes('hello there')).length).toBe(1);
});

async function typeInto(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('offers the thread agent when the guest types "@", and Enter picks it without sending', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  serve((url) => (url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO)));
  await open();
  const textarea = host.querySelector('textarea')!;
  await typeInto(textarea, 'hey @cl');
  const option = [...host.querySelectorAll('[data-slot="item"]')].find((el) => el.textContent?.includes('Claude Code'));
  expect(option).toBeTruthy();
  expect(option!.textContent).toContain('@claude-code');
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  expect(textarea.value).toBe('hey @claude-code ');
  expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  // Escape closes the picker.
  await typeInto(textarea, 'hey @claude-code @');
  expect([...host.querySelectorAll('[data-slot="item"]')].some((el) => el.textContent?.includes('@claude-code'))).toBe(true);
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect([...host.querySelectorAll('[data-slot="item"]')].some((el) => el.textContent?.includes('@claude-code'))).toBe(false);
});

it('copies an agent message from its Copy action', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  serve((url) => (url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO)));
  await open();
  const agentRow = host.querySelector('[data-guest-message="e2"]')!;
  const copy = agentRow.querySelector<HTMLButtonElement>('[data-copy-message]')!;
  expect(copy).not.toBeNull();
  // People's messages have no Copy action, as in the workspace.
  expect(host.querySelector('[data-guest-message="e1"] [data-copy-message]')).toBeNull();
  await act(async () => { copy.click(); });
  expect(writeText).toHaveBeenCalledWith('Found one issue');
  expect(copy.textContent).toBe('common.copied');
});

it('shows who a live message went to, and the guest’s colour seed matches the workspace', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  const asked = { id: 'e4', type: 'workspace.message', source: 'guest:g-1', target: 'channel/channel-1', payload: { content: '@claude-code check #42', sender_name: 'Maya' }, metadata: { guest: { id: 'g-1', name: 'Maya' } }, timestamp: 4, visibility: 'channel' };
  serve((url) => (url.includes('/messages') ? ok({ messages: [...MESSAGES, asked], hasMore: false }) : ok(INFO)));
  await open();
  expect(host.querySelector('[data-guest-message="e3"] [data-message-audience="human"]')).not.toBeNull();
  expect(host.querySelector('[data-guest-message="e4"] [data-message-audience="agent"]')?.textContent).toContain('Claude Code');
  // Excerpts carry no routing line.
  expect(host.querySelector('[data-guest-message="e1"] [data-message-audience]')).toBeNull();
  // The workspace seeds a guest's avatar with their posting address.
  const { humanColor } = await import('@/lib/human-color');
  const avatar = host.querySelector<HTMLElement>('[data-guest-message="e3"] [aria-hidden="true"][style]')!;
  const probe = document.createElement('span');
  probe.style.backgroundColor = humanColor('guest-g-1@guest.invalid');
  expect(avatar.style.backgroundColor).toBe(probe.style.backgroundColor);
});

const HELD = { id: 'e5', type: 'workspace.message', source: 'human:guest-g-1@guest.invalid', target: 'channel/channel-1', payload: { content: '@claude-code review #42', sender_name: 'Maya' }, metadata: { guest: { id: 'g-1', name: 'Maya' }, share_request: { id: 'r1', status: 'pending' } }, timestamp: 5, visibility: 'channel' };
const APPROVED_NOTICE = { id: 'e6', type: 'workspace.message.posted', source: 'system:share', target: 'channel/channel-1', payload: { content: 'Alex approved Maya’s request.', message_type: 'notice', sender_name: 'OpenAgents' }, metadata: { share_request_update: { id: 'r1', messageId: 'e5', status: 'approved' } }, timestamp: 6, visibility: 'channel' };
const RELEASED = { ...HELD, id: 'e7', timestamp: 7, metadata: { guest: { id: 'g-1', name: 'Maya' }, share_released_from: 'e5', share_request: { id: 'r1', status: 'approved' } } };

it('says a held request waits for the owner, then shows the decision and hides the re-post', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  let decided = false;
  serve((url) => {
    if (url.includes('after=')) return ok({ messages: decided ? [APPROVED_NOTICE, RELEASED] : [], hasMore: false });
    return url.includes('/messages') ? ok({ messages: [...MESSAGES, HELD], hasMore: false }) : ok({ ...INFO, approvalMode: 'owner' });
  });
  await open();
  const held = host.querySelector('[data-guest-message="e5"]')!;
  expect(held.querySelector('[data-share-request="pending"]')?.textContent).toBe('guestThread.waitingApproval:{"owner":"Alex"}');
  // No Approve/Decline for a guest.
  expect(host.querySelector('[data-share-decide]')).toBeNull();
  // The banner and the composer hint say requests wait for the owner.
  expect(host.textContent).toContain('guestThread.approvalNotice:{"agent":"Claude Code","owner":"Alex"}');
  await typeInto(host.querySelector('textarea')!, 'check this');
  expect(host.querySelector('[data-composer-hint]')?.textContent).toBe('guestThread.askAgentHintApproval:{"agent":"Claude Code","owner":"Alex"}');

  decided = true;
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await settle();
  expect(host.querySelector('[data-share-notice="e6"]')?.textContent).toBe('Alex approved Maya’s request.');
  expect(held.querySelector('[data-share-request]')?.getAttribute('data-share-request')).toBe('approved');
  expect(host.querySelector('[data-guest-message="e7"]')).toBeNull();
});

it('shows the agent working when it is mentioned anywhere in the newest message, not while it waits for approval', async () => {
  const recent = (metadata: Record<string, unknown> = {}) => ({ id: 'e8', type: 'workspace.message', source: 'guest:g-1', target: 'channel/channel-1', payload: { content: 'thanks — @claude-code can you check #43?', sender_name: 'Maya' }, metadata: { guest: { id: 'g-1', name: 'Maya' }, ...metadata }, timestamp: Date.now(), visibility: 'channel' });
  serve((url) => (url.includes('/messages') ? ok({ messages: [...MESSAGES, recent()], hasMore: false }) : ok(INFO)));
  await open();
  expect(host.querySelector('.working-bubble')).not.toBeNull();
  expect(host.querySelector('[data-guest-message="e8"] [data-message-audience="agent"]')).not.toBeNull();
  await act(async () => root.unmount());
  root = createRoot(host);
  serve((url) => (url.includes('/messages') ? ok({ messages: [...MESSAGES, recent({ share_request: { id: 'r9', status: 'pending' } })], hasMore: false }) : ok({ ...INFO, approvalMode: 'owner' })));
  await open();
  expect(host.querySelector('.working-bubble')).toBeNull();
});

it('renders a message’s attachments with link-scoped bytes and opens them in the artifact panel', async () => {
  let n = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() }));
  const withFiles = { id: 'e10', type: 'workspace.message', source: 'openagents:claude-code', target: 'channel/channel-1',
    payload: { content: 'Here is the chart and the data.', attachments: [{ fileId: 'a1', filename: 'chart.png', contentType: 'image/png' }, { fileId: 'a2', filename: 'data.csv', contentType: 'text/csv' }] },
    metadata: {}, timestamp: 10, visibility: 'channel' };
  serve((url) => {
    if (url.endsWith('/files/a1')) return new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url.endsWith('/files/a2')) return new Response('a,b\n1,2\n', { status: 200, headers: { 'Content-Type': 'text/csv' } });
    if (url.endsWith('/resources')) return ok({ files: [], browsers: [], routines: [] });
    return url.includes('/messages') ? ok({ messages: [...MESSAGES, withFiles], hasMore: false }) : ok(INFO);
  });
  await open();
  const row = host.querySelector('[data-guest-message="e10"]')!;
  expect(row.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
  expect(urls()).toContain('https://api.test/v1/guest-links/public/tok/files/a1');
  const chip = [...row.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'data.csv')!;
  await act(async () => { chip.click(); });
  await settle();
  const panel = host.querySelector('[data-share-artifact-panel]')!;
  expect(panel.textContent).toContain('data.csv');
  expect(panel.querySelector('table')?.textContent).toContain('1');
  // No workspace calls, and no "Request revision" for a guest.
  expect(urls().some((u) => /\/v1\/(events|workspaces|files)\b/.test(u))).toBe(false);
});
