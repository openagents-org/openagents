// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceLoadError } from './workspace-load-error';
import { translate } from '@/lib/i18n/translate';
import en from '@/lib/i18n/messages/en-US';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/openagents-auth-context', () => ({
  useOpenAgentsAuth: () => ({ user: { email: 'viewer@example.com' }, signIn }),
}));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, params?: Record<string, string>) =>
  translate(en, en, 'en-US', key as never, params) }));

let root: Root;
let container: HTMLDivElement;
const retry = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  signIn.mockReset(); retry.mockReset();
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
async function render(status: number | null) {
  await act(async () => root.render(React.createElement(WorkspaceLoadError, { status, onRetry: retry })));
}

it.each([401, 403])('explains HTTP %s and offers account selection without dropping the identity', async (status) => {
  await render(status);
  expect(container.textContent).toContain('Sign-in or workspace access required');
  expect(container.textContent).toContain('viewer@example.com');
  expect(container.textContent).not.toContain('network error');
  await act(async () => container.querySelector('button')!.click());
  expect(signIn).toHaveBeenCalledOnce();
  expect(retry).not.toHaveBeenCalled();
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/');
});
it('keeps a failed account switch recoverable', async () => {
  signIn.mockRejectedValue(new Error('Popup cancelled'));
  await render(401);
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toContain('Could not start Google sign-in');
  expect(container.querySelector('button')!.disabled).toBe(false);
});
it.each([[null, 'network error'], [503, 'service could not complete'], [404, 'No workspace exists']])(
  'distinguishes %s from access errors', async (status, text) => {
    await render(status as number | null);
    expect(container.textContent).toContain(text);
    expect(container.textContent).not.toContain('Choose another account');
    if (status !== 404) {
      await act(async () => container.querySelector('button')!.click());
      expect(retry).toHaveBeenCalledOnce();
    }
  },
);
