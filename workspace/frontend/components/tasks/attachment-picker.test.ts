// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AttachmentPicker } from './new-task-dialog';
const upload = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ workspaceApi: { uploadFile: upload } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ files: [] }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/files/authenticated-image', () => ({ AuthenticatedImage: () => null }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  upload.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function drag(type: string, files: File[] = [], types = ['Files']) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types, dropEffect: 'none' } });
  return event;
}
it('highlights file drags and uploads multiple dropped files through the existing pipeline', async () => {
  const changed = vi.fn();
  const uploading = vi.fn();
  upload.mockImplementation(async (file: File) => ({ id: file.name, filename: file.name, contentType: file.type }));
  function Picker() {
    const [value, setValue] = useState<string[]>(['existing']);
    return createElement(AttachmentPicker, { value, onChange: ids => { changed(ids); setValue(ids); }, onUploadingChange: uploading });
  }
  await act(async () => root.render(createElement(Picker)));
  const zone = host.firstElementChild!;
  await act(async () => { zone.dispatchEvent(drag('dragenter')); });
  expect(host.textContent).toContain('tasks.attachDrop');
  const files = [new File(['a'], 'a.txt', { type: 'text/plain' }), new File(['b'], 'b.md', { type: 'text/markdown' })];
  const drop = drag('drop', files);
  await act(async () => { zone.dispatchEvent(drop); });
  expect(drop.defaultPrevented).toBe(true);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(changed).toHaveBeenCalledWith(['existing', 'a.txt', 'b.md']);
  expect(uploading.mock.calls.map(call => call[0])).toEqual([true, false]);
  expect(host.textContent).toContain('a.txt');
  expect(host.textContent).not.toContain('tasks.attachDrop');
});
it('ignores text drags and prevents file navigation without uploading when disabled', async () => {
  await act(async () => root.render(createElement(AttachmentPicker, { value: [], onChange: vi.fn(), disabled: true })));
  const zone = host.firstElementChild!;
  const text = drag('dragover', [], ['text/plain']);
  zone.dispatchEvent(text);
  expect(text.defaultPrevented).toBe(false);
  const drop = drag('drop', [new File(['x'], 'x.txt')]);
  await act(async () => { zone.dispatchEvent(drop); });
  expect(drop.defaultPrevented).toBe(true);
  expect(upload).not.toHaveBeenCalled();
});
it('rejects a second drop during upload and retains successful files if another fails', async () => {
  let resolve!: (value: unknown) => void;
  upload.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockRejectedValueOnce(new Error('failed'));
  const onChange = vi.fn();
  await act(async () => root.render(createElement(AttachmentPicker, { value: [], onChange })));
  const zone = host.firstElementChild!;
  await act(async () => { zone.dispatchEvent(drag('drop', [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')])); });
  await act(async () => { zone.dispatchEvent(drag('drop', [new File(['c'], 'c.txt')])); });
  expect(upload).toHaveBeenCalledTimes(2);
  await act(async () => { resolve({ id: 'a', filename: 'a.txt', contentType: 'text/plain' }); });
  expect(onChange).toHaveBeenCalledWith(['a']);
  expect(host.textContent).toContain('tasks.attachFailed');
});
