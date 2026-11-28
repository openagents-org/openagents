// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelfHostedEntry } from './self-hosted-entry';
import { readWorkspaceCookie, setWorkspaceCookie } from '@/lib/workspace-cookie';

const state = vi.hoisted(() => ({ router: { replace: vi.fn(), refresh: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/');
  document.cookie = 'oa_workspace=;path=/;max-age=0';
  document.cookie = 'oa_has_workspace=;path=/;max-age=0';
  state.router.replace.mockClear();
  state.router.refresh.mockClear();
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(React.createElement(SelfHostedEntry)));
}
function success(slug = 'team') {
  return { ok: true, status: 200, json: async () => ({ code: 0, data: { slug } }) };
}

it('offers a labelled password input without requiring URL editing', async () => {
  await render();
  const input = document.querySelector<HTMLInputElement>('#workspace-access-token')!;
  expect(input.type).toBe('password');
  expect(document.querySelector('label')?.htmlFor).toBe(input.id);
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
  expect(state.router.replace).not.toHaveBeenCalled();
});

it('resolves an explicit root token before an old cookie, then removes it from the destination URL', async () => {
  setWorkspaceCookie('old-team', 'old-synthetic-token');
  window.history.replaceState(null, '', '/?token=new-synthetic-token');
  const fetch = vi.fn().mockResolvedValue(success());
  vi.stubGlobal('fetch', fetch);
  await render();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ token: 'new-synthetic-token' });
  expect(state.router.replace).toHaveBeenCalledWith('/team');
  expect(readWorkspaceCookie()).toEqual({ slug: 'team', token: 'new-synthetic-token' });
});

it('returns to a saved workspace without putting its credential in the URL', async () => {
  setWorkspaceCookie('team', 'synthetic-token');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await render();
  expect(state.router.replace).toHaveBeenCalledWith('/team');
  expect(fetch).not.toHaveBeenCalled();
});

it('allows recovery from an invalid root token by pasting a valid token', async () => {
  window.history.replaceState(null, '', '/?token=invalid-synthetic');
  const fetch = vi.fn().mockResolvedValueOnce({ status: 404 }).mockResolvedValueOnce(success());
  vi.stubGlobal('fetch', fetch);
  await render();
  expect(document.querySelector('[role=alert]')?.textContent).toBe('workspaceGate.invalidToken');
  const input = document.querySelector<HTMLInputElement>('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '  valid-synthetic  ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ token: 'valid-synthetic' });
  expect(state.router.replace).toHaveBeenCalledWith('/team');
  expect(readWorkspaceCookie('team')?.token).toBe('valid-synthetic');
});

it('reports service failure separately and does not save the failed token', async () => {
  window.history.replaceState(null, '', '/?token=synthetic');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
  await render();
  expect(document.querySelector('[role=alert]')?.textContent).toBe('workspaceGate.accessUnavailable');
  expect(state.router.replace).not.toHaveBeenCalled();
  expect(readWorkspaceCookie()).toBeNull();
});
