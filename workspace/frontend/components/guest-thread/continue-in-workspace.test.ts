// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { user: null as null | { email: string }, idToken: null as null | string, loading: false, signIn: vi.fn() },
  login: vi.fn(),
}));
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);
vi.mock('@/lib/i18n', () => ({ useT: () => t }));
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

import { ContinueInWorkspace, rememberForkIntent } from './continue-in-workspace';

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const navigate = vi.fn();

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200 });
}
function serve(handler: (url: string, init?: RequestInit) => Response) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
}
const server = (forkStatus = 200) => (url: string, init?: RequestInit) => {
  if (url.endsWith('/v1/workspaces')) return ok([{ workspaceId: 'ws-9', slug: 'mine', name: 'My team' }]);
  if (url.endsWith('/fork') && init?.method === 'POST') {
    if (forkStatus !== 200) return new Response(JSON.stringify({ code: forkStatus, message: 'no' }), { status: forkStatus });
    const body = JSON.parse(String(init.body));
    return ok({ workspace: { id: 'x', slug: body.target ? 'mine' : 'maya-ws', name: 'W' }, channel: { name: 'share-copy', title: 'PR reviewer' } });
  }
  return new Response('{}', { status: 500 });
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  state.auth.user = null; state.auth.idToken = null; state.login.mockReset(); navigate.mockReset();
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
  await act(async () => root.render(React.createElement(ContinueInWorkspace, { token: 'tok', navigate })));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const click = async (selector: string) => {
  await act(async () => { (host.querySelector(selector) as HTMLElement).click(); });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

it('asks a signed-out guest to sign in and remembers why', async () => {
  serve(server());
  await render();
  await click('[data-fork-open]');
  expect(host.querySelector('[data-fork-step="sign-in"]')?.textContent).toBe('guestThread.forkBody');
  await click('[data-fork-sign-in]');
  expect(state.login).toHaveBeenCalled();
  expect(sessionStorage.getItem('oa-share-fork-intent:tok')).toBe('1');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('copies into a new workspace by default, with the bearer, and opens it', async () => {
  state.auth.user = { email: 'maya@example.com' }; state.auth.idToken = 'id-tok';
  serve(server());
  await render();
  await click('[data-fork-open]');
  expect(host.querySelector('[data-fork-target="new"]')?.getAttribute('aria-checked')).toBe('true');
  expect(host.querySelector('[data-fork-target="ws-9"]')?.textContent).toContain('My team');
  await click('[data-fork-continue]');
  const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
  expect(post[0]).toBe('https://api.test/v1/guest-links/public/tok/fork');
  expect(((post[1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer id-tok');
  expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({});
  expect(navigate).toHaveBeenCalledWith('/maya-ws/threads/share-copy');
});

it('copies into one of the guest’s workspaces and says when they aren’t a member', async () => {
  state.auth.user = { email: 'maya@example.com' }; state.auth.idToken = 'id-tok';
  serve(server(403));
  await render();
  await click('[data-fork-open]');
  await click('[data-fork-target="ws-9"]');
  await click('[data-fork-continue]');
  const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
  expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ target: 'ws-9' });
  expect(host.querySelector('[data-fork-error]')?.textContent).toBe('guestThread.forkForbidden');
  expect(navigate).not.toHaveBeenCalled();
});

it('reopens after signing in when the guest was taking a copy', async () => {
  rememberForkIntent('tok');
  state.auth.user = { email: 'maya@example.com' }; state.auth.idToken = 'id-tok';
  serve(server());
  await render();
  expect(host.querySelector('[data-fork-step="choose"]')).not.toBeNull();
  expect(sessionStorage.getItem('oa-share-fork-intent:tok')).toBeNull();
});
