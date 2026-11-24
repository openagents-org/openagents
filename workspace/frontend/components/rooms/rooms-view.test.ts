// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { user: null as null | { email: string }, idToken: null as null | string, loading: false, signIn: vi.fn() },
  login: vi.fn(),
  confirm: vi.fn(async () => true),
  toast: { success: vi.fn(), error: vi.fn() },
}));
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => ({ formatDateTime: () => 'DT', timeAgoShort: () => '5m', formatTime: () => 'T' }) }));
vi.mock('@/lib/api-base', () => ({ getApiBaseUrl: () => 'https://api.test' }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => state.auth }));
vi.mock('@/lib/auth-redirects', () => ({ goToCentralLogin: state.login }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => state.confirm }));
vi.mock('sonner', () => ({ toast: state.toast }));
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => React.createElement('img', { alt: props.alt }) }));
vi.mock('@/components/ui/responsive-dialog', () => {
  const pass = (tag: string) => ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-'))), children);
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? React.createElement('div', { 'data-open': '' }, children) : null),
    DialogContent: pass('div'), DialogHeader: pass('div'), DialogBody: pass('div'), DialogFooter: pass('div'),
    DialogTitle: pass('h2'), DialogDescription: pass('p'),
  };
});

import { RoomsView } from './rooms-view';

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const navigate = vi.fn();

