// @vitest-environment jsdom
import React, { act, createElement, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  auth: { user: null as { email: string } | null, idToken: null as string | null, loading: false, signOut: vi.fn() },
  login: vi.fn(), replace: vi.fn(), accept: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }) }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => state.auth }));
vi.mock('@/lib/auth-redirects', () => ({ goToCentralLogin: state.login, goToCentralLogout: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/invite-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/invite-api')>(),
  getInvitePeek: async () => ({ workspaceName: 'Invited workspace', status: 'pending', role: 'member' }),
  acceptInvite: state.accept,
}));
import InvitePage from './[token]/page';
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => { sessionStorage.clear(); document.body.innerHTML = ''; vi.clearAllMocks(); state.auth.user = null; state.auth.idToken = null; });

it('uses full login, resumes the same invite, and lands in its workspace', async () => {
  const container = document.createElement('div'); document.body.append(container);
  let root = createRoot(container);
  const params = Promise.resolve({ token: 'invite-123' });
  const render = () => root.render(createElement(Suspense, { fallback: null }, createElement(InvitePage, { params })));
  state.accept.mockResolvedValue({ slug: 'same-workspace', redirect: '#?thread=target' });
  await act(async () => { render(); });
  const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'invitePage.signInToAccept');
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(state.login).toHaveBeenCalledWith(undefined, { forceCentral: true });
  expect(sessionStorage.getItem('oa-accept-invite')).toBe('invite-123');
  await act(async () => root.unmount());
  state.auth.user = { email: 'person@example.com' }; state.auth.idToken = 'login-token';
  root = createRoot(container);
  await act(async () => { render(); });
  expect(state.accept).toHaveBeenCalledExactlyOnceWith('invite-123', 'login-token');
  expect(state.replace).toHaveBeenCalledWith('/same-workspace#?thread=target');
  expect(sessionStorage.getItem('oa-accept-invite')).toBeNull();
  await act(async () => root.unmount());
});
