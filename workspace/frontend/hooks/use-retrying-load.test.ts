// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RETRY_DELAYS_MS, useRetryingLoad } from './use-retrying-load';

let root: Root;
let result: ReturnType<typeof useRetryingLoad<string[]>>;
const EMPTY: string[] = [];

function Harness({ load }: { load: () => Promise<string[]> }) {
  result = useRetryingLoad(load, EMPTY);
  return null;
}
async function render(load: () => Promise<string[]>) {
  await act(async () => { root.render(React.createElement(Harness, { load })); });
}
async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('loads once and reports ready', async () => {
  const load = vi.fn().mockResolvedValue(['claude', 'codex']);
  await render(load);
  expect(result.status).toBe('ready');
  expect(result.data).toEqual(['claude', 'codex']);
  expect(load).toHaveBeenCalledTimes(1);
});

// The Connect Agent gallery stayed empty after one failed request until the
// view was reopened. A transient failure now heals on its own.
it('retries a failed load and recovers without the user doing anything', async () => {
  const load = vi.fn()
    .mockRejectedValueOnce(new Error('API 503'))
    .mockResolvedValueOnce(['claude']);
  await render(load);
  expect(result.status).toBe('loading');
  expect(result.failures).toBe(1);
  await wait(RETRY_DELAYS_MS[0]);
  expect(result.status).toBe('ready');
  expect(result.data).toEqual(['claude']);
});

it('reports an error after the last retry, and loads again on retry()', async () => {
  const load = vi.fn().mockRejectedValue(new Error('API 503'));
  await render(load);
  for (const delay of RETRY_DELAYS_MS) await wait(delay);
  expect(result.status).toBe('error');
  expect(load).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  expect(result.data).toBe(EMPTY);

  load.mockResolvedValueOnce(['codex']);
  await act(async () => result.retry());
  expect(result.status).toBe('ready');
  expect(result.data).toEqual(['codex']);
});

it('stops retrying once unmounted', async () => {
  const load = vi.fn().mockRejectedValue(new Error('offline'));
  await render(load);
  await act(async () => root.unmount());
  await wait(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0));
  expect(load).toHaveBeenCalledTimes(1);
  root = createRoot(document.createElement('div'));
});
