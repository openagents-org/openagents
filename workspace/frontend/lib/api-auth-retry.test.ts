import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, workspaceApi } from './api';

/**
 * Since Workspace v1.1 the backend rejects a write that carries an identity it
 * cannot verify (usually an expired Firebase token) instead of falling back to
 * the workspace token. The client refreshes the identity once and retries.
 */

const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
const guard401 = () =>
  new Response(JSON.stringify({ code: 401, message: 'rejected by guard', data: null }), { status: 401 });

function setup(bearer = 'stale-token') {
  workspaceApi.configure('ws-1', 'ws-token', bearer);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  workspaceApi.setBearerRefresher(null);
});

const authOf = (call: unknown[]) =>
  ((call[1] as RequestInit).headers as Record<string, string>).Authorization;

describe('WorkspaceApi 401 handling', () => {
  it('refreshes an expired identity once and retries with the new token', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(guard401()).mockResolvedValueOnce(ok({ id: 'ws-1' }));
    const refresher = vi.fn().mockResolvedValue('fresh-token');
    workspaceApi.setBearerRefresher(refresher);

    await expect(workspaceApi.getWorkspace()).resolves.toEqual({ id: 'ws-1' });

    expect(refresher).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(fetchMock.mock.calls[0])).toBe('Bearer stale-token');
    expect(authOf(fetchMock.mock.calls[1])).toBe('Bearer fresh-token');
  });

  it('treats a second 401 as a real denial and surfaces it as ApiError', async () => {
    const fetchMock = setup();
    fetchMock.mockImplementation(async () => guard401());
    workspaceApi.setBearerRefresher(vi.fn().mockResolvedValue('fresh-token'));

    const err = await workspaceApi.getWorkspace().catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.serverMessage).toBe('rejected by guard');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry when no fresh token can be minted', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValue(guard401());
    workspaceApi.setBearerRefresher(vi.fn().mockResolvedValue(null));

    await expect(workspaceApi.getWorkspace()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh token-only (machine) requests', async () => {
    const fetchMock = setup('');
    fetchMock.mockResolvedValue(guard401());
    const refresher = vi.fn().mockResolvedValue('fresh-token');
    workspaceApi.setBearerRefresher(refresher);

    await expect(workspaceApi.getWorkspace()).rejects.toBeInstanceOf(ApiError);
    expect(refresher).not.toHaveBeenCalled();
  });

  it('shares one refresh between requests that fail together', async () => {
    const fetchMock = setup();
    let calls = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      calls++;
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer fresh-token' ? ok({ id: 'ws-1' }) : guard401();
    });
    let resolveRefresh: (t: string) => void = () => {};
    const refresher = vi.fn(() => new Promise<string>((r) => { resolveRefresh = r; }));
    workspaceApi.setBearerRefresher(refresher);

    const both = Promise.all([workspaceApi.getWorkspace(), workspaceApi.getWorkspace()]);
    await new Promise((r) => setTimeout(r, 0));
    resolveRefresh('fresh-token');

    await expect(both).resolves.toEqual([{ id: 'ws-1' }, { id: 'ws-1' }]);
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(calls).toBe(4);
  });
});
