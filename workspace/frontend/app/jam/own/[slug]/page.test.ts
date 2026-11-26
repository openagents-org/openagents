// @vitest-environment jsdom
import React, { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { user: null as null | { email: string }, idToken: null as null | string, loading: false, signIn: vi.fn() },
}));
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
const formatters = { formatTime: () => 'T', formatDate: () => 'D', formatDateTime: () => 'DT', weekdayLabels: () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
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

import OwnerJamPage from './page';
import { rememberKeepIntent } from '@/components/share/keep-conversation-dialog';

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const LINK = { id: 'l1', channel: 'share-abc', url: 'https://app.test/jam/gtok', canPost: true, expiresAt: null, revokedAt: null, createdAt: '2026-11-20T00:00:00Z' };
const JAM = {
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
function jamServer(jam: unknown = JAM, onPost?: (body: { content: string; idempotency_key: string }) => unknown) {
  return (url: string, init?: RequestInit) => {
    if (url.includes('/jam/messages') && init?.method === 'POST') return ok(onPost?.(JSON.parse(String(init.body))));
    if (url.includes('/jam/messages')) return ok({ messages: MESSAGES, hasMore: false });
    if (url.includes('/v1/guest-links/jam')) return ok(jam);
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
  await act(async () => root.render(React.createElement(Suspense, { fallback: null }, React.createElement(OwnerJamPage, props))));
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

it('shows the jam with the owner as "You", guests badged, and the guest link behind the header button', async () => {
  serve(jamServer());
  await open();
  const text = host.textContent || '';
  expect(text).toContain('PR reviewer');
  const own = host.querySelector('[data-guest-message="e3"]')!;
  expect(own.textContent).toContain('guestThread.you');
  const guest = host.querySelector('[data-guest-message="e2"]')!;
  expect(guest.textContent).toContain('Maya');
  expect(guest.textContent).toContain('guestThread.guestBadge');
  expect(text).toContain('shareJam.runsOn:{"agent":"claude-code","owner":"Alex"}');
  expect(text).not.toContain('guestThread.guestNotice');
  expect(host.querySelector('[data-owner-keep]')).not.toBeNull();
  // The guest link controls live behind the header's share button, not in the sidebar.
  expect(host.querySelector('[data-owner-guest-link]')).toBeNull();
  await act(async () => { (host.querySelector('[data-owner-link-button]') as HTMLElement).click(); });
  // Loaded with the owner token.
  const card = host.querySelector('[data-owner-guest-link]')!;
  expect((card.querySelector('input') as HTMLInputElement).value).toBe(LINK.url);
  expect(card.querySelector('[data-expiry-choice="7d"]')).not.toBeNull();
  for (const call of fetchMock.mock.calls) {
    expect(String(call[0])).toMatch(/^https:\/\/api\.test\/v1\/guest-links/);
    expect(((call[1] as RequestInit).headers as Record<string, string>)['X-Workspace-Token']).toBe('ws-token');
  }
});

it('posts as the owner with the token, the @agent prefix and an idempotency key', async () => {
  serve(jamServer(JAM, (body) => ({
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
  expect(post[0]).toBe('https://api.test/v1/guest-links/jam/messages?network=alex-share');
  const body = JSON.parse(String((post[1] as RequestInit).body));
  expect(body.content).toBe('@claude-code check PR 42');
  expect(body.idempotency_key.length).toBeGreaterThan(8);
  expect(host.querySelector('[data-guest-message="e9"]')?.textContent).toContain('guestThread.you');
  expect(host.querySelector('[data-guest-message^="optimistic-"]')).toBeNull();
});

it('offers "Open in your workspace" once the conversation is kept', async () => {
  serve(jamServer({ ...JAM, share: { claimed: true, movedTo: null, keptAsWorkspace: true } }));
  await open();
  expect(host.querySelector('[data-owner-keep]')).toBeNull();
  expect(host.querySelector('[data-owner-open]')?.getAttribute('href')).toBe('/alex-share/threads/share-abc');
});

it('says the conversation moved on a 410', async () => {
  serve(() => new Response(JSON.stringify({ code: 410, message: 'moved', data: { movedTo: { slug: 'team', channel: 'share-abc-2' } } }), { status: 410 }));
  await open();
  expect(host.querySelector('[data-guest-link-state="moved"]')).not.toBeNull();
  expect(host.textContent).toContain('shareJam.movedTitle');
  expect(host.querySelector('[data-moved-open]')?.getAttribute('href')).toBe('/team/threads/share-abc-2');
});

it('shows a friendly page for an invalid owner link', async () => {
  serve(() => new Response(JSON.stringify({ code: 404, message: 'no' }), { status: 404 }));
  await open();
  expect(host.querySelector('[data-guest-link-state="not_found"]')).not.toBeNull();
  expect(host.textContent).toContain('shareJam.notFoundTitle');
});

it('treats a link without a token as invalid, without calling the API', async () => {
  serve(jamServer());
  await open(null);
  expect(host.textContent).toContain('shareJam.notFoundTitle');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reopens "Keep this conversation" on the choice step after signing in', async () => {
  rememberKeepIntent('alex-share');
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
  serve(jamServer());
  await open();
  expect(host.querySelector('[data-keep-dialog]')).not.toBeNull();
  expect(host.querySelector('[data-keep-step="choose"]')).not.toBeNull();
});

it('keeps the dialog closed when nobody was keeping it', async () => {
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
  serve(jamServer());
  await open();
  expect(host.querySelector('[data-keep-dialog]')).toBeNull();
  await act(async () => { (host.querySelector('[data-owner-keep]') as HTMLElement).click(); });
  expect(host.querySelector('[data-keep-step="choose"]')).not.toBeNull();
});

const HELD = { id: 'e4', type: 'workspace.message', source: 'human:guest-g1@guest.invalid', target: 'channel/share-abc', payload: { content: '@claude-code review #42', sender_name: 'Maya' }, metadata: { guest: { id: 'g1', name: 'Maya' }, share_request: { id: 'r1', status: 'pending' } }, timestamp: 4, visibility: 'channel' };
const REQUEST = { id: 'r1', status: 'pending', guest: { id: 'g1', name: 'Maya' }, messageId: 'e4', content: '@claude-code review #42', createdAt: '2026-11-23T00:00:00Z' };

function approvalServer(decideStatus = 200) {
  const decisions: Array<{ url: string; body: unknown }> = [];
  const handler = (url: string, init?: RequestInit) => {
    if (url.includes('/jam/requests/') && init?.method === 'POST') {
      decisions.push({ url, body: JSON.parse(String(init.body)) });
      if (decideStatus !== 200) return new Response(JSON.stringify({ code: decideStatus, message: 'already' }), { status: decideStatus });
      return ok({ request: { ...REQUEST, status: 'approved' } });
    }
    if (url.includes('/jam/requests')) return ok({ requests: decisions.length ? [] : [REQUEST] });
    if (url.includes('/jam/messages')) return ok({ messages: url.includes('after=') ? [] : [...MESSAGES, HELD], hasMore: false });
    if (url.includes('/v1/guest-links/jam')) return ok({ ...JAM, link: { ...LINK, approvalMode: 'owner' } });
    if (url.includes('/v1/guest-links?')) return ok({ links: [{ ...LINK, approvalMode: 'owner' }] });
    return new Response('{}', { status: 500 });
  };
  return { handler, decisions };
}

it('shows waiting guest requests and approves one from the held message', async () => {
  const server = approvalServer();
  serve(server.handler);
  await open();
  expect(host.querySelector('[data-guest-requests="1"]')?.textContent).toContain('share.guestRequestsWaiting:{"count":1}');
  expect(host.textContent).toContain('shareJam.ownerApprovalNotice');
  const card = host.querySelector('[data-guest-message="e4"] [data-share-request="pending"]')!;
  expect(card.textContent).toContain('shareJam.requestTitle:{"guest":"Maya","agent":"claude-code"}');
  await act(async () => { (card.querySelector('[data-share-decide="approve"]') as HTMLElement).click(); });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(server.decisions).toEqual([{ url: 'https://api.test/v1/guest-links/jam/requests/r1?network=alex-share', body: { decision: 'approve' } }]);
  expect(host.querySelector('[data-guest-message="e4"] [data-share-request]')?.getAttribute('data-share-request')).toBe('approved');
  expect(host.querySelector('[data-guest-requests]')).toBeNull();
  const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/jam/requests/'))!;
  expect(((post[1] as RequestInit).headers as Record<string, string>)['X-Workspace-Token']).toBe('ws-token');
});

it('says when someone already decided the request', async () => {
  const server = approvalServer(409);
  serve(server.handler);
  await open();
  await act(async () => { (host.querySelector('[data-share-decide="decline"]') as HTMLElement).click(); });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(server.decisions[0].body).toEqual({ decision: 'decline' });
  expect(host.querySelector('[data-guest-message="e4"]')?.textContent).toContain('shareJam.requestAlreadyDecided');
});

it('switches guests’ requests to need the owner’s approval from the link dialog', async () => {
  const patches: unknown[] = [];
  serve((url, init) => {
    if (init?.method === 'PATCH') { patches.push(JSON.parse(String(init.body))); return ok({ link: { ...LINK, approvalMode: 'owner' } }); }
    if (url.includes('/jam/requests')) return ok({ requests: [] });
    return jamServer()(url, init);
  });
  await open();
  await act(async () => { (host.querySelector('[data-owner-link-button]') as HTMLElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(host.querySelector('[data-guest-link-approval]')?.getAttribute('data-guest-link-approval')).toBe('none');
  await act(async () => { (host.querySelector('[data-approval-choice="owner"]') as HTMLElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(patches).toEqual([{ approval_mode: 'owner' }]);
  expect(host.querySelector('[data-guest-link-approval]')?.getAttribute('data-guest-link-approval')).toBe('owner');
  // The jam follows the new mode.
  expect(host.textContent).toContain('shareJam.ownerApprovalNotice');
});

it('folds an offline agent into the waiting-requests strip on a phone', async () => {
  const server = approvalServer();
  serve((url, init) => {
    if (url.includes('/v1/guest-links/jam?')) return ok({ ...JAM, agents: [{ ...JAM.agents[0], online: false }], link: { ...LINK, approvalMode: 'owner' } });
    return server.handler(url, init);
  });
  await open();
  expect(host.querySelector('[data-guest-requests-lead]')?.textContent).toBe('claude-code · guestThread.offline · ');
  expect(host.querySelector('[data-agent-status="warning"]')?.className).toContain('max-sm:hidden');
});

it('says in the jam when guests can’t ask the agent or the link is read-only, and lists guests to remove', async () => {
  const removed: string[] = [];
  let link: Record<string, unknown> = { ...LINK, approvalMode: 'off' };
  serve((url, init) => {
    if (url.includes('/jam/guests/') && init?.method === 'DELETE') { removed.push(url); return ok({ guest: { id: 'g1', name: 'Maya', joinedAt: null, lastSeenAt: null, removed: true } }); }
    if (url.includes('/jam/guests')) return ok({ guests: [{ id: 'g1', name: 'Maya', joinedAt: null, lastSeenAt: null, removed: false }] });
    if (url.includes('/jam/requests')) return ok({ requests: [] });
    if (url.includes('/v1/guest-links/jam?')) return ok({ ...JAM, link });
    if (url.includes('/v1/guest-links?')) return ok({ links: [link] });
    return jamServer()(url, init);
  });
  await open();
  expect(host.textContent).toContain('shareJam.ownerAgentOffNotice:{"agent":"claude-code","owner":"Alex"}');
  await act(async () => { (host.querySelector('[data-owner-link-button]') as HTMLElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(host.querySelector('[data-guest-link-approval]')?.getAttribute('data-guest-link-approval')).toBe('off');
  await act(async () => { (host.querySelector('[data-guest-remove="g1"]') as HTMLElement).click(); });
  await act(async () => { (host.querySelector('[data-guest-remove-confirm="g1"]') as HTMLElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(removed).toEqual(['https://api.test/v1/guest-links/jam/guests/g1?network=alex-share']);
  expect(host.querySelector('[data-guest-row="g1"] [data-guest-removed]')).not.toBeNull();

  // Read-only link: the banner says so.
  link = { ...LINK, canPost: false };
  await act(async () => root.unmount());
  root = createRoot(host);
  await open();
  expect(host.textContent).toContain('shareJam.ownerReadOnlyNotice');
});

it('opens for the signed-in owner without the owner token, using their sign-in', async () => {
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
  serve(jamServer());
  await open(null);
  expect(host.textContent).toContain('PR reviewer');
  expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  for (const call of fetchMock.mock.calls) {
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer id-tok');
    expect(headers['X-Workspace-Token']).toBeUndefined();
  }
  expect(host.querySelector('[data-owner-my-jams]')?.getAttribute('href')).toBe('/jams');
});

it('says the owner link isn’t valid for someone signed in who doesn’t own the jam', async () => {
  state.auth.user = { email: 'sam@example.com' };
  state.auth.idToken = 'id-tok';
  serve(() => new Response(JSON.stringify({ code: 403, message: 'Not yours' }), { status: 403 }));
  await open(null);
  expect(host.textContent).toContain('shareJam.notFoundTitle');
});

it('waits for sign-in to settle before deciding a tokenless link is invalid', async () => {
  state.auth.loading = true;
  serve(jamServer());
  await open(null);
  expect(host.textContent).not.toContain('shareJam.notFoundTitle');
  expect(fetchMock).not.toHaveBeenCalled();
  state.auth.loading = false;
});

const RESOURCES = {
  files: [{ id: 'f-md', name: 'notes.md', path: 'notes.md', contentType: 'text/markdown', size: 10, createdAt: null, uploadedBy: 'openagents:claude-code' }],
  browsers: [], routines: [],
};
function ownerServer(jam: Record<string, unknown> = JAM, extra?: (url: string, init?: RequestInit) => Response | null) {
  const base = jamServer(jam);
  return (url: string, init?: RequestInit) => {
    const hit = extra?.(url, init);
    if (hit) return hit;
    if (url.includes('/jam/guests')) return ok({ guests: [{ id: 'g1', name: 'Maya', joinedAt: null, lastSeenAt: null, removed: false }, { id: 'g2', name: 'Sam', joinedAt: null, lastSeenAt: null, removed: true }] });
    if (url.includes('/jam/requests')) return ok({ requests: [] });
    if (url.includes('/jam/resources')) return ok(RESOURCES);
    if (url.includes('/jam/files/')) return new Response('# Notes', { status: 200, headers: { 'Content-Type': 'text/markdown' } });
    if (url.includes('/jam/pin')) return ok({ pinnedArtifact: JSON.parse(String(init?.body)).kind ? JSON.parse(String(init?.body)) : null });
    return base(url, init);
  };
}
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

it('keeps the sharing block at the bottom of the sidebar: owner note, policy at a glance, copy link, preview', async () => {
  localStorage.clear();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  serve(ownerServer({ ...JAM, link: { ...LINK, approvalMode: 'owner' } }, (url) => (url.includes('/v1/guest-links?') ? ok({ links: [{ ...LINK, approvalMode: 'owner' }] }) : null)));
  await open();
  const panel = host.querySelector('[data-owner-panel-slot] [data-owner-panel]')!;
  expect(panel.querySelector('[data-owner-note]')?.textContent).toBe('shareJam.ownerNote');
  // Below Threads, Agents and People: in the sidebar footer, above the identity row.
  expect(panel.closest('[data-sidebar="footer"]')).not.toBeNull();
  const values = Object.fromEntries([...panel.querySelectorAll('[data-owner-policy-row]')].map((row) => [row.getAttribute('data-owner-policy-row'), row.querySelector('[data-owner-policy-value]')!.textContent]));
  expect(values).toEqual({ access: 'shareJam.policyAccessLink', requests: 'shareJam.policyRequestsOwner', post: 'shareJam.policyPostYes', agents: 'jamAgents.policyGuestAgentsOff', expiry: 'shareJam.policyLinkNever', guests: '1' });
  await act(async () => { (panel.querySelector('[data-owner-copy-link]') as HTMLElement).click(); });
  expect(writeText).toHaveBeenCalledWith(LINK.url);
  expect(panel.querySelector('[data-owner-copy-link]')?.textContent).toBe('shareJam.guestLinkCopied');
  // Right after copying: "See what guests see" opens the preview.
  await act(async () => { (panel.querySelector('[data-owner-see-guests]') as HTMLElement).click(); });
  const frame = host.querySelector('[data-guest-preview-frame]') as HTMLIFrameElement;
  expect(frame.getAttribute('src')).toBe(`${window.location.origin}/jam/gtok?preview=1`);
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  expect(host.querySelector('[data-guest-preview-open]')?.getAttribute('href')).toBe(`${window.location.origin}/jam/gtok?preview=1`);
});

it('opens the link settings at the part a policy line names', async () => {
  serve(ownerServer());
  await open();
  await act(async () => { (host.querySelector('[data-owner-policy-row="guests"]') as HTMLElement).click(); });
  await wait(200);
  expect(host.querySelector('[data-owner-guest-link]')).not.toBeNull();
  expect(host.querySelector('[data-guest-link-section="guests"]')?.hasAttribute('data-focused')).toBe(true);
  expect(host.querySelector('[data-guest-link-section="requests"]')?.hasAttribute('data-focused')).toBe(false);
});

it('nudges to save an unsaved jam: sign in when signed out, one click when signed in', async () => {
  localStorage.clear();
  serve(ownerServer());
  await open();
  expect(host.querySelector('[data-owner-not-saved]')?.textContent).toContain('shareJam.notSavedBody');
  expect(host.querySelector('[data-owner-save]')?.textContent).toBe('shareJam.signInToSave');
  expect(host.querySelector('[data-owner-save-strip]')).not.toBeNull();
  await act(async () => { (host.querySelector('[data-owner-save]') as HTMLElement).click(); });
  expect(host.querySelector('[data-keep-step="sign-in"]')).not.toBeNull();
  // The strip, once dismissed, stays dismissed for this jam.
  await act(async () => { (host.querySelector('[data-owner-save-strip] [data-strip-dismiss]') as HTMLElement).click(); });
  expect(host.querySelector('[data-owner-save-strip]')).toBeNull();
  expect(localStorage.getItem('oa-owner-save-nudge:alex-share')).toBe('1');

  await act(async () => root.unmount());
  root = createRoot(host);
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
  serve(ownerServer(JAM, (url) => (url.endsWith('/v1/guest-links/claim') ? ok({ claimed: true }) : null)));
  await open();
  expect(host.querySelector('[data-owner-save]')?.textContent).toBe('shareJam.saveToJamsShort');
  await act(async () => { (host.querySelector('[data-owner-save]') as HTMLElement).click(); });
  await wait(0);
  expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/v1/guest-links/claim'))).toBe(true);
  expect(host.querySelector('[data-owner-saved] a')?.getAttribute('href')).toBe('/jams');
});

it('shows "Saved to your jams" for a saved jam', async () => {
  serve(ownerServer({ ...JAM, share: { claimed: true, movedTo: null } }));
  await open();
  expect(host.querySelector('[data-owner-saved]')).not.toBeNull();
  expect(host.querySelector('[data-owner-not-saved]')).toBeNull();
  expect(host.querySelector('[data-owner-save-strip]')).toBeNull();
});

it('pins what the owner opens for guests, unpins on close, and can hide it while keeping it open', async () => {
  serve(ownerServer());
  await open();
  const pins = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/jam/pin')).map((c) => JSON.parse(String((c[1] as RequestInit).body)));
  const tile = [...host.querySelectorAll('[data-share-resources] li button')].find((b) => b.textContent?.includes('notes.md')) as HTMLElement;
  await act(async () => { tile.click(); });
  await wait(600);
  expect(pins()).toEqual([{ kind: 'file', id: 'f-md' }]);
  expect(host.querySelector('[data-guests-see="on"]')).not.toBeNull();
  // Closing the viewer closes it for guests too.
  await act(async () => { (host.querySelector('[data-share-viewer-close]') as HTMLElement).click(); });
  await wait(600);
  expect(pins().at(-1)).toEqual({ kind: null });
  // Quick open/close flips settle into one call.
  await act(async () => { tile.click(); });
  await act(async () => { tile.click(); });
  await act(async () => { tile.click(); });
  await wait(600);
  expect(pins()).toHaveLength(3);
  expect(pins().at(-1)).toEqual({ kind: 'file', id: 'f-md' });
});

it('reopens the artifact guests see when the owner comes back, without pinning again', async () => {
  serve(ownerServer({ ...JAM, pinnedArtifact: { kind: 'file', id: 'f-md' } }));
  await open();
  await wait(50);
  expect(host.querySelector('[data-share-artifact-panel]')?.textContent).toContain('notes.md');
  await wait(600);
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/jam/pin'))).toBe(false);
  // "Show to guests" toggles back on from the viewer header once hidden.
  expect(host.querySelector('[data-guests-see="on"]')).not.toBeNull();
});

it('turns Ask on by default for the owner, even with several agents', async () => {
  serve(ownerServer({ ...JAM, agents: [...JAM.agents, { name: 'helper', displayName: 'helper', type: 'codex', online: true, acceptsGuests: true }] }));
  await open();
  const chips = [...host.querySelectorAll('[data-slot="toggle"]')];
  expect(chips[0].getAttribute('data-state')).toBe('on');
  expect(chips[1].getAttribute('data-state')).toBe('off');
});

it('"Don’t show to guests" unpins but keeps the artifact open for the owner', async () => {
  serve(ownerServer({ ...JAM, pinnedArtifact: { kind: 'file', id: 'f-md' } }));
  await open();
  await wait(50);
  const chip = host.querySelector('[data-guests-see="on"]') as HTMLElement;
  await act(async () => { chip.focus(); chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(0);
  await act(async () => { (document.querySelector('[data-guests-see-hide]') as HTMLElement).click(); });
  await wait(600);
  const pin = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/jam/pin')).map((c) => JSON.parse(String((c[1] as RequestInit).body)));
  expect(pin).toEqual([{ kind: null }]);
  expect(host.querySelector('[data-share-artifact-panel]')).not.toBeNull();
  expect(host.querySelector('[data-guests-see="off"]')).not.toBeNull();
});

const COMMANDS = ['npm i -g @openagents-org/agent-launcher', 'agn create helper --path ~/helper', 'agn connect helper tok-xyz'];

it('lets the owner add an agent: name checked as typed, then the commands to connect it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const posts: unknown[] = [];
  serve(ownerServer(JAM, (url, init) => {
    if (url.includes('/jam/agents') && init?.method === 'POST') { posts.push(JSON.parse(String(init.body))); return ok({ agent: { name: 'helper', type: 'claude', broughtBy: null }, commands: COMMANDS }); }
    return null;
  }));
  await open();
  await act(async () => { (host.querySelector('[data-add-agent-button]') as HTMLElement).click(); });
  const dialog = host.querySelector('[data-add-agent-dialog="owner"]')!;
  expect(dialog.querySelector('[data-add-agent-explain]')?.textContent).toBe('jamAgents.ownerExplain:{"agent":"claude-code"}');
  const input = dialog.querySelector('[data-add-agent-name]') as HTMLInputElement;
  const setValue = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await setValue('my helper');
  expect(dialog.querySelector('[data-add-agent-name-error]')?.textContent).toBe('jamAgents.name_spaces:{"max":48}');
  expect((dialog.querySelector('[data-add-agent-submit]') as HTMLButtonElement).disabled).toBe(true);
  await setValue('helper');
  expect(dialog.querySelector('[data-add-agent-name-error]')).toBeNull();
  await act(async () => { (dialog.querySelector('[data-add-agent-submit]') as HTMLElement).click(); });
  await wait(0);
  expect(posts).toEqual([{ name: 'helper', type: 'claude' }]);
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/jam/agents'))!;
  expect(call[0]).toBe('https://api.test/v1/guest-links/jam/agents?network=alex-share');
  expect(((call[1] as RequestInit).headers as Record<string, string>)['X-Workspace-Token']).toBe('ws-token');
  expect(host.querySelector('[data-add-agent-commands]')?.textContent).toBe(COMMANDS.join('\n'));
  // The owner's reply carries no one-time token.
  expect(host.querySelector('[data-add-agent-token-once]')).toBeNull();
  await act(async () => { (host.querySelector('[data-add-agent-copy="agent"]') as HTMLElement).click(); });
  expect(writeText).toHaveBeenCalledWith(`jamAgents.pasteIntro\n\n${COMMANDS.join('\n')}`);
});

it('lets the owner remove an added agent but not the one the jam was shared for', async () => {
  const deletes: string[] = [];
  const jam = { ...JAM, agents: [...JAM.agents, { name: 'maya-bot', displayName: 'maya-bot', type: 'codex', online: false, acceptsGuests: false, broughtBy: 'Maya' }] };
  serve(ownerServer(jam, (url, init) => {
    if (url.includes('/jam/agents/') && init?.method === 'DELETE') { deletes.push(url); return ok({ name: 'maya-bot', removed: true }); }
    return null;
  }));
  await open();
  expect(host.querySelector('[data-agent-row="claude-code"] [data-agent-remove]')).toBeNull();
  const row = host.querySelector('[data-agent-row="maya-bot"]')!;
  expect(row.querySelector('[data-agent-brought-by]')?.textContent).toBe('jamAgents.broughtBy:{"name":"Maya"}');
  await act(async () => { (row.querySelector('[data-agent-remove]') as HTMLElement).click(); });
  expect(deletes).toEqual([]);
  await act(async () => { (host.querySelector('[data-agent-remove-confirm="maya-bot"]') as HTMLElement).click(); });
  await wait(0);
  expect(deletes).toEqual(['https://api.test/v1/guest-links/jam/agents/maya-bot?network=alex-share']);
});

it('lets the owner allow guests to bring their own agents from the link settings', async () => {
  const patches: unknown[] = [];
  serve(ownerServer(JAM, (url, init) => {
    if (init?.method === 'PATCH') { patches.push(JSON.parse(String(init.body))); return ok({ link: { ...LINK, allowGuestAgents: true } }); }
    return null;
  }));
  await open();
  await act(async () => { (host.querySelector('[data-owner-policy-row="agents"]') as HTMLElement).click(); });
  await wait(100);
  expect(host.querySelector('[data-guest-link-agents]')?.getAttribute('data-guest-link-agents')).toBe('off');
  await act(async () => { (host.querySelector('[data-allow-agents-switch]') as HTMLElement).click(); });
  await wait(0);
  expect(patches).toEqual([{ allow_guest_agents: true }]);
  expect(host.querySelector('[data-guest-link-agents]')?.getAttribute('data-guest-link-agents')).toBe('on');
});
