import { afterEach, expect, it, vi } from 'vitest';
import { resolveWorkspaceToken } from './workspace-token';

afterEach(() => vi.unstubAllGlobals());

it('resolves a root token using the existing API without placing it in the request URL', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: { slug: 'team' } }) });
  vi.stubGlobal('fetch', fetch);
  await expect(resolveWorkspaceToken('synthetic-token')).resolves.toBe('team');
  const [url, options] = fetch.mock.calls[0];
  expect(url).toMatch(/\/v1\/token\/resolve$/);
  expect(url).not.toContain('synthetic-token');
  expect(JSON.parse(options.body)).toEqual({ token: 'synthetic-token' });
});

it('distinguishes an invalid credential from an unavailable service and rejects unsafe destinations', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  fetch.mockResolvedValue({ status: 404 });
  await expect(resolveWorkspaceToken('invalid')).rejects.toThrow('invalid');
  for (const slug of ['//other.example', '../admin', '', undefined]) {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: { slug } }) });
    await expect(resolveWorkspaceToken('synthetic')).rejects.toThrow('unavailable');
  }
});
