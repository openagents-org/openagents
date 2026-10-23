import { beforeEach, expect, it, vi } from 'vitest';
const start = vi.fn(), resume = vi.fn();
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
  vi.stubGlobal('AudioContext', class {
    state = 'suspended'; destination = {};
    async resume() { resume(); this.state = 'running'; }
    async decodeAudioData() { return {}; }
    createGain() { return { gain: { value: 0 }, connect: vi.fn() }; }
    createBufferSource() { return { buffer: null, connect: (gain: any) => gain, start }; }
  });
});
it('unlocks and reuses audio, coalesces bursts and permits an explicit test sound', async () => {
  const { playNotificationSound } = await import('./notification-audio');
  expect(await Promise.all([playNotificationSound(), playNotificationSound()])).toEqual([true, true]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(await playNotificationSound(true)).toBe(true);
  expect(start).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(resume).toHaveBeenCalledTimes(1);
});
it('reports unavailable audio instead of falsely claiming a sound played', async () => {
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('blocked'); } });
  const { playNotificationSound } = await import('./notification-audio');
  expect(await playNotificationSound()).toBe(false);
});
