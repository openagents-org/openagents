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
  expect(text).toContain('claude-code');
  expect(text).toContain('guestThread.agentBadge');
  expect(text).toContain('guestThread.you'); // the viewer's own guest message
  expect(text).toContain('guestThread.runsOn:{"agent":"claude-code","owner":"Alex"}');
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
  const option = [...host.querySelectorAll('[data-slot="item"]')].find((el) => el.textContent?.includes('claude-code'));
  expect(option).toBeTruthy();
  // The agent goes by its handle, so there's no separate "@handle" line.
  expect(option!.textContent).toContain('claude-code');
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  expect(textarea.value).toBe('hey @claude-code ');
  expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  // Escape closes the picker.
  await typeInto(textarea, 'hey @claude-code @');
  expect([...host.querySelectorAll('[data-slot="item"]')].some((el) => el.textContent?.includes('collab.online'))).toBe(true);
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect([...host.querySelectorAll('[data-slot="item"]')].some((el) => el.textContent?.includes('collab.online'))).toBe(false);
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
  expect(host.querySelector('[data-guest-message="e4"] [data-message-audience="agent"]')?.textContent).toContain('claude-code');
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
  expect(host.textContent).toContain('guestThread.approvalNotice:{"agent":"claude-code","owner":"Alex"}');
  await typeInto(host.querySelector('textarea')!, 'check this');
  expect(host.querySelector('[data-composer-hint]')?.textContent).toBe('guestThread.askAgentHintApproval:{"agent":"claude-code","owner":"Alex"}');

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

it('turns asking off when the owner doesn’t let guests ask the agent', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  serve((url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return ok({ id: 'e11', type: 'workspace.message', source: 'guest:g-1', target: 'channel/channel-1', payload: { content: body.content, sender_name: 'Maya' }, metadata: { guest: INFO.guest }, timestamp: 11, visibility: 'channel' });
    }
    return url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok({ ...INFO, approvalMode: 'off' });
  });
  await open();
  const chip = host.querySelector('[data-slot="toggle"]')!;
  expect(chip.getAttribute('data-state')).toBe('off');
  expect(chip.getAttribute('aria-disabled')).toBe('true');
  await act(async () => { (chip as HTMLElement).click(); });
  expect(chip.getAttribute('data-state')).toBe('off');
  expect(host.querySelector('[data-ask-blocked-note]')?.textContent).toBe('guestThread.askDisabled:{"owner":"Alex","agent":"claude-code"}');
  expect(host.textContent).toContain('guestThread.agentOffNotice:{"agent":"claude-code","owner":"Alex"}');
  const textarea = host.querySelector('textarea')!;
  expect(textarea.getAttribute('placeholder')).toBe('guestThread.placeholderComment');
  await typeInto(textarea, 'nice @cl');
  expect(host.querySelector('[data-slot="item"]')).toBeNull();
  await typeInto(textarea, 'nice work');
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
  expect(JSON.parse(String((post[1] as RequestInit).body)).content).toBe('nice work');
});

it('switches a removed guest to read-only and remembers it', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  serve((url, init) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ code: 403, message: 'The owner removed you from this conversation. You can still read it.' }), { status: 403 });
    return url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO);
  });
  await open();
  const textarea = host.querySelector('textarea')!;
  await typeInto(textarea, 'hello');
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  expect(host.querySelector('[data-guest-removed-notice]')?.textContent).toBe('guestThread.removedNotice');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('[data-guest-message^="optimistic-"]')?.textContent).toContain('guestThread.removedNotice');
  expect(localStorage.getItem('oa-guest-removed:tok')).toBe('1');
});

it('picks up a link made read-only when it re-reads the link info', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    let canPost = true;
    serve((url) => (url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok({ ...INFO, canPost })));
    await open();
    expect(host.querySelector('textarea')).not.toBeNull();
    canPost = false;
    await act(async () => { vi.advanceTimersByTime(30000); });
    await settle();
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).toContain('guestThread.readOnlyNotice');
  } finally {
    vi.useRealTimers();
  }
});

const PIN_RESOURCES = { files: [{ id: 'f-md', name: 'notes.md', path: 'notes.md', contentType: 'text/markdown', size: 10, createdAt: null, uploadedBy: 'openagents:claude-code' }], browsers: [], routines: [] };
function pinServer(pinned: unknown = { kind: 'file', id: 'f-md' }) {
  return (url: string) => {
    if (url.endsWith('/resources')) return ok(PIN_RESOURCES);
    if (url.includes('/files/')) return new Response('# Notes', { status: 200, headers: { 'Content-Type': 'text/markdown' } });
    return url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok({ ...INFO, pinnedArtifact: pinned });
  };
}

