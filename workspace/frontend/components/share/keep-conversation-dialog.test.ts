// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { user: null as null | { email: string }, idToken: null as null | string, loading: false, signIn: vi.fn() },
  login: vi.fn(),
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) }));
vi.mock('@/lib/api-base', () => ({ getApiBaseUrl: () => 'https://api.test' }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => state.auth }));
vi.mock('@/lib/auth-redirects', () => ({ goToCentralLogin: state.login }));
vi.mock('@/components/ui/responsive-dialog', () => {
  const pass = (tag: string) => ({ children, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-'))), children);
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? React.createElement('div', { 'data-open': '' }, children) : null),
    DialogContent: pass('div'), DialogHeader: pass('div'), DialogBody: pass('div'), DialogFooter: pass('div'),
    DialogTitle: pass('h2'), DialogDescription: pass('p'),
  };
});

import { KeepConversationDialog, rememberKeepIntent, takeKeepIntent } from './keep-conversation-dialog';

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const navigate = vi.fn();

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200 });
}
function fail(status: number, message: string) {
  return new Response(JSON.stringify({ code: status, message, data: null }), { status });
}
function serve(handler: (url: string, init?: RequestInit) => Response) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
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

async function render() {
  await act(async () => root.render(React.createElement(KeepConversationDialog, {
    open: true, onOpenChange: () => {}, network: 'alex-share', token: 'ws-token', threadName: 'share-abc', navigate,
  })));
}
async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function click(selector: string) {
  const el = host.querySelector(selector) as HTMLElement | null;
  expect(el, selector).not.toBeNull();
  await act(async () => { el!.click(); });
  await flush();
}
function signIn() {
  state.auth.user = { email: 'alex@example.com' };
  state.auth.idToken = 'id-tok';
}

it('signed out: asks to sign in and remembers the intent', async () => {
  serve(() => ok({}));
  await render();
  expect(host.querySelector('[data-keep-step="sign-in"]')).not.toBeNull();
  expect(host.textContent).toContain('shareJam.keepSignInDescription');
  await click('[data-keep-sign-in]');
  expect(state.login).toHaveBeenCalledTimes(1);
  expect(takeKeepIntent('alex-share')).toBe(true);
  expect(takeKeepIntent('alex-share')).toBe(false); // reading clears it
  expect(fetchMock).not.toHaveBeenCalled();
});

it('signed in: uses up a remembered intent and offers the three choices', async () => {
  rememberKeepIntent('alex-share');
  signIn();
  serve(() => ok({}));
  await render();
  expect(host.querySelector('[data-keep-step="choose"]')).not.toBeNull();
  expect([...host.querySelectorAll('[data-keep-choice]')].map((el) => el.getAttribute('data-keep-choice'))).toEqual(['claim', 'workspace', 'import']);
  expect(takeKeepIntent('alex-share')).toBe(false);
});

it('"Save to my jams" claims it, keeps it a jam and points to My jams', async () => {
  signIn();
  const onSaved = vi.fn();
  serve(() => ok({ claimed: true, already: false }));
  await act(async () => root.render(React.createElement(KeepConversationDialog, {
    open: true, onOpenChange: () => {}, network: 'alex-share', token: 'ws-token', threadName: 'share-abc', navigate, onSaved,
  })));
  await click('[data-keep-choice="claim"]');
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.test/v1/guest-links/claim');
  expect(JSON.parse(String(init.body))).toEqual({ network: 'alex-share' });
  expect(init.headers).toMatchObject({ 'X-Workspace-Token': 'ws-token', Authorization: 'Bearer id-tok' });
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(host.querySelector('[data-keep-step="saved"]')?.textContent).toContain('shareJam.savedToJams');
  expect(host.querySelector('[data-keep-my-jams] a, a[data-keep-my-jams]')?.getAttribute('href') ?? host.querySelector('[data-keep-my-jams]')?.getAttribute('href')).toBe('/jams');
});

