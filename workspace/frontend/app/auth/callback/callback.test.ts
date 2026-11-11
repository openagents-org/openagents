// @vitest-environment jsdom
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  auth: { idToken: null as string | null, adoptWorkspaceSession: vi.fn() },
  routerReplace: vi.fn(), locationReplace: vi.fn(), capture: vi.fn(),
  signIn: vi.fn(), exchange: vi.fn(), list: vi.fn(),
  storedSession: null as object | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.routerReplace }) }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => state.auth }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/analytics', () => ({ capture: state.capture }));
vi.mock('@/lib/firebase', () => ({ signInWithCustomTokenValue: state.signIn }));
vi.mock('@/lib/workspace-session', () => ({
  exchangeHandoffToken: state.exchange,
  clearWorkspaceSession: vi.fn(),
  loadWorkspaceSession: () => state.storedSession,
}));
vi.mock('@/lib/account-api', () => ({ listAccountWorkspaces: state.list }));
import AuthCallbackPage from './page';
import { clearWorkspaceSnapshots, recallWorkspaceToken } from '@/lib/workspace-snapshot';
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const owned = { workspaceId: 'w1', slug: 'abc123', name: 'My Workspace', token: 'ws-token', role: 'owner', lastActivityAt: null };
let root: Root;
const realLocation = window.location;

function open(query: string) {
  window.history.replaceState(null, '', `/auth/callback?${query}`);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  return () => root.render(createElement(AuthCallbackPage));
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, search: '', origin: realLocation.origin, replace: state.locationReplace },
  });
  // The page reads its query from window.location.search.
  Object.defineProperty(window.location, 'search', { get: () => realLocation.search });
});

afterEach(async () => {
  await act(async () => root.unmount());
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.useRealTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
  clearWorkspaceSnapshots();
  state.auth.idToken = null;
  state.storedSession = null;
});

it('skips Firebase when openagents.org says Google is unreachable, and enters the only workspace in place', async () => {
  state.exchange.mockResolvedValue({ token: 'session-jwt', email: 'a@example.com', displayName: null, expiresAt: 0 });
  state.auth.adoptWorkspaceSession.mockImplementation((s: { token: string }) => { state.auth.idToken = s.token; });
  state.list.mockResolvedValue([owned]);
  const render = open('ct=custom&returnTo=%2F&google=unreachable');
  await act(async () => { render(); });
  await act(async () => { render(); });

  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.exchange).toHaveBeenCalledWith('custom');
  expect(state.list).toHaveBeenCalledWith('session-jwt', expect.anything());
  expect(state.routerReplace).toHaveBeenCalledExactlyOnceWith('/abc123');
  expect(state.locationReplace).not.toHaveBeenCalled();
  // The workspace page opens on this token instead of fetching the list again.
  expect(recallWorkspaceToken('abc123', 'session-jwt')).toBe('ws-token');
  expect(sessionStorage.getItem('oa_auto_entered_first_ws')).toBe('1');
  expect(state.capture).toHaveBeenCalledWith('first_workspace_auto_entered', { workspace_id: 'abc123' });
});

it('moves on in place once the auth context publishes the Firebase sign-in', async () => {
  state.signIn.mockResolvedValue({ getIdToken: async () => 'firebase-id' });
  state.list.mockResolvedValue([owned, { ...owned, workspaceId: 'w2', slug: 'def456' }]);
  const render = open('ct=custom&returnTo=%2F');
  await act(async () => { render(); });
  expect(state.routerReplace).not.toHaveBeenCalled();

  state.auth.idToken = 'firebase-id';
  await act(async () => { render(); });
  expect(state.exchange).not.toHaveBeenCalled();
  // Two workspaces: the home page shows the list.
  expect(state.routerReplace).toHaveBeenCalledExactlyOnceWith('/');
  expect(recallWorkspaceToken('def456', 'firebase-id')).toBe('ws-token');
});

it('goes straight to a deep link without fetching the list', async () => {
  state.signIn.mockResolvedValue({ getIdToken: async () => 'firebase-id' });
  state.auth.idToken = 'firebase-id';
  const render = open(`ct=custom&returnTo=${encodeURIComponent(`${realLocation.origin}/abc123?thread=t1`)}`);
  await act(async () => { render(); });
  await act(async () => { render(); });
  expect(state.list).not.toHaveBeenCalled();
  expect(state.routerReplace).toHaveBeenCalledExactlyOnceWith('/abc123?thread=t1');
});

it('falls back to a full reload when the auth context does not catch up', async () => {
  vi.useFakeTimers();
  state.signIn.mockResolvedValue({ getIdToken: async () => 'firebase-id' });
  const render = open('ct=custom&returnTo=%2F');
  await act(async () => { render(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(state.locationReplace).toHaveBeenCalledExactlyOnceWith('/');
  expect(state.routerReplace).not.toHaveBeenCalled();
});

it('reloads when a workspace session was already stored, since the context ignores Firebase then', async () => {
  state.storedSession = { token: 'old', email: 'a@example.com' };
  state.signIn.mockResolvedValue({ getIdToken: async () => 'firebase-id' });
  const render = open('ct=custom&returnTo=%2F');
  await act(async () => { render(); });
  expect(state.locationReplace).toHaveBeenCalledExactlyOnceWith('/');
  expect(state.routerReplace).not.toHaveBeenCalled();
});
