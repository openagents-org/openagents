// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  auth: { user: { email: 'tess@example.com' } as { email: string } | null, idToken: 'id-token', loading: false, signIn: vi.fn() },
  approve: vi.fn(),
  assign: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => mocks.auth }));
vi.mock('@/lib/account-api', () => ({ approveOAuth: mocks.approve }));
vi.mock('@/lib/auth-redirects', () => ({ goToCentralLogin: vi.fn() }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, p?: Record<string, string>) => translate(messages, messages, 'en-US', key, p) }));

import OAuthAuthorizePage from './page';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.params = new URLSearchParams({ client_id: 'oac_1', redirect_uri: 'https://chatgpt.com/cb', code_challenge: 'c',
    code_challenge_method: 'S256', state: 's', client_name: 'ChatGPT' });
  mocks.auth.user = { email: 'tess@example.com' };
  mocks.approve.mockReset().mockResolvedValue({ redirect: 'https://chatgpt.com/cb?code=x&state=s', client_name: 'ChatGPT' });
  Object.defineProperty(window, 'location', { value: { ...window.location, assign: mocks.assign }, writable: true });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;

it('names the app and the account, and returns to the app with the code on Allow', async () => {
  await act(async () => root.render(createElement(OAuthAuthorizePage)));
  expect(host.textContent).toContain('Connect ChatGPT to OpenAgents');
  expect(host.textContent).toContain('tess@example.com');
  await act(async () => button('Allow').click());
  expect(mocks.approve).toHaveBeenCalledWith('id-token', expect.objectContaining({ client_id: 'oac_1', approve: true, state: 's' }));
  expect(mocks.assign).toHaveBeenCalledWith('https://chatgpt.com/cb?code=x&state=s');
});

it('sends Cancel as a denial', async () => {
  await act(async () => root.render(createElement(OAuthAuthorizePage)));
  await act(async () => button('Cancel').click());
  expect(mocks.approve).toHaveBeenCalledWith('id-token', expect.objectContaining({ approve: false }));
});

it('refuses an incomplete link and asks a signed-out person to sign in first', async () => {
  mocks.params = new URLSearchParams({ client_id: 'oac_1' });
  await act(async () => root.render(createElement(OAuthAuthorizePage)));
  expect(host.textContent).toContain(messages.hubApps.consentInvalid);
  mocks.params = new URLSearchParams({ client_id: 'oac_1', redirect_uri: 'https://x/cb', code_challenge: 'c', code_challenge_method: 'S256' });
  mocks.auth.user = null;
  await act(async () => root.render(createElement(OAuthAuthorizePage)));
  expect(button('Sign in')).toBeTruthy();
  expect(host.textContent).not.toContain('Allow');
});
