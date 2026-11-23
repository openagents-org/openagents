import { describe, expect, it, vi } from 'vitest';
import { LiveStream, type LiveState } from './live-stream';

function sseResponse(chunks: string[], status = 200, type = 'text/event-stream') {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': type } });
}

const request = () => ({ url: 'https://api.test/v1/events/live?network=w', headers: { 'X-Workspace-Token': 't' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LiveStream', () => {
  it('delivers events, wake topics and resyncs, then reconnects after a normal end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const fetchImpl = vi.fn(async () => sseResponse([
      ': connected\n\n',
      'id: e1\ndata: {"id":"e1","type":"workspace.message.posted"}\n\n',
      'event: wake\ndata: {"topics":["todos","discover"]}\n\n',
      'event: resync\ndata: {}\n\n',
      'event: reconnect\ndata: {}\n\n',
    ]));
    const stream = new LiveStream({ request, fetchImpl: fetchImpl as unknown as typeof fetch });
    const events: unknown[] = [];
    const wakes: string[][] = [];
    const states: LiveState[] = [];
    let resyncs = 0;
    stream.onEvent((e) => events.push(e));
    stream.onWake((t) => wakes.push(t));
    stream.onState((s) => states.push(s));
    stream.onResync(() => { resyncs += 1; });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ id: 'e1', type: 'workspace.message.posted' }]);
    expect(wakes).toEqual([['todos', 'discover']]);
    expect(resyncs).toBe(2); // once on connect, once for `resync`
    expect(states).toContain('live');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.test/v1/events/live?network=w',
      expect.objectContaining({ headers: { 'X-Workspace-Token': 't' } }));
    stream.stop();
    vi.useRealTimers();
  });

  it('treats 404 as "not enabled" and rechecks much later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }));
    const stream = new LiveStream({ request, fetchImpl: fetchImpl as unknown as typeof fetch, offRecheckMs: 600_000 });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.state).toBe('off');
    await vi.advanceTimersByTimeAsync(599_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stream.stop();
    vi.useRealTimers();
  });

  it('backs off after errors so callers keep polling', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const fetchImpl = vi.fn(async () => { throw new TypeError('network'); });
    const stream = new LiveStream({ request, fetchImpl: fetchImpl as unknown as typeof fetch });
    stream.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.state).toBe('retrying');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stream.stop();
    expect(stream.state).toBe('stopped');
    vi.useRealTimers();
  });

  it('ignores malformed frames', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: not json\n\n', 'event: wake\ndata: {"topics":"x"}\n\n']));
    const stream = new LiveStream({ request, fetchImpl: fetchImpl as unknown as typeof fetch });
    const seen: unknown[] = [];
    stream.onEvent((e) => seen.push(e));
    stream.onWake((t) => seen.push(t));
    stream.start();
    await flush(); await flush();
    expect(seen).toEqual([]);
    stream.stop();
  });
});