it('"Make it a workspace" keeps it as a workspace and opens the thread there', async () => {
  signIn();
  serve(() => ok({ workspace: { id: 'w', slug: 'alex-share', name: 'Alex' }, channel: { name: 'share-abc', title: 'PR reviewer' } }));
  await render();
  await click('[data-keep-choice="workspace"]');
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.test/v1/jams/alex-share/keep-as-workspace');
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({ 'X-Workspace-Token': 'ws-token', Authorization: 'Bearer id-tok' });
  expect(navigate).toHaveBeenCalledWith('/alex-share/threads/share-abc');
});

it('shows "Saved to your jams" as done when it already is', async () => {
  signIn();
  serve(() => ok({}));
  await act(async () => root.render(React.createElement(KeepConversationDialog, {
    open: true, onOpenChange: () => {}, network: 'alex-share', token: '', threadName: 'share-abc', navigate, saved: true,
  })));
  const save = host.querySelector('[data-keep-choice="claim"]') as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(save.textContent).toContain('shareJam.savedToJams');
  // Without the owner token, the bearer alone keeps it as a workspace.
  serve(() => ok({ workspace: { id: 'w', slug: 'alex-share', name: 'Alex' }, channel: { name: 'share-abc', title: null } }));
  await click('[data-keep-choice="workspace"]');
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer id-tok' });
});

it('"Add to one of my workspaces" lists, imports and navigates to the new thread', async () => {
  signIn();
  serve((url) => {
    if (url.endsWith('/v1/workspaces')) return ok([
      { workspaceId: 'w-share', slug: 'alex-share', name: 'The share itself' },
      { workspaceId: 'w1', slug: 'team', name: 'Team' },
      { workspaceId: 'w2', slug: 'side', name: 'Side project' },
    ]);
    if (url.endsWith('/import')) return ok({ workspace: { id: 'w2', slug: 'side', name: 'Side project' }, channel: { name: 'share-abc-2', title: 'PR reviewer' } });
    return fail(500, 'unexpected');
  });
  await render();
  await click('[data-keep-choice="import"]');
  expect(host.textContent).toContain('shareJam.addToMineBody');
  // The share workspace itself isn't a target.
  expect(host.querySelector('[data-keep-workspace="w-share"]')).toBeNull();
  expect(host.querySelector('[data-keep-move]')?.hasAttribute('disabled')).toBe(true);
  await click('[data-keep-workspace="w2"]');
  await click('[data-keep-move]');
  const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/import'))!;
  expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ network: 'alex-share', target: 'w2' });
  expect((call[1] as RequestInit).headers).toMatchObject({ 'X-Workspace-Token': 'ws-token', Authorization: 'Bearer id-tok' });
  const list = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/v1/workspaces'))!;
  expect((list[1] as RequestInit).headers).toEqual({ Authorization: 'Bearer id-tok' });
  expect(navigate).toHaveBeenCalledWith('/side/threads/share-abc-2');
});

it('shows the server error plainly and stays put', async () => {
  signIn();
  serve(() => fail(409, 'Start your shared agent on your computer, then try again'));
  await render();
  await click('[data-keep-choice="claim"]');
  expect(host.querySelector('[data-keep-error]')?.textContent).toBe('Start your shared agent on your computer, then try again');
  expect(navigate).not.toHaveBeenCalled();
  // Still on the choice step, buttons usable again.
  expect(host.querySelector('[data-keep-choice="claim"]')?.hasAttribute('disabled')).toBe(false);
});

it('falls back to friendly copy when the server sends no message', async () => {
  signIn();
  serve((url) => (url.endsWith('/v1/workspaces') ? ok([{ workspaceId: 'w1', slug: 'team', name: 'Team' }]) : new Response('oops', { status: 403 })));
  await render();
  await click('[data-keep-choice="import"]');
  // One workspace: picked already.
  await click('[data-keep-move]');
  expect(host.querySelector('[data-keep-error]')?.textContent).toBe('shareJam.keepFailed');
  expect(navigate).not.toHaveBeenCalled();
});