it('opens the artifact the owner is showing, and remembers when the guest closes it', async () => {
  sessionStorage.clear();
  serve(pinServer());
  await open();
  expect(host.querySelector('[data-share-artifact-panel]')?.textContent).toContain('notes.md');
  // Guests can't change what guests see.
  expect(host.querySelector('[data-guests-see]')).toBeNull();
  await act(async () => { (host.querySelector('[data-share-viewer-close]') as HTMLElement).click(); });
  expect(host.querySelector('[data-share-artifact-panel]')).toBeNull();
  expect(sessionStorage.getItem('oa-share-pin-closed:tok')).toBe('1');
  await act(async () => root.unmount());
  root = createRoot(host);
  await open();
  expect(host.querySelector('[data-share-artifact-panel]')).toBeNull();
  sessionStorage.clear();
});

it('on a phone offers the owner’s artifact in a banner instead of opening it', async () => {
  sessionStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  serve(pinServer());
  await open();
  expect(host.querySelector('[data-share-artifact-panel]')).toBeNull();
  expect(host.querySelector('[data-pin-banner]')?.textContent).toContain('guestThread.ownerShowing:{"owner":"Alex","name":"notes.md"}');
});

it('shows the owner’s preview read-only: no session, no name prompt, nothing posts', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  serve((url) => (url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO)));
  const params = Object.assign(Promise.resolve({ token: 'tok' }), { status: 'fulfilled', value: { token: 'tok' } });
  const searchParams = Object.assign(Promise.resolve({ preview: '1' }), { status: 'fulfilled', value: { preview: '1' } });
  await act(async () => root.render(React.createElement(Suspense, { fallback: null }, React.createElement(SharedThreadPage, { params, searchParams }))));
  await settle();
  const infoCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/v1/guest-links/public/tok'));
  expect((infoCall?.[1] as RequestInit).headers).toBeUndefined();
  expect(host.querySelector('[data-guest-preview]')?.textContent).toContain('guestThread.previewBar');
  expect(host.querySelector('[data-fork-open]')).toBeNull();
  // The composer is shown but inert.
  expect(host.querySelector('[data-guest-preview] [aria-hidden="true"] textarea')).not.toBeNull();
  expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  expect(localStorage.getItem('oa-guest-session:tok')).toBe('secret');
});

function failWith(status: number, data: unknown, message = 'no') {
  return new Response(JSON.stringify({ code: status, message, data }), { status });
}

it('asks a signed-out visitor of an invite-only jam to sign in', async () => {
  serve(() => failWith(401, { access: 'invited' }));
  await open();
  expect(host.querySelector('[data-guest-link-state="invite_signin"]')?.textContent).toContain('guestThread.inviteOnlyTitle');
  expect(host.querySelector('[data-invite-sign-in]')).not.toBeNull();
});

