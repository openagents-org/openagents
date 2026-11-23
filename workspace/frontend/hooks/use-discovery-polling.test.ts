// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDiscoveryPolling } from './use-discovery-polling';

let root: Root;
let enabled = false;
let active = { current: false };
let refresh = vi.fn<(opts?: { panels?: boolean }) => Promise<void>>();
let live = { current: false };
function Harness() {
  useDiscoveryPolling(refresh, enabled, active, live);
  return null;
}
const render = () => act(async () => root.render(createElement(Harness)));
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  enabled = false;
  active = { current: false };
  live = { current: false };
  refresh = vi.fn().mockResolvedValue(undefined);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

it('does no unread refresh during startup, then refreshes in the background', async () => {
  await render();
  await advance(30_000);
  expect(refresh).not.toHaveBeenCalled();
  enabled = true;
  await render();
  await advance(4_999);
  expect(refresh).not.toHaveBeenCalled();
  await advance(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  await advance(15_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('does not overlap slow refreshes and uses the active interval afterward', async () => {
  let finish!: () => void;
  refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  enabled = true;
  active.current = true;
  await render();
  await advance(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await advance(5_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('does not restart an old polling loop when an in-flight refresh finishes', async () => {
  let finish!: () => void;
  refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  enabled = true;
  await render();
  await advance(5_000);
  enabled = false;
  await render();
  await act(async () => finish());
  await advance(60_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('retries a failed refresh without blocking the workspace', async () => {
  refresh.mockRejectedValueOnce(new Error('unavailable'));
  enabled = true;
  await render();
  await advance(20_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});


it('becomes a slow safety refresh while the live stream is connected', async () => {
  enabled = true;
  active.current = true;
  live.current = true;
  await render();
  await advance(5_000);
  expect(refresh).toHaveBeenLastCalledWith({ panels: false });
  await advance(29_999);
  expect(refresh).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  await advance(60_000);
  // every 4th live tick also refreshes the side panels
  expect(refresh).toHaveBeenLastCalledWith({ panels: true });
  live.current = false;
  await advance(30_000);
  expect(refresh).toHaveBeenLastCalledWith();
  const calls = refresh.mock.calls.length;
  await advance(5_000);
  expect(refresh.mock.calls.length).toBe(calls + 1);
});
