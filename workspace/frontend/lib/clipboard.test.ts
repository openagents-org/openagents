// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
function native(value: unknown) { Object.defineProperty(navigator, 'clipboard', { configurable: true, value }); }
function command(fn: unknown) { Object.defineProperty(document, 'execCommand', { configurable: true, value: fn }); }
beforeEach(() => { native(undefined); command(vi.fn(() => true)); });
afterEach(() => {
  document.body.innerHTML = '';
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else delete (navigator as any).clipboard;
  if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
  else delete (document as any).execCommand;
});
it('uses the native receiver and exact text without touching the DOM', async () => {
  const clipboard = { writeText: vi.fn(function(this: unknown, text: string) { expect(this).toBe(clipboard); expect(text).toBe('你好\n🌍'); return Promise.resolve(); }) };
  native(clipboard);
  await copyTextToClipboard('你好\n🌍');
  expect(document.execCommand).not.toHaveBeenCalled();
  expect(document.querySelector('textarea')).toBeNull();
});
it.each([undefined, {}, { writeText: true }])('falls back when writeText is not callable: %j', async value => {
  native(value);
  await copyTextToClipboard('test text');
  expect(document.execCommand).toHaveBeenCalledWith('copy');
});
it.each(['reject', 'throw', 'getter'])('falls back after a native %s', async kind => {
  const denied = new Error('permission denied');
  if (kind === 'getter') Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => { throw denied; } });
  else native({ writeText: vi.fn(() => { if (kind === 'throw') throw denied; return Promise.reject(denied); }) });
  await copyTextToClipboard('test text');
  expect(document.execCommand).toHaveBeenCalledWith('copy');
});
it('makes a readonly explicit selection, preserves an input selection and removes the temporary element', async () => {
  const input = document.createElement('input'); input.value = 'original input'; document.body.append(input); input.focus(); input.setSelectionRange(1, 5, 'backward');
  const rangeSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'setSelectionRange');
  command(vi.fn(() => {
    const area = document.activeElement as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA'); expect(area.readOnly).toBe(true);
    expect(area.value).toBe('你好\n🌍'); expect(area.selectionStart).toBe(0); expect(area.selectionEnd).toBe(5);
    return true;
  }));
  await copyTextToClipboard('你好\n🌍');
  expect(rangeSpy).toHaveBeenCalledWith(0, 5);
  expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(5); expect(input.selectionDirection).toBe('backward');
  expect(document.querySelector('textarea')).toBeNull();
});
it('restores a document selection and stays inside a dialog focus boundary', async () => {
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  const button = document.createElement('button'); const content = document.createTextNode('original selection'); dialog.append(button, content); document.body.append(dialog); button.focus();
  const range = document.createRange(); range.setStart(content, 1); range.setEnd(content, 8); document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
  expect(document.getSelection()!.toString()).toBe('riginal');
  command(vi.fn(() => { expect(dialog.contains(document.activeElement)).toBe(true); document.getSelection()!.removeAllRanges(); return true; }));
  await copyTextToClipboard('test text');
  expect(document.activeElement).toBe(button); expect(document.getSelection()!.toString()).toBe('riginal'); expect(dialog.querySelector('textarea')).toBeNull();
});
it.each(['false', 'throw', 'select'])('rejects and cleans up when fallback fails: %s', async kind => {
  const button = document.createElement('button'); document.body.append(button); button.focus();
  command(vi.fn(() => { if (kind === 'throw') throw new Error('denied'); return false; }));
  if (kind === 'select') vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => { throw new Error('selection failed'); });
  await expect(copyTextToClipboard('test text')).rejects.toThrow('Failed to copy text');
  expect(document.querySelector('textarea')).toBeNull(); expect(document.activeElement).toBe(button);
});
it('retains the native error as the cause if both methods fail', async () => {
  const denied = new Error('denied'); native({ writeText: vi.fn(() => Promise.reject(denied)) }); command(vi.fn(() => false));
  await expect(copyTextToClipboard('test text')).rejects.toMatchObject({ cause: denied });
});
it('rejects cleanly without execCommand', async () => {
  command(undefined);
  await expect(copyTextToClipboard('test text')).rejects.toThrow('Failed to copy text');
  expect(document.querySelector('textarea')).toBeNull();
});
it('can copy an empty string', async () => {
  await copyTextToClipboard(''); expect(document.execCommand).toHaveBeenCalledWith('copy');
});
it('rejects in SSR without a ReferenceError', async () => {
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!;
  const doc = Object.getOwnPropertyDescriptor(globalThis, 'document')!;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
  try { await expect(copyTextToClipboard('test text')).rejects.toThrow('Failed to copy text to clipboard'); }
  finally { Object.defineProperty(globalThis, 'navigator', nav); Object.defineProperty(globalThis, 'document', doc); }
});

it('restores input selection after the document selection changes it (Chromium)', async () => {
  const input = document.createElement('input'); input.value = 'original input'; document.body.append(input); input.focus(); input.setSelectionRange(1, 5, 'backward');
  const selection = document.getSelection()!;
  const range = document.createRange(); range.selectNodeContents(document.body);
  selection.removeAllRanges(); selection.addRange(range);
  const addRange = selection.addRange.bind(selection);
  vi.spyOn(selection, 'addRange').mockImplementation(range => { addRange(range); input.setSelectionRange(0, 0); });
  await copyTextToClipboard('test text');
  expect(input.selectionStart).toBe(1); expect(input.selectionEnd).toBe(5); expect(input.selectionDirection).toBe('backward');
});
