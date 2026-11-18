import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceApi } from './api';

class UploadRequest {
  static last: UploadRequest;
  url = '';
  body!: FormData;
  status = 200;
  responseText = '';
  upload = { onprogress: null as null | ((e: unknown) => void) };
  onload!: () => void;
  onabort!: () => void;
  headers: Record<string, string> = {};
  open(_method: string, url: string) { this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body: FormData) { this.body = body; UploadRequest.last = this; }
  abort() { this.onabort(); }
  finish(data: unknown) { this.responseText = JSON.stringify({ data }); this.onload(); }
}

function setup() {
  vi.stubGlobal('XMLHttpRequest', UploadRequest);
  workspaceApi.configure('demo', 'workspace-token', 'identity-token');
  return new File(['sample'], 'report.txt', { type: 'text/plain' });
}
const record = { id: 'file-1', filename: 'report.txt', content_type: 'text/plain', size: 6 };
afterEach(() => vi.unstubAllGlobals());

describe('file upload destinations', () => {
  it('uploads to the workspace root without the legacy personal-folder rewrite', async () => {
    const promise = workspaceApi.uploadFile(setup(), undefined, { folder: '' });
    const xhr = UploadRequest.last;
    expect(xhr.url).toMatch(/\/v1\/files\/upload$/);
    expect(xhr.body.get('path')).toBe('');
    expect((xhr.body.get('files') as File).name).toBe('report.txt');
    expect(xhr.body.get('on_conflict')).toBe('rename');
    expect(xhr.headers.Authorization).toBe('Bearer identity-token');
    xhr.finish({ files: [record], skipped: [] });
    await expect(promise).resolves.toMatchObject({ id: 'file-1', filename: 'report.txt' });
  });

  it('passes the explicit folder while preserving the basename', async () => {
    setup();
    const promise = workspaceApi.uploadFile(new File(['x'], 'Design/report.txt'), undefined, { folder: 'Design' });
    const xhr = UploadRequest.last;
    expect(xhr.body.get('path')).toBe('Design');
    expect((xhr.body.get('files') as File).name).toBe('report.txt');
    xhr.finish({ files: [{ ...record, filename: 'Design/report (2).txt' }] });
    await expect(promise).resolves.toMatchObject({ filename: 'Design/report (2).txt' });
  });

  it('keeps existing chat attachments on their original upload contract', async () => {
    const promise = workspaceApi.uploadFile(setup(), 'thread');
    const xhr = UploadRequest.last;
    expect(xhr.url).toMatch(/\/v1\/files$/);
    expect(xhr.body.get('file')).toBeInstanceOf(File);
    expect(xhr.body.get('channel_name')).toBe('thread');
    xhr.finish(record);
    await expect(promise).resolves.toMatchObject({ id: 'file-1' });
  });

  it('surfaces skipped uploads instead of treating an empty result as success', async () => {
    const promise = workspaceApi.uploadFile(setup(), undefined, { folder: '' });
    UploadRequest.last.finish({ files: [], skipped: [{ reason: 'too_large', detail: 'File is too large' }] });
    await expect(promise).rejects.toThrow('File is too large');
  });
});
