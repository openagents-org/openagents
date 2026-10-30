import { describe, expect, it } from 'vitest';
import { adoptRemoteMarkers, queueRead } from './read-state';

describe('adoptRemoteMarkers', () => {
  it('adopts reads made on another device', () => {
    expect(adoptRemoteMarkers({ a: 100, b: 300 }, [['a', 200], ['b', 250], ['c', 50]])).toEqual({ a: 200, b: 300, c: 50 });
  });
  it('returns null when nothing is newer', () => {
    expect(adoptRemoteMarkers({ a: 200 }, [['a', 200], ['b', null], ['c', undefined]])).toBeNull();
  });
  it('does not mutate the local markers', () => {
    const local = { a: 1 };
    adoptRemoteMarkers(local, [['a', 2]]);
    expect(local).toEqual({ a: 1 });
  });
});

describe('queueRead', () => {
  it('keeps the newest read per session', () => {
    const pending = queueRead(queueRead({}, 'a', 200), 'a', 100);
    expect(pending).toEqual({ a: 200 });
    expect(queueRead(pending, 'a', 300)).toEqual({ a: 300 });
  });
});
