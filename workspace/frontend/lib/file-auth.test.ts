// @vitest-environment jsdom
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

it('downloads authenticated bytes as a blob instead of navigating to a protected URL', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['word bytes']) });
  vi.stubGlobal('fetch', fetch);
  const create = vi.fn().mockReturnValue('blob:download');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.href).toBe('blob:download'); expect(this.download).toBe('report.docx');
  });
  workspaceApi.configure('workspace', '', 'viewer-token');
  await workspaceApi.downloadFile('doc', 'people/me/report.docx');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer viewer-token');
  expect(click).toHaveBeenCalledOnce(); expect(document.querySelector('a')).toBeNull();
  vi.advanceTimersByTime(60000); expect(revoke).toHaveBeenCalledWith('blob:download');
  click.mockRestore(); vi.useRealTimers();
});
