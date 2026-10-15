// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workspaceApi } from '@/lib/api';
import { useBrowserControl } from './use-browser-control';
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
let root: Root, host: HTMLDivElement, state: ReturnType<typeof useBrowserControl>;
let api: ReturnType<typeof vi.spyOn>, input: ReturnType<typeof vi.spyOn>;
function Harness({ id }: { id: string }) { state = useBrowserControl(id); return null; }
const render = (id = 'tab') => act(async () => root.render(React.createElement(Harness, { id })));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  api = vi.spyOn(workspaceApi, 'controlBrowserTab').mockResolvedValue(undefined);
  input = vi.spyOn(workspaceApi, 'sendBrowserInput').mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('watches by default, claims before input, renews and hands back', async () => {
  await render();
  state.input({ kind: 'key', key: 'Enter' });
  expect(input).not.toHaveBeenCalled();
  expect(state.controlling).toBe(false);
  await act(async () => state.toggle());
  expect(state.controlling).toBe(true);
  const token = api.mock.calls[0][1];
  await act(async () => state.input({ kind: 'text', text: 'hello' }));
  expect(input).toHaveBeenCalledWith('tab', { kind: 'text', text: 'hello', token });
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(api).toHaveBeenCalledWith('tab', token, 'renew');
  await act(async () => state.toggle());
  expect(api).toHaveBeenCalledWith('tab', token, 'release');
  expect(state.controlling).toBe(false);
});
it('releases the old tab when switching, including a late claim response', async () => {
  await render();
  let resolve!: () => void;
  api.mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
  let pending!: Promise<void>;
  await act(async () => { pending = state.toggle(); });
  const token = api.mock.calls[0][1];
  await render('other');
  await act(async () => { resolve(); await pending; });
  expect(state.controlling).toBe(false);
  expect(api).toHaveBeenCalledWith('tab', token, 'release');
});
it('returns to watching if renewal fails or hangs', async () => {
  await render(); await act(async () => state.toggle());
  api.mockImplementation((_id: string, _token: string, action: string) => action === 'renew' ? new Promise(() => {}) : Promise.resolve());
  await act(async () => vi.advanceTimersByTimeAsync(55000));
  expect(state.controlling).toBe(false);
  expect(api.mock.calls.some((call: unknown[]) => call[2] === 'release')).toBe(true);
});
it('preserves gesture order and drops queued input after handing back', async () => {
  await render(); await act(async () => state.toggle());
  let resolve!: () => void;
  input.mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
  await act(async () => {
    state.input({ kind: 'click', x: 0.5, y: 0.5 });
    state.input({ kind: 'text', text: 'queued' });
  });
  expect(input).toHaveBeenCalledTimes(1);
  await act(async () => state.toggle());
  await act(async () => resolve());
  expect(input).toHaveBeenCalledTimes(1);
});
