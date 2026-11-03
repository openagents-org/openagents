// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useCopyToClipboard } from './use-copy-to-clipboard';
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
let root: Root;
let hook: ReturnType<typeof useCopyToClipboard>;
const onCopy = vi.fn();
function Probe() { hook = useCopyToClipboard({ onCopy }); return null; }
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Probe)));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });
it('copies without the native API', async () => {
  await act(async () => { await hook.copyToClipboard('test text'); });
  expect(document.execCommand).toHaveBeenCalledWith('copy');
  expect(hook.isCopied).toBe(true); expect(onCopy).toHaveBeenCalledTimes(1);
});
it('reports failure instead of a copied state when neither capability succeeds', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
  await act(async () => { await hook.copyToClipboard('test text'); });
  expect(hook.isCopied).toBe(false); expect(onCopy).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledTimes(1);
});
it('does not acknowledge a pending native write', async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) } });
  let pending: unknown;
  await act(async () => { pending = hook.copyToClipboard('test text'); });
  expect(hook.isCopied).toBe(false); expect(onCopy).not.toHaveBeenCalled();
  await act(async () => { finish(); await pending; });
  expect(hook.isCopied).toBe(true); expect(onCopy).toHaveBeenCalledTimes(1);
});

it('clears prior success and returns false on a subsequent failure', async () => {
  await act(async () => { expect(await hook.copyToClipboard('first')).toBe(true); });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
  await act(async () => { expect(await hook.copyToClipboard('second')).toBe(false); });
  expect(hook.isCopied).toBe(false); expect(onCopy).toHaveBeenCalledTimes(1); expect(toast.error).toHaveBeenCalledTimes(1);
});
it('does not let a stale completion overwrite the latest failed attempt', async () => {
  let finish!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) } });
  let pending: unknown;
  await act(async () => { pending = hook.copyToClipboard('first'); });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
  await act(async () => { await hook.copyToClipboard('second'); });
  await act(async () => { finish(); await pending; });
  expect(hook.isCopied).toBe(false); expect(onCopy).not.toHaveBeenCalled();
});
it('keeps empty values a no-op', async () => {
  await act(async () => { expect(await hook.copyToClipboard('')).toBe(false); });
  expect(document.execCommand).not.toHaveBeenCalled(); expect(onCopy).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
});
