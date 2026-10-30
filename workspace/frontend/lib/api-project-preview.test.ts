import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./api-base', async importOriginal => ({
  ...await importOriginal<typeof import('./api-base')>(),
  getApiBaseUrl: () => '/wsapi',
}));

import { workspaceApi } from './api';

afterEach(() => vi.unstubAllGlobals());

it('authenticates ticket creation through the proxy but loads the frame directly', async () => {
  workspaceApi.configure('workspace-test', 'workspace-token', 'identity-token');
  const data = {
    id: 'project-test', revision: 'version-one', entrypoint: 'index.html',
    files: ['index.html', 'chart.svg'], can_update: false, expires_in: 3600,
    preview_path: '/v1/project-preview/scoped-ticket/index.html',
  };
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code: 0, data }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const result = await workspaceApi.previewWebProject('project-test');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('/wsapi/v1/web-projects/project-test/preview?network=workspace-test');
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer identity-token');
  expect(result).toEqual({
    ...data,
    preview_path: 'https://workspace-endpoint.openagents.org' + data.preview_path,
  });
  expect(result.preview_path).not.toContain('workspace-token');
  expect(result.preview_path).not.toContain('identity-token');
});
