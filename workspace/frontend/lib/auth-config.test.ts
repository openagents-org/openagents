import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAuthConfig, needsAuthConfig, parseAuthConfig, resetAuthConfigCache, resolveAuthMode,
  type AuthConfig,
} from './auth-config';

const local: AuthConfig = { localAuth: true, signupOpen: true, emailEnabled: false, providers: ['password'] };
const hostedCfg: AuthConfig = { localAuth: false, signupOpen: false, emailEnabled: true, providers: [] };

afterEach(() => { vi.unstubAllGlobals(); resetAuthConfigCache(); });

describe('resolveAuthMode', () => {
  it.each([
    // hostname, firstParty, desktop, config, expected
    ['workspace.openagents.org', true, false, null, 'hosted'],
    // Production stays hosted even if a backend ever claimed local auth.
    ['workspace.openagents.org', true, false, local, 'hosted'],
    ['workspace-preview.openagents.org', true, false, local, 'hosted'],
    ['localhost', true, false, null, 'hosted'],
    ['localhost', true, false, hostedCfg, 'hosted'],
    ['localhost', true, false, local, 'local'],
    ['team.example.com', false, false, null, 'none'],
    ['team.example.com', false, false, hostedCfg, 'none'],
    ['team.example.com', false, false, local, 'local'],
    // The desktop launcher owns its session.
    ['workspace', true, true, local, 'hosted'],
  ] as const)('%s (firstParty=%s desktop=%s) -> %s', (hostname, firstParty, desktop, config, expected) => {
    expect(resolveAuthMode({ hostname, firstParty, desktop, config })).toBe(expected);
  });

  it('skips the config call on production hosts and in the desktop app', () => {
    expect(needsAuthConfig('workspace.openagents.org', false)).toBe(false);
    expect(needsAuthConfig('workspace-preview.openagents.org', false)).toBe(false);
    expect(needsAuthConfig('workspace', true)).toBe(false);
    expect(needsAuthConfig('team.example.com', false)).toBe(true);
    expect(needsAuthConfig('localhost', false)).toBe(true);
  });
});

describe('parseAuthConfig', () => {
  it('reads the backend envelope', () => {
    expect(parseAuthConfig({ data: { local_auth: true, signup_open: false, email_enabled: true, providers: ['password', 3] } }))
      .toEqual({ localAuth: true, signupOpen: false, emailEnabled: true, providers: ['password'] });
  });
  it('treats anything but true as false and rejects a missing envelope', () => {
    expect(parseAuthConfig({ data: { local_auth: 'yes' } })?.localAuth).toBe(false);
    expect(parseAuthConfig(null)).toBeNull();
    expect(parseAuthConfig({ code: 0 })).toBeNull();
  });
});

describe('fetchAuthConfig', () => {
  it('fetches once and caches the answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { local_auth: true, signup_open: true, email_enabled: false, providers: [] } })));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([fetchAuthConfig(), fetchAuthConfig()]);
    expect(await fetchAuthConfig()).toBe(a);
    expect(a).toBe(b);
    expect(a?.localAuth).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/v1\/auth\/config$/);
  });
  it.each([
    ['a 404 from an older backend', () => Promise.resolve(new Response('not found', { status: 404 }))],
    ['a network error', () => Promise.reject(new TypeError('failed to fetch'))],
    ['a non-JSON body', () => Promise.resolve(new Response('<html>', { status: 200 }))],
  ])('resolves null (hosted behaviour) on %s', async (_label, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl));
    expect(await fetchAuthConfig()).toBeNull();
  });
});
