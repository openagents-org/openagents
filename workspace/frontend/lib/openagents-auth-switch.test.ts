// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpenAgentsAuthProvider, useOpenAgentsAuth } from './openagents-auth-context';

const mocks = vi.hoisted(() => ({
  clear: vi.fn(), signIn: vi.fn(), getToken: vi.fn(), fresh: vi.fn(), setRefresher: vi.fn(),
  onIdTokenChange: vi.fn(), resolvedEmail: vi.fn(), load: vi.fn(),
}));
vi.mock('./workspace-session', () => ({
  loadWorkspaceSession: mocks.load,
  clearWorkspaceSession: mocks.clear,
}));
vi.mock('./api', () => ({ workspaceApi: { setBearerRefresher: mocks.setRefresher } }));
vi.mock('./analytics', () => ({ capture: vi.fn(), identify: vi.fn() }));
vi.mock('./firebase', () => ({
  signInWithGoogle: mocks.signIn, getIdToken: mocks.getToken, getFreshIdToken: mocks.fresh,
  getResolvedEmail: mocks.resolvedEmail,
  onIdTokenChange: mocks.onIdTokenChange,
}));

let root: Root;
let container: HTMLDivElement;
let auth: ReturnType<typeof useOpenAgentsAuth>;
function View() { auth = useOpenAgentsAuth(); return null; }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.load.mockReturnValue({ token: 'old-session', email: 'old@example.com', displayName: 'Old account' });
  mocks.signIn.mockResolvedValue({ email: 'new@example.com', displayName: 'New account', photoURL: null });
  mocks.getToken.mockResolvedValue('new-identity');
  mocks.fresh.mockResolvedValue('renewed-identity');
  mocks.resolvedEmail.mockResolvedValue('test2011@bzumail.com');
  mocks.onIdTokenChange.mockReturnValue(() => {});
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(OpenAgentsAuthProvider, null, React.createElement(View))));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it('replaces a stored session only after successful sign-in and refreshes the new account', async () => {
  expect(auth.idToken).toBe('old-session');
  await act(async () => auth.signIn());
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(auth.user?.email).toBe('new@example.com');
  expect(auth.idToken).toBe('new-identity');
  await act(async () => { await mocks.setRefresher.mock.lastCall![0](); });
  expect(mocks.fresh).toHaveBeenCalledWith(true);
  expect(auth.idToken).toBe('renewed-identity');
});

it('retains the existing identity when sign-in produces no token', async () => {
  mocks.getToken.mockResolvedValue(null);
  await act(async () => { await expect(auth.signIn()).rejects.toThrow('identity token'); });
  expect(auth.idToken).toBe('old-session');
  expect(mocks.clear).not.toHaveBeenCalled();
  expect(mocks.setRefresher).not.toHaveBeenCalled();
});

it('uses the handoff name claim when the Firebase user has no profile name', async () => {
  await act(async () => root.unmount());
  mocks.load.mockReturnValue(null);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(OpenAgentsAuthProvider, null, React.createElement(View))));
  await vi.waitFor(() => expect(mocks.onIdTokenChange).toHaveBeenCalled());
  const onToken = mocks.onIdTokenChange.mock.calls[0][0];
  expect(onToken).toBeTypeOf('function');
  await act(async () => onToken({
    email: null, displayName: null, photoURL: null, providerData: [],
    getIdTokenResult: async () => ({ token: 'named-identity', claims: { name: 'Cuji' } }),
  }));
  expect(auth.user).toEqual({ email: 'test2011@bzumail.com', displayName: 'Cuji', photoURL: null });
});
