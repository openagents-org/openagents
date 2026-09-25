import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  endOidcSession,
  fetchAuthConfig,
  fetchOidcSession,
} from './workspace-session';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OIDC browser session helpers', () => {
  it('loads public auth configuration with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { mode: 'oidc', oidc: { enabled: true, providerName: 'Company SSO', configurationError: null } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAuthConfig()).resolves.toMatchObject({ mode: 'oidc' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/auth/config'), expect.objectContaining({ credentials: 'include' }));
  });

  it('aborts a stalled auth-config request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchAuthConfig();
    const rejection = expect(request).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/config'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('restores public session metadata without exposing the bearer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {
        expires_at: '2026-09-24T12:00:00+00:00',
        email: 'user@example.test',
        display_name: 'User',
      } }),
    }));

    await expect(fetchOidcSession()).resolves.toMatchObject({ email: 'user@example.test' });
    await expect(fetchOidcSession()).resolves.not.toHaveProperty('token');
  });

  it('treats a missing OIDC session as signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) }));
    await expect(fetchOidcSession()).resolves.toBeNull();
  });

  it('propagates a failed OIDC logout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'logout unavailable' }),
    }));

    await expect(endOidcSession()).rejects.toThrow('logout unavailable');
  });

  it('returns the provider logout URL when supplied', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { logoutUrl: 'https://issuer.example/logout' } }),
    }));
    await expect(endOidcSession()).resolves.toBe('https://issuer.example/logout');
  });
});
