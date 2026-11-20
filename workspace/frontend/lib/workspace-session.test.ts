// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  exchangeHandoffToken, loadWorkspaceSession, renewWorkspaceSession, saveWorkspaceSession, sessionNeedsRenewal,
} from './workspace-session';

const request = vi.fn();
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  request.mockReset();
  vi.stubGlobal('fetch', request);
});
afterEach(() => { vi.unstubAllGlobals(); });

it('exchanges the handoff directly and persists the returned session', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ data: {
    session_token: 'test-session', email: 'test@example.com', display_name: 'Test',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  } })));
  const session = await exchangeHandoffToken('test-custom-token');
  expect(request).toHaveBeenCalledExactlyOnceWith(
    'https://workspace-endpoint.openagents.org/v1/auth/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_token: 'test-custom-token' }),
    },
  );
  expect(loadWorkspaceSession()).toEqual(session);
});

it.each([401, 503])('preserves the backend %s rejection without switching transport', async status => {
  request.mockResolvedValue(new Response(JSON.stringify({ message: 'Please retry sign-in' }), { status }));
  await expect(exchangeHandoffToken('test-custom-token')).rejects.toThrow('Please retry sign-in');
  expect(request).toHaveBeenCalledTimes(1);
  expect(loadWorkspaceSession()).toBeNull();
});

it('does not silently route a network failure or subsequent API traffic through a proxy', async () => {
  request.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(exchangeHandoffToken('test-custom-token')).rejects.toThrow('Failed to fetch');
  expect(request).toHaveBeenCalledTimes(1);
  expect(loadWorkspaceSession()).toBeNull();
});

const held = { token: 'held-session', email: 'test@example.com', displayName: 'Test', expiresAt: Math.floor(Date.now() / 1000) + 3600 };

it('renews a held session with it as the bearer and stores the new one', async () => {
  saveWorkspaceSession(held);
  const expiresAt = new Date(Date.now() + 30 * 86400_000);
  request.mockResolvedValue(new Response(JSON.stringify({ data: {
    session_token: 'fresh-session', email: 'test@example.com', display_name: 'Test', expires_at: expiresAt.toISOString(),
  } })));
  const renewed = await renewWorkspaceSession(held);
  expect(request).toHaveBeenCalledExactlyOnceWith(
    'https://workspace-endpoint.openagents.org/v1/auth/session/renew',
    { method: 'POST', headers: { Authorization: 'Bearer held-session' } },
  );
  expect(renewed?.token).toBe('fresh-session');
  expect(loadWorkspaceSession()).toEqual(renewed);
});

it('clears the stored session when the server refuses to renew it', async () => {
  saveWorkspaceSession(held);
  request.mockResolvedValue(new Response(JSON.stringify({ message: 'Please sign in again.' }), { status: 401 }));
  expect(await renewWorkspaceSession(held)).toBeNull();
  expect(loadWorkspaceSession()).toBeNull();
});

it('keeps the stored session when renewal cannot reach the server', async () => {
  saveWorkspaceSession(held);
  request.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(renewWorkspaceSession(held)).rejects.toThrow();
  expect(loadWorkspaceSession()).toEqual(held);
});

it('asks for renewal only in the last week of a session', () => {
  const now = 1_000_000;
  expect(sessionNeedsRenewal({ ...held, expiresAt: now + 20 * 86400 }, now)).toBe(false);
  expect(sessionNeedsRenewal({ ...held, expiresAt: now + 3 * 86400 }, now)).toBe(true);
});
