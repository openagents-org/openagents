import { afterEach, expect, it, vi } from 'vitest';
import { workspaceApi } from './api';
afterEach(()=>{vi.unstubAllGlobals();workspaceApi.configure('','','');});
it('sends the signed-in member identity for private files without putting it in the URL',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal('fetch',fetch);
  workspaceApi.configure('workspace','','sam-credential');
  await workspaceApi.fetchFile('image-id');
  const [url,options]=fetch.mock.calls[0];
  expect(url).not.toContain('sam-credential');
  expect(options.headers.Authorization).toBe('Bearer sam-credential');
  expect(options.cache).toBe('no-store');
});