it('tells a signed-in visitor who isn’t invited which account was checked', async () => {
  auth.value = { ...auth.value, user: { email: 'sam@example.com' }, idToken: 'id-tok' };
  try {
    // Without credentials the jam asks to sign in; with them, it checks the account.
    serve((_url, init) => (((init?.headers || {}) as Record<string, string>).Authorization
      ? failWith(403, { access: 'invited', email: 'sam@example.com' })
      : failWith(401, { access: 'invited' })));
    await open();
    expect(host.querySelector('[data-guest-link-state="invite_denied"]')?.textContent).toContain('guestThread.inviteDeniedTitle:{"email":"sam@example.com"}');
    expect(host.querySelector('[data-invite-switch]')).not.toBeNull();
    // Asked first without credentials, then as the signed-in account.
    expect(((fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
    const last = fetchMock.mock.calls.at(-1)!;
    expect(((last[1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer id-tok');
  } finally {
    auth.value = { ...auth.value, user: null, idToken: null };
  }
});

it('lets an invited, signed-in guest in with their account: bearer on every call, no name prompt', async () => {
  auth.value = { ...auth.value, user: { email: 'maya@example.com' }, idToken: 'id-tok' };
  try {
    serve((url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return ok({ id: 'e20', type: 'workspace.message', source: 'human:guest-g-7@guest.invalid', target: 'channel/channel-1', payload: { content: body.content, sender_name: 'maya' }, metadata: { guest: { id: 'g-7', name: 'maya' }, client_key: body.idempotency_key }, timestamp: 20, visibility: 'channel' });
      }
      if (url.endsWith('/resources')) return ok({ files: [], browsers: [], routines: [] });
      return url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok({ ...INFO, access: 'invited', guest: null });
    });
    await open();
    expect(host.querySelector('[data-invite-only-badge]')?.textContent).toBe('guestThread.inviteOnlyBadge');
    const textarea = host.querySelector('textarea')!;
    await typeInto(textarea, 'hello');
    await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await settle();
    // No name prompt: the account is the identity.
    expect(host.textContent).not.toContain('guestThread.nameTitle');
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const headers = (post[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer id-tok');
    expect(headers['X-Guest-Session']).toBeUndefined();
    // Once the jam says it's invite-only, every call carries the account.
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect([String(call[0]), ((call[1] as RequestInit).headers as Record<string, string> | undefined)?.Authorization]).toEqual([String(call[0]), 'Bearer id-tok']);
    }
    expect(host.querySelector('[data-guest-message="e20"]')?.textContent).toContain('guestThread.you');
  } finally {
    auth.value = { ...auth.value, user: null, idToken: null };
  }
});

it('never tells an open link who is signed in', async () => {
  auth.value = { ...auth.value, user: { email: 'maya@example.com' }, idToken: 'id-tok' };
  try {
    serve((url) => (url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok(INFO)));
    await open();
    for (const call of fetchMock.mock.calls) {
      const headers = ((call[1] as RequestInit | undefined)?.headers || {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    }
  } finally {
    auth.value = { ...auth.value, user: null, idToken: null };
  }
});

const AGENT_COMMANDS = ['npm i -g @openagents-org/agent-launcher', 'agn create mine --path ~/mine', 'agn connect mine gtok-once'];
function agentServer(extra?: (url: string, init?: RequestInit) => Response | null, info: Record<string, unknown> = {}) {
  return (url: string, init?: RequestInit) => {
    const hit = extra?.(url, init);
    if (hit) return hit;
    if (url.endsWith('/resources')) return ok({ files: [], browsers: [], routines: [] });
    return url.includes('/messages') ? ok({ messages: MESSAGES, hasMore: false }) : ok({ ...INFO, allowGuestAgents: true, ...info });
  };
}
async function typeName(value: string) {
  const input = document.querySelector('[data-add-agent-name]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('offers guests "Add agent" only when the owner allows it', async () => {
  serve(agentServer(undefined, { allowGuestAgents: false }));
  await open();
  expect(host.querySelector('[data-add-agent-button]')).toBeNull();
});

it('asks a guest without a name for one before adding an agent', async () => {
  serve(agentServer());
  await open();
  await act(async () => { (host.querySelector('[data-add-agent-button]') as HTMLElement).click(); });
  await settle();
  expect(document.body.textContent).toContain('guestThread.nameTitle');
  expect(document.querySelector('[data-add-agent-dialog]')).toBeNull();
});

it('lets a named guest bring an agent, shows the one-time commands, and says when a name is taken', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  let taken = true;
  const posts: Array<{ body: unknown; headers: Record<string, string> }> = [];
  serve(agentServer((url, init) => {
    if (url.endsWith('/agents') && init?.method === 'POST') {
      posts.push({ body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      if (taken) { taken = false; return new Response(JSON.stringify({ code: 409, message: 'taken' }), { status: 409 }); }
      return ok({ agent: { name: 'mine', type: 'claude', broughtBy: 'Maya', mine: true }, token: 'gtok-once', commands: AGENT_COMMANDS });
    }
    return null;
  }));
  await open();
  await act(async () => { (host.querySelector('[data-add-agent-button]') as HTMLElement).click(); });
  await settle();
  expect(document.querySelector('[data-add-agent-explain]')?.textContent).toBe('jamAgents.guestExplain');
  await typeName('mine');
  await act(async () => { (document.querySelector('[data-add-agent-submit]') as HTMLElement).click(); });
  await settle();
  expect(document.querySelector('[data-add-agent-error]')?.textContent).toBe('jamAgents.nameTaken:{"name":"mine"}');
  await act(async () => { (document.querySelector('[data-add-agent-submit]') as HTMLElement).click(); });
  await settle();
  expect(posts.map((p) => p.body)).toEqual([{ name: 'mine', type: 'claude' }, { name: 'mine', type: 'claude' }]);
  expect(posts[0].headers['X-Guest-Session']).toBe('secret');
  expect(document.querySelector('[data-add-agent-commands]')?.textContent).toBe(AGENT_COMMANDS.join('\n'));
  expect(document.querySelector('[data-add-agent-token-once]')?.textContent).toBe('jamAgents.tokenOnce');
});

it('shows who brought an agent and lets a guest remove only their own', async () => {
  localStorage.setItem('oa-guest-session:tok', 'secret');
  const deletes: string[] = [];
  serve(agentServer((url, init) => {
    if (url.includes('/agents/') && init?.method === 'DELETE') { deletes.push(url); return ok({ name: 'mine', removed: true }); }
    return null;
  }, { agents: [
    ...INFO.agents,
    { name: 'mine', displayName: 'mine', type: 'claude', online: true, broughtBy: 'Maya', mine: true },
    { name: 'sams-bot', displayName: 'sams-bot', type: 'codex', online: false, broughtBy: 'Sam', mine: false },
  ] }));
  await open();
  expect(host.querySelector('[data-agent-row="sams-bot"] [data-agent-brought-by]')?.textContent).toBe('jamAgents.broughtBy:{"name":"Sam"}');
  expect(host.querySelector('[data-agent-row="sams-bot"] [data-agent-remove]')).toBeNull();
  expect(host.querySelector('[data-agent-row="claude-code"] [data-agent-remove]')).toBeNull();
  await act(async () => { (host.querySelector('[data-agent-row="mine"] [data-agent-remove]') as HTMLElement).click(); });
  await act(async () => { (host.querySelector('[data-agent-remove-confirm="mine"]') as HTMLElement).click(); });
  await settle();
  expect(deletes).toEqual(['https://api.test/v1/guest-links/public/tok/agents/mine']);
});