const LINK = { id: 'l1', channel: 'share-a', url: 'https://app.test/share/thread/gtok', canPost: true, expiresAt: null, revokedAt: null, createdAt: '2026-11-20T00:00:00Z' };
const ROOMS = [
  { workspace: { id: 'w-a', slug: 'room-a', name: 'Alex’s room' }, thread: { name: 'share-a', title: 'PR reviewer' }, owner: { name: 'Alex' },
    agents: [{ name: 'pr-reviewer', displayName: 'pr-reviewer', type: 'claude', online: true }], link: LINK, liveLink: LINK,
    share: { claimed: true, movedTo: null, keptAsWorkspace: false }, lastActivityAt: 1795430000000, guestCount: 3, pendingRequests: 2, keptAsWorkspace: false },
  { workspace: { id: 'w-b', slug: 'room-b', name: 'B' }, thread: { name: 'share-b', title: 'Code explainer' }, owner: { name: 'Alex' },
    agents: [{ name: 'code-explainer', displayName: 'code-explainer', type: 'claude', online: false }], link: { ...LINK, revokedAt: 'x' }, liveLink: null,
    share: { claimed: true, movedTo: null }, lastActivityAt: null, guestCount: 0, pendingRequests: 0, keptAsWorkspace: false },
  { workspace: { id: 'w-c', slug: 'room-c', name: 'C' }, thread: { name: 'share-c', title: 'Kept one' }, owner: { name: 'Alex' }, agents: [],
    link: null, liveLink: null, share: { claimed: true, movedTo: null, keptAsWorkspace: true }, lastActivityAt: 1, guestCount: 0, pendingRequests: 0, keptAsWorkspace: true },
  { workspace: { id: 'w-x' }, thread: {} },
];

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200 });
}
function serve(handler: (url: string, init?: RequestInit) => Response) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
}
const server = (rooms: unknown[] = ROOMS) => (url: string, init?: RequestInit) => {
  if (url.endsWith('/v1/rooms') && (!init?.method || init.method === 'GET')) return ok({ rooms });
  if (url.endsWith('/keep-as-workspace')) return ok({ workspace: { id: 'w-a', slug: 'room-a', name: 'A' }, channel: { name: 'share-a', title: 'PR reviewer' } });
  if (/\/v1\/rooms\/[^/]+$/.test(url) && init?.method === 'DELETE') return ok({ deleted: true });
  if (url.endsWith('/v1/workspaces')) return ok([{ workspaceId: 'w-a', slug: 'room-a', name: 'Room itself' }, { workspaceId: 'w-team', slug: 'team', name: 'Team' }]);
  if (url.endsWith('/v1/guest-links/import')) return ok({ workspace: { id: 'w-team', slug: 'team', name: 'Team' }, channel: { name: 'share-a-2', title: 'PR reviewer' } });
  return new Response('{}', { status: 500 });
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
  state.auth.loading = false;
  state.confirm.mockResolvedValue(true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function render() {
  await act(async () => root.render(React.createElement(RoomsView, { navigate })));
  await settle();
}
/** Open a room's "more" menu and pick an action (Radix opens on Enter). */
async function action(slug: string, name: string) {
  const trigger = host.querySelector(`[data-room="${slug}"] [data-room-menu]`) as HTMLElement;
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  const item = document.querySelector(`[data-room-action="${name}"]`) as HTMLElement;
  expect(item, name).not.toBeNull();
  await act(async () => { item.click(); });
  await settle();
}

it('asks a signed-out person to sign in', async () => {
  state.auth.user = null; state.auth.idToken = null;
  serve(server());
  await render();
  expect(host.querySelector('[data-rooms-state="sign-in"]')).not.toBeNull();
  await act(async () => { (host.querySelector('[data-rooms-sign-in]') as HTMLElement).click(); });
  expect(state.login).toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('lists rooms with their agent, activity, guests, requests and link state; kept ones apart', async () => {
  serve(server());
  await render();
  const call = fetchMock.mock.calls[0];
  expect(call[0]).toBe('https://api.test/v1/rooms');
  expect(((call[1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer id-tok');
  const rows = [...host.querySelectorAll('[data-rooms-list] [data-room]')];
  expect(rows.map((r) => r.getAttribute('data-room'))).toEqual(['room-a', 'room-b']);
  const a = rows[0];
  expect(a.textContent).toContain('PR reviewer');
  expect(a.querySelector('[data-room-agent]')?.textContent).toBe('pr-reviewer');
  expect(a.textContent).toContain('rooms.activity:{"time":"5m"}');
  expect(a.textContent).toContain('rooms.guests:{"count":3}');
  expect(a.querySelector('[data-room-pending]')?.textContent).toBe('rooms.pending:{"count":2}');
  expect(a.querySelector('[data-room-link]')?.getAttribute('data-room-link')).toBe('live');
  expect(a.querySelector('[data-room-open]')?.getAttribute('href')).toBe('/share/own/room-a');
  expect(rows[1].querySelector('[data-room-link]')?.textContent).toBe('rooms.linkOff');
  expect(rows[1].textContent).toContain('rooms.noActivity');
  const kept = host.querySelector('[data-rooms-kept]')!;
  expect(kept.querySelector('[data-room-open-workspace]')?.getAttribute('href')).toBe('/room-c/threads/share-c');
});

it('explains rooms and offers the share one-liner when there are none', async () => {
  serve(server([]));
  await render();
  expect(host.querySelector('[data-rooms-state="empty"]')).not.toBeNull();
  expect(host.querySelector('[data-rooms-instruction]')?.textContent).toBe('rooms.instruction:{"url":"https://api.test/v1/share/instructions"}');
});

it('copies the guest link and makes a room a workspace', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  serve(server());
  await render();
  await action('room-a', 'copy');
  expect(writeText).toHaveBeenCalledWith(LINK.url);
  await action('room-a', 'workspace');
  const keep = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/keep-as-workspace'))!;
  expect(keep[0]).toBe('https://api.test/v1/rooms/room-a/keep-as-workspace');
  expect(((keep[1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer id-tok');
  expect(navigate).toHaveBeenCalledWith('/room-a/threads/share-a');
});

it('deletes a room only after confirming', async () => {
  serve(server());
  await render();
  state.confirm.mockResolvedValueOnce(false);
  await action('room-b', 'delete');
  expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  await action('room-b', 'delete');
  const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')!;
  expect(del[0]).toBe('https://api.test/v1/rooms/room-b');
  expect(host.querySelector('[data-room="room-b"]')).toBeNull();
});

it('adds a room to one of the person’s workspaces', async () => {
  serve(server());
  await render();
  await action('room-a', 'import');
  // The room itself isn't a target; the only other workspace is preselected.
  expect(document.querySelector('[data-room-target="w-a"]')).toBeNull();
  await act(async () => { (document.querySelector('[data-room-move]') as HTMLElement).click(); });
  await settle();
  const imp = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/import'))!;
  expect(JSON.parse(String((imp[1] as RequestInit).body))).toEqual({ network: 'room-a', target: 'w-team' });
  expect(((imp[1] as RequestInit).headers as Record<string, string>)['X-Workspace-Token']).toBeUndefined();
  expect(navigate).toHaveBeenCalledWith('/team/threads/share-a-2');
});

it('shows each room’s access: anyone with the link, or invite-only', async () => {
  const invitedLink = { ...LINK, id: 'l9', access: 'invited', invitedEmails: ['maya@example.com'] };
  serve(server([ROOMS[0], { ...ROOMS[1], workspace: { id: 'w-z', slug: 'room-z', name: 'Z' }, liveLink: invitedLink, link: invitedLink }]));
  await render();
  expect(host.querySelector('[data-room="room-a"] [data-room-access]')?.getAttribute('data-room-access')).toBe('link');
  const z = host.querySelector('[data-room="room-z"] [data-room-access]')!;
  expect(z.getAttribute('data-room-access')).toBe('invited');
  expect(z.textContent).toBe('rooms.accessInvited');
});
