// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthConfig } from '@/lib/auth-config';

const api = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn(), reset: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, params?: Record<string, unknown>) => params?.email ? `${key}:${params.email}` : key }));
vi.mock('@/lib/local-auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/local-auth')>(),
  localLogin: api.login, localSignup: api.signup, requestPasswordReset: api.reset,
}));

import { LocalAuthForm } from './local-auth-form';
import { LocalAuthError } from '@/lib/local-auth';

const open: AuthConfig = { localAuth: true, signupOpen: true, emailEnabled: true, providers: [] };
const closed: AuthConfig = { ...open, signupOpen: false };
const session = { token: 't', email: 'ana@example.com', displayName: null, expiresAt: 2e9 };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render(config: AuthConfig, inviteToken: string | null = null, onSession = vi.fn()) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(LocalAuthForm, { config, inviteToken, onSession })));
  return onSession;
}
const text = () => host.textContent || '';
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
function type(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const submit = () => act(async () => { host.querySelector('form')!.requestSubmit(); });

it('signs in and hands the session over', async () => {
  api.login.mockResolvedValue(session);
  const onSession = await render(open);
  await act(async () => { type('local-auth-email', ' ana@example.com '); type('local-auth-password', 'pw'); });
  await submit();
  expect(api.login).toHaveBeenCalledWith('ana@example.com', 'pw');
  expect(onSession).toHaveBeenCalledWith(session);
});

it('shows a generic message for wrong credentials', async () => {
  api.login.mockRejectedValue(new LocalAuthError(401, 'Invalid'));
  const onSession = await render(open);
  await act(async () => { type('local-auth-email', 'ana@example.com'); type('local-auth-password', 'pw'); });
  await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toBe('localAuth.invalidCredentials');
  expect(onSession).not.toHaveBeenCalled();
});

it('hides account creation when sign-up is closed and points to an invite', async () => {
  await render(closed);
  expect(host.querySelector('[role=tablist]')).toBeNull();
  expect(text()).toContain('localAuth.signupClosedHint');
});

it('opens on account creation for an invitation even when sign-up is closed, passing the token', async () => {
  api.signup.mockResolvedValue(session);
  const onSession = await render(closed, 'inv-1');
  expect(host.querySelector('#local-auth-confirm')).not.toBeNull();
  expect(text()).toContain('localAuth.invitedHint');
  await act(async () => {
    type('local-auth-email', 'ana@example.com'); type('local-auth-name', 'Ana');
    type('local-auth-password', 'long-enough'); type('local-auth-confirm', 'long-enough');
  });
  await submit();
  expect(api.signup).toHaveBeenCalledWith({ email: 'ana@example.com', password: 'long-enough', displayName: 'Ana', inviteToken: 'inv-1' });
  expect(onSession).toHaveBeenCalledWith(session);
});

it('validates sign-up locally before calling the server', async () => {
  await render(open);
  await act(async () => button('localAuth.signUpTab').click());
  await act(async () => { type('local-auth-email', 'ana@example.com'); type('local-auth-password', 'short'); type('local-auth-confirm', 'short'); });
  await submit();
  expect(host.querySelector('[role=alert]')?.textContent).toBe('localAuth.passwordTooShort');
  expect(api.signup).not.toHaveBeenCalled();
});

it('requests a reset email and confirms', async () => {
  api.reset.mockResolvedValue(undefined);
  await render(open);
  await act(async () => button('localAuth.forgot').click());
  await act(async () => type('local-auth-email', 'ana@example.com'));
  await submit();
  expect(api.reset).toHaveBeenCalledWith('ana@example.com');
  expect(text()).toContain('localAuth.resetSent:ana@example.com');
});

it('explains the admin reset command when the server cannot send email', async () => {
  await render({ ...open, emailEnabled: false });
  await act(async () => button('localAuth.forgot').click());
  expect(text()).toContain('localAuth.resetNoEmail');
  expect(text()).toContain('python -m app.cli.local_auth reset-password <email>');
  expect(host.querySelector('form')).toBeNull();
});
