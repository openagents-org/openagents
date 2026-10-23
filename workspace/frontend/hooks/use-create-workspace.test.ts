// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CREATE_SLOW_MS, CREATE_UNCONFIRMED_MS, useCreateWorkspace } from './use-create-workspace';

type Ws = { slug: string };
let root: Root;
let result: ReturnType<typeof useCreateWorkspace<Ws>>;

function Harness({ create, open }: { create: (name: string) => Promise<Ws>; open: (ws: Ws) => void }) {
  result = useCreateWorkspace({ create, open });
  return null;
}
async function render(create: (name: string) => Promise<Ws>, open: (ws: Ws) => void) {
  await act(async () => { root.render(React.createElement(Harness, { create, open })); });
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

it('creates once and opens the returned workspace', async () => {
  const create = vi.fn().mockResolvedValue({ slug: 'acme' });
  const open = vi.fn();
  await render(create, open);
  await act(async () => { await result.submit('Acme'); });
  expect(result.phase).toBe('opening');
  expect(open).toHaveBeenCalledWith({ slug: 'acme' });
});

it('ignores a second submit while the first is in flight', async () => {
  let resolve!: (ws: Ws) => void;
  const create = vi.fn(() => new Promise<Ws>((r) => { resolve = r; }));
  await render(create, vi.fn());
  await act(async () => { void result.submit('Acme'); void result.submit('Acme'); });
  expect(create).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ slug: 'acme' }); });
});

it('says a slow create is slow, then that its outcome is not confirmed, without retrying', async () => {
  const create = vi.fn(() => new Promise<Ws>(() => {}));
  await render(create, vi.fn());
  await act(async () => { void result.submit('Acme'); });
  expect(result.phase).toBe('creating');
  await wait(CREATE_SLOW_MS);
  expect(result.phase).toBe('slow');
  await wait(CREATE_UNCONFIRMED_MS - CREATE_SLOW_MS);
  expect(result.phase).toBe('unconfirmed');
  expect(result.pending).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
});

it('reopening a created workspace navigates again and never creates again', async () => {
  const create = vi.fn().mockResolvedValue({ slug: 'acme' });
  const open = vi.fn();
  await render(create, open);
  await act(async () => { await result.submit('Acme'); });
  await act(async () => { result.reopen(); });
  expect(open).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(1);
});

it('keeps a failure as its own phase and allows another try', async () => {
  const create = vi.fn().mockRejectedValueOnce(new Error('API 500')).mockResolvedValueOnce({ slug: 'acme' });
  const open = vi.fn();
  await render(create, open);
  await act(async () => { await result.submit('Acme'); });
  expect(result.phase).toBe('failed');
  expect(result.pending).toBe(false);
  await act(async () => { await result.submit('Acme'); });
  expect(result.phase).toBe('opening');
});

it('does not navigate when the page was left before the create answered', async () => {
  let resolve!: (ws: Ws) => void;
  const create = vi.fn(() => new Promise<Ws>((r) => { resolve = r; }));
  const open = vi.fn();
  await render(create, open);
  await act(async () => { void result.submit('Acme'); });
  await act(async () => root.unmount());
  await act(async () => { resolve({ slug: 'acme' }); });
  expect(open).not.toHaveBeenCalled();
  root = createRoot(document.createElement('div'));
});
