import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { toast } from 'sonner';
import CodeBlock from './CodeBlock';
jest.mock('sonner', () => ({ toast: { error: require('@jest/globals').jest.fn() } }));
jest.mock('@/utils/clipboard', () => require('../../utils/clipboard'), { virtual: true });
jest.mock('../../stores/themeStore', () => ({ useThemeStore: () => ({ theme: 'light' }) }));
jest.mock('react-syntax-highlighter', () => ({ Prism: ({ children }: any) => <pre>{children}</pre> }));
jest.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({ oneDark: {}, oneLight: {} }));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn(async (_text: string) => {}) } });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<CodeBlock code="synthetic" language="text" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); jest.useRealTimers(); });
async function click() { await act(async () => host.querySelector('button')!.click()); }
it('ignores the older success after the latest copy failed', async () => {
  let finish!: () => void;
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await click();
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockRejectedValueOnce(new Error('denied'));
  await click();
  expect(toast.error).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(host.querySelector('button')!.textContent).toBe('Copy code');
});
it('keeps the newest successful feedback for a full timeout', async () => {
  await click();
  await act(async () => { jest.advanceTimersByTime(1000); });
  await click();
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(host.querySelector('button')!.textContent).toBe('Copied!');
  await act(async () => { jest.advanceTimersByTime(1000); });
  expect(host.querySelector('button')!.textContent).toBe('Copy code');
});
it('preserves the existing ability to copy an empty code block', async () => {
  await act(async () => root.render(<CodeBlock code="" language="text" />));
  await click();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('');
  expect(host.querySelector('button')!.textContent).toBe('Copied!');
});

it('ignores a late failure after a newer success', async () => {
  let reject!: (error: Error) => void;
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => host.querySelector('button')!.click());
  await act(async () => host.querySelector('button')!.click());
  await act(async () => reject(new Error('denied')));
  expect(toast.error).not.toHaveBeenCalled();
});
it('does not show an error from a copy completing after unmount', async () => {
  let reject!: (error: Error) => void;
  (navigator.clipboard.writeText as ReturnType<typeof jest.fn>).mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  await act(async () => host.querySelector('button')!.click());
  await act(async () => root.unmount());
  await act(async () => reject(new Error('denied')));
  expect(toast.error).not.toHaveBeenCalled();
});
