import { afterEach, expect, it, vi } from 'vitest';
import { workspaceApi } from './api';

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('shares a hover preload with selection and reuses the result on reopening', async () => {
  let resolve!: (response: Response) => void;
  const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>((r) => { resolve = r; }));
  vi.stubGlobal('fetch', fetchMock);
  const preload = workspaceApi.getAgentCatalogDetail('cache-sharing-test');
  const selected = workspaceApi.getAgentCatalogDetail('cache-sharing-test');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  resolve(ok({ name: 'cache-sharing-test' }));
  await expect(preload).resolves.toEqual({ name: 'cache-sharing-test' });
  await expect(selected).resolves.toEqual({ name: 'cache-sharing-test' });
  await workspaceApi.getAgentCatalogDetail('cache-sharing-test');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('evicts failed requests so Try again makes a fresh attempt', async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Timeout')).mockResolvedValueOnce(ok({ name: 'retry-test' }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(workspaceApi.getAgentCatalogDetail('retry-test')).rejects.toThrow('Timeout');
  await expect(workspaceApi.getAgentCatalogDetail('retry-test')).resolves.toEqual({ name: 'retry-test' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('refreshes cached metadata after one minute', async () => {
  const now = Date.now();
  const date = vi.spyOn(Date, 'now').mockReturnValue(now);
  const fetchMock = vi.fn().mockResolvedValue(ok({ name: 'expiry-test' }));
  vi.stubGlobal('fetch', fetchMock);
  await workspaceApi.getAgentCatalogDetail('expiry-test');
  date.mockReturnValue(now + 60_001);
  fetchMock.mockResolvedValueOnce(ok({ name: 'expiry-test', protocol: 'anthropic' }));
  await expect(workspaceApi.getAgentCatalogDetail('expiry-test')).resolves.toMatchObject({ protocol: 'anthropic' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
