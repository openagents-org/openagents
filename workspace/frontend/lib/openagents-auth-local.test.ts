// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), clear: vi.fn(), setRefresher: vi.fn(), firebaseLoaded: vi.fn(),
  config: { localAuth: true, signupOpen: false, emailEnabled: false, providers: [] } as unknown,
}));
vi.mock('./workspace-session', () => ({ loadWorkspaceSession: mocks.load, clearWorkspaceSession: mocks.clear }));
vi.mock('./api', () => ({ workspaceApi: { setBearerRefresher: mocks.setRefresher } }));
vi.mock('./firebase', () => { mocks.firebaseLoaded(); return { onIdTokenChange: () => () => {}, signOutUser: vi.fn() }; });
vi.mock('./auth-config', async (importOriginal) => ({
  ...await importOriginal<typeof import('./auth-config')>(),
  fetchAuthConfig: () => Promise.resolve(mocks.config),
}));

import { OpenAgentsAuthProvider, useOpenAgentsAuth } from './openagents-auth-context';
import { isLocalAuthMode, setCurrentAuthMode } from './auth-config';

let root: Root;
let container: HTMLDivElement;
let auth: ReturnType<typeof useOpenAgentsAuth>;
function View() { auth = useOpenAgentsAuth(); return null; }
async function mount() {
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(React.createElement(OpenAgentsAuthProvider, null, React.createElement(View))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); setCurrentAuthMode(null); });

it('restores a stored local session without ever loading Firebase', async () => {
  mocks.load.mockReturnValue({ token: 'local-jwt', email: 'ana@example.com', displayName: 'Ana', expiresAt: Date.now() / 1000 + 3600 });
  await mount();
  expect(auth.authMode).toBe('local');
  expect(auth.loginRequired).toBe(true);
  expect(auth.isOpenAgentsDomain).toBe(false);
  expect(auth.loading).toBe(false);
  expect(auth.idToken).toBe('local-jwt');
  expect(auth.user?.email).toBe('ana@example.com');
  expect(isLocalAuthMode()).toBe(true);
  await act(async () => auth.signOut());
  expect(mocks.clear).toHaveBeenCalled();
  expect(auth.user).toBeNull();
  expect(mocks.firebaseLoaded).not.toHaveBeenCalled();
});

it('is signed out (not loading) with no stored session, and a 401 after expiry signs out', async () => {
  mocks.load.mockReturnValue(null);
  await mount();
  expect(auth.authMode).toBe('local');
  expect(auth.loading).toBe(false);
  expect(auth.user).toBeNull();
  const refresher = mocks.setRefresher.mock.calls.find((c) => typeof c[0] === 'function')![0];
  await expect(refresher()).resolves.toBeNull();
  expect(mocks.firebaseLoaded).not.toHaveBeenCalled();
});

it('falls back to the hosted flow when the config call fails', async () => {
  mocks.config = null;
  mocks.load.mockReturnValue({ token: 'ws-jwt', email: 'b@example.com', displayName: null, expiresAt: Date.now() / 1000 + 3600 });
  await mount();
  // jsdom is localhost: a first-party host, so hosted.
  expect(auth.authMode).toBe('hosted');
  expect(auth.isOpenAgentsDomain).toBe(true);
  expect(auth.idToken).toBe('ws-jwt');
});
