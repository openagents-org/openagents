import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { useCopyToClipboard } from './use-copy-to-clipboard';
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
let root: Root;
let hook: ReturnType<typeof useCopyToClipboard>;
const onCopy = jest.fn();
function Probe() { hook = useCopyToClipboard({ onCopy }); return null; }
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: jest.fn(() => true) });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Probe)));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; jest.restoreAllMocks(); });
it('copies without the native API', async () => {
  await act(async () => { await hook.copyToClipboard('test text'); });
  expect(document.execCommand).toHaveBeenCalledWith('copy');
  expect(hook.isCopied).toBe(true); expect(onCopy).toHaveBeenCalledTimes(1);
});
it('reports failure instead of a copied state when neither capability succeeds', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: jest.fn(() => false) });
  await act(async () => { await hook.copyToClipboard('test text'); });
  expect(hook.isCopied).toBe(false); expect(onCopy).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledTimes(1);
});
it('does not acknowledge a pending native write', async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn(() => new Promise<void>(resolve => { finish = resolve; })) } });
  let pending: unknown;
  await act(async () => { pending = hook.copyToClipboard('test text'); });
  expect(hook.isCopied).toBe(false); expect(onCopy).not.toHaveBeenCalled();
  await act(async () => { finish(); await pending; });
  expect(hook.isCopied).toBe(true); expect(onCopy).toHaveBeenCalledTimes(1);
});

it('clears prior success and returns false on a subsequent failure', async () => {
  await act(async () => { expect(await hook.copyToClipboard('first')).toBe(true); });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: jest.fn(() => false) });
  await act(async () => { expect(await hook.copyToClipboard('second')).toBe(false); });
  expect(hook.isCopied).toBe(false); expect(onCopy).toHaveBeenCalledTimes(1); expect(toast.error).toHaveBeenCalledTimes(1);
});
it('does not let a stale completion overwrite the latest failed attempt', async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn(() => new Promise<void>(resolve => { finish = resolve; })) } });
  let pending: unknown;
  await act(async () => { pending = hook.copyToClipboard('first'); });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: jest.fn(() => false) });
  await act(async () => { await hook.copyToClipboard('second'); });
  await act(async () => { finish(); await pending; });
  expect(hook.isCopied).toBe(false); expect(onCopy).not.toHaveBeenCalled();
});
it('keeps empty values a no-op', async () => {
  await act(async () => { expect(await hook.copyToClipboard('')).toBe(false); });
  expect(document.execCommand).not.toHaveBeenCalled(); expect(onCopy).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
});

it('copies whitespace without trimming or treating it as empty', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await act(async () => { expect(await hook.copyToClipboard(' \t\n')).toBe(true); });
  expect(writeText).toHaveBeenCalledWith(' \t\n');
  expect(hook.isCopied).toBe(true);
});
it('propagates an onCopy consumer error without misreporting clipboard failure', async () => {
  const consumerError = new Error('synthetic consumer error');
  onCopy.mockImplementationOnce(() => { throw consumerError; });
  await act(async () => { await expect(hook.copyToClipboard('synthetic')).rejects.toBe(consumerError); });
  expect(hook.isCopied).toBe(true);
  expect(toast.error).not.toHaveBeenCalled();
});
