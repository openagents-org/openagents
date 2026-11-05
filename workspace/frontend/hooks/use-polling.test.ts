// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ dm: vi.fn(), history: vi.fn(), poll: vi.fn(), sse: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: {
  pollConversation: h.dm, loadMessageHistory: h.history, pollMessages: h.poll, getSSEUrl: h.sse,
} }));
import { useMessagePolling } from './use-polling';

const SESSION = 'dm:human:me@example.com,openagents:bot';
function Probe() { useMessagePolling({ sessionId: SESSION }); return null; }
function Channel() { useMessagePolling({ sessionId: 'thread' }); return null; }
class FakeSource {
  static instances: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { FakeSource.instances.push(this); }
}
let root: Root;
const empty = { events: [], has_more: false };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  h.dm.mockReset();
  h.dm.mockResolvedValue(empty);
  h.history.mockReset().mockResolvedValue(empty);
  h.poll.mockReset().mockResolvedValue({ messages: [], hasMore: false });
  h.sse.mockReset().mockReturnValue('https://api.example/v1/events/stream?access_token=first');
  FakeSource.instances = [];
  vi.stubGlobal('EventSource', FakeSource);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(Math, 'random').mockReturnValue(0);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

it('reconnects after a stream error with fresh auth and stops fallback polling', async () => {
  await act(async () => root.render(React.createElement(Channel)));
  const source = FakeSource.instances[0];
  await act(async () => source.onopen?.());
  await act(async () => { source.onerror?.(); source.onerror?.(); });
  expect(source.close).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(h.poll).toHaveBeenCalledTimes(2);
  h.sse.mockReturnValue('https://api.example/v1/events/stream?access_token=refreshed');
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(FakeSource.instances).toHaveLength(2);
  expect(FakeSource.instances[1].url).toContain('access_token=refreshed');
  await act(async () => FakeSource.instances[1].onopen?.());
  const count = h.poll.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(h.poll).toHaveBeenCalledTimes(count);
});

it('does not restart an in-flight fallback loop when the stream recovers', async () => {
  await act(async () => root.render(React.createElement(Channel)));
  await act(async () => FakeSource.instances[0].onerror?.());
  let resolve!: (r: { messages: []; hasMore: false }) => void;
  h.poll.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  await act(async () => FakeSource.instances[1].onopen?.());
  await act(async () => resolve({ messages: [], hasMore: false }));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(h.poll).toHaveBeenCalledTimes(1);
});

it('backfills from the known cursor on reconnect because SSE does not replay', async () => {
  h.history.mockResolvedValue({ events: [{
    id: 'before-disconnect', source: 'human:test', target: 'channel/thread',
    type: 'workspace.message.posted', timestamp: Date.now(), payload: { content: 'Hello' },
  }], has_more: false });
  await act(async () => root.render(React.createElement(Channel)));
  await act(async () => FakeSource.instances[0].onopen?.());
  await act(async () => FakeSource.instances[0].onerror?.());
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  h.poll.mockClear();
  await act(async () => FakeSource.instances[1].onopen?.());
  expect(h.poll).toHaveBeenCalledExactlyOnceWith('thread', 'before-disconnect');
});

it('uses a deadline and bounded backoff when streaming cannot connect', async () => {
  await act(async () => root.render(React.createElement(Channel)));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(FakeSource.instances[0].close).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(FakeSource.instances).toHaveLength(2);
  await act(async () => FakeSource.instances[1].onerror?.());
  await act(async () => vi.advanceTimersByTimeAsync(9_999));
  expect(FakeSource.instances).toHaveLength(2);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(FakeSource.instances).toHaveLength(3);
  await act(async () => root.unmount());
  const polls = h.poll.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(FakeSource.instances).toHaveLength(3);
  expect(h.poll).toHaveBeenCalledTimes(polls);
});

it('pauses streams and retries in hidden tabs and resumes when visible', async () => {
  await act(async () => root.render(React.createElement(Channel)));
  await act(async () => FakeSource.instances[0].onerror?.());
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  const count = h.poll.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(FakeSource.instances).toHaveLength(1);
  expect(h.poll).toHaveBeenCalledTimes(count);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(FakeSource.instances).toHaveLength(2);
  expect(h.poll.mock.calls.length).toBeGreaterThan(count);
});

it('pauses DM polling while hidden and does not overlap a pending poll on refocus', async () => {
  await act(async () => root.render(React.createElement(Probe)));
  let resolve!: (r: typeof empty) => void;
  h.dm.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  const count = h.dm.mock.calls.length;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(h.dm).toHaveBeenCalledTimes(count);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(h.dm).toHaveBeenCalledTimes(count);
  await act(async () => resolve(empty));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(h.dm).toHaveBeenCalledTimes(count + 1);
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
