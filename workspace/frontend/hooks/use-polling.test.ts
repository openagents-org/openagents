// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ dm: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: { pollConversation: h.dm } }));
import { useMessagePolling } from './use-polling';

const SESSION = 'dm:human:me@example.com,openagents:bot';
function Probe() { useMessagePolling({ sessionId: SESSION }); return null; }
let root: Root;
const empty = { events: [], has_more: false };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  h.dm.mockReset();
  h.dm.mockResolvedValue(empty);
  root = createRoot(document.createElement('div'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('stops a poll loop whose request was in flight during cleanup', async () => {
  await act(async () => root.render(React.createElement(Probe)));
  let resolve!: (r: typeof empty) => void;
  h.dm.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await act(async () => { vi.advanceTimersByTime(2_000); });   // timer fired, poll pending
  const before = h.dm.mock.calls.length;
  await act(async () => root.unmount());
  await act(async () => { resolve(empty); });
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(h.dm.mock.calls.length).toBe(before);
});

it('does not leave the old loop running when a refocus restarts polling', async () => {
  await act(async () => root.render(React.createElement(Probe)));
  let resolve!: (r: typeof empty) => void;
  h.dm.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await act(async () => { vi.advanceTimersByTime(2_000); });   // loop's poll in flight
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await act(async () => { resolve(empty); });
  const start = h.dm.mock.calls.length;
  await act(async () => { vi.advanceTimersByTime(2_000); });
  expect(h.dm.mock.calls.length - start).toBe(1);   // a leaked loop would poll here too
  await act(async () => root.unmount());
});
