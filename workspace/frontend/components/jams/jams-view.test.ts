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

import { JamsView } from './jams-view';

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const navigate = vi.fn();

const LINK = { id: 'l1', channel: 'share-a', url: 'https://app.test/jam/gtok', canPost: true, expiresAt: null, revokedAt: null, createdAt: '2026-11-20T00:00:00Z' };
const JAMS = [
  { workspace: { id: 'w-a', slug: 'jam-a', name: 'Alex’s jam' }, thread: { name: 'share-a', title: 'PR reviewer' }, owner: { name: 'Alex' },
    agents: [{ name: 'pr-reviewer', displayName: 'pr-reviewer', type: 'claude', online: true }], link: LINK, liveLink: LINK,
    share: { claimed: true, movedTo: null, keptAsWorkspace: false }, lastActivityAt: 1795430000000, guestCount: 3, pendingRequests: 2, keptAsWorkspace: false },
  { workspace: { id: 'w-b', slug: 'jam-b', name: 'B' }, thread: { name: 'share-b', title: 'Code explainer' }, owner: { name: 'Alex' },
    agents: [{ name: 'code-explainer', displayName: 'code-explainer', type: 'claude', online: false }], link: { ...LINK, revokedAt: 'x' }, liveLink: null,
    share: { claimed: true, movedTo: null }, lastActivityAt: null, guestCount: 0, pendingRequests: 0, keptAsWorkspace: false },
  { workspace: { id: 'w-c', slug: 'jam-c', name: 'C' }, thread: { name: 'share-c', title: 'Kept one' }, owner: { name: 'Alex' }, agents: [],
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
const server = (jams: unknown[] = JAMS) => (url: string, init?: RequestInit) => {
  if (url.endsWith('/v1/jams') && (!init?.method || init.method === 'GET')) return ok({ jams });
  if (url.endsWith('/keep-as-workspace')) return ok({ workspace: { id: 'w-a', slug: 'jam-a', name: 'A' }, channel: { name: 'share-a', title: 'PR reviewer' } });
  if (/\/v1\/jams\/[^/]+$/.test(url) && init?.method === 'DELETE') return ok({ deleted: true });
  if (url.endsWith('/v1/workspaces')) return ok([{ workspaceId: 'w-a', slug: 'jam-a', name: 'Jam itself' }, { workspaceId: 'w-team', slug: 'team', name: 'Team' }]);
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
  await act(async () => root.render(React.createElement(JamsView, { navigate })));
  await settle();
}
/** Open a jam's "more" menu and pick an action (Radix opens on Enter). */
async function action(slug: string, name: string) {
  const trigger = host.querySelector(`[data-jam="${slug}"] [data-jam-menu]`) as HTMLElement;
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await settle();
  const item = document.querySelector(`[data-jam-action="${name}"]`) as HTMLElement;
  expect(item, name).not.toBeNull();
  await act(async () => { item.click(); });
  await settle();
}

it('asks a signed-out person to sign in', async () => {
  state.auth.user = null; state.auth.idToken = null;
  serve(server());
  await render();
  expect(host.querySelector('[data-jams-state="sign-in"]')).not.toBeNull();
  await act(async () => { (host.querySelector('[data-jams-sign-in]') as HTMLElement).click(); });
  expect(state.login).toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('lists jams with their agent, activity, guests, requests and link state; kept ones apart', async () => {
  serve(server());
  await render();
  const call = fetchMock.mock.calls[0];
  expect(call[0]).toBe('https://api.test/v1/jams');
  expect(((call[1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer id-tok');
  const rows = [...host.querySelectorAll('[data-jams-list] [data-jam]')];
  expect(rows.map((r) => r.getAttribute('data-jam'))).toEqual(['jam-a', 'jam-b']);
  const a = rows[0];
  expect(a.textContent).toContain('PR reviewer');
  expect(a.querySelector('[data-jam-agent]')?.textContent).toBe('pr-reviewer');
  expect(a.textContent).toContain('jams.activity:{"time":"5m"}');
  expect(a.textContent).toContain('jams.guests:{"count":3}');
  expect(a.querySelector('[data-jam-pending]')?.textContent).toBe('jams.pending:{"count":2}');
  expect(a.querySelector('[data-jam-link]')?.getAttribute('data-jam-link')).toBe('live');
  expect(a.querySelector('[data-jam-open]')?.getAttribute('href')).toBe('/jam/own/jam-a');
  expect(rows[1].querySelector('[data-jam-link]')?.textContent).toBe('jams.linkOff');
  expect(rows[1].textContent).toContain('jams.noActivity');
  const kept = host.querySelector('[data-jams-kept]')!;
  expect(kept.querySelector('[data-jam-open-workspace]')?.getAttribute('href')).toBe('/jam-c/threads/share-c');
});

it('explains jams and offers the share one-liner when there are none', async () => {
  serve(server([]));
  await render();
  expect(host.querySelector('[data-jams-state="empty"]')).not.toBeNull();
  expect(host.querySelector('[data-jams-instruction]')?.textContent).toBe('jams.instruction:{"url":"https://api.test/v1/share/instructions"}');
});

it('copies the guest link and makes a jam a workspace', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  serve(server());
  await render();
  await action('jam-a', 'copy');
  expect(writeText).toHaveBeenCalledWith(LINK.url);
  await action('jam-a', 'workspace');
  const keep = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/keep-as-workspace'))!;
  expect(keep[0]).toBe('https://api.test/v1/jams/jam-a/keep-as-workspace');
  expect(((keep[1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer id-tok');
  expect(navigate).toHaveBeenCalledWith('/jam-a/threads/share-a');
});

it('deletes a jam only after confirming', async () => {
  serve(server());
  await render();
  state.confirm.mockResolvedValueOnce(false);
  await action('jam-b', 'delete');
  expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  await action('jam-b', 'delete');
  const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')!;
  expect(del[0]).toBe('https://api.test/v1/jams/jam-b');
  expect(host.querySelector('[data-jam="jam-b"]')).toBeNull();
});

it('adds a jam to one of the person’s workspaces', async () => {
  serve(server());
  await render();
  await action('jam-a', 'import');
  // The jam itself isn't a target; the only other workspace is preselected.
  expect(document.querySelector('[data-jam-target="w-a"]')).toBeNull();
  await act(async () => { (document.querySelector('[data-jam-move]') as HTMLElement).click(); });
  await settle();
  const imp = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/import'))!;
  expect(JSON.parse(String((imp[1] as RequestInit).body))).toEqual({ network: 'jam-a', target: 'w-team' });
  expect(((imp[1] as RequestInit).headers as Record<string, string>)['X-Workspace-Token']).toBeUndefined();
  expect(navigate).toHaveBeenCalledWith('/team/threads/share-a-2');
});

it('shows each jam’s access: anyone with the link, or invite-only', async () => {
  const invitedLink = { ...LINK, id: 'l9', access: 'invited', invitedEmails: ['maya@example.com'] };
  serve(server([JAMS[0], { ...JAMS[1], workspace: { id: 'w-z', slug: 'jam-z', name: 'Z' }, liveLink: invitedLink, link: invitedLink }]));
  await render();
  expect(host.querySelector('[data-jam="jam-a"] [data-jam-access]')?.getAttribute('data-jam-access')).toBe('link');
  const z = host.querySelector('[data-jam="jam-z"] [data-jam-access]')!;
  expect(z.getAttribute('data-jam-access')).toBe('invited');
  expect(z.textContent).toBe('jams.accessInvited');
});
