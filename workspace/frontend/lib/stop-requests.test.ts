import { describe, it, expect } from 'vitest';
import { StopRequestTracker, confirmsStop } from './stop-requests';

describe('StopRequestTracker', () => {
  it('reports a fresh Stop as owning its sessions', () => {
    const tracker = new StopRequestTracker();
    const gen = tracker.claim(['a', 'b']);
    expect(tracker.owned(['a', 'b'], gen)).toEqual(['a', 'b']);
  });

  it('hands ownership to the newer Stop so the older one stops acting', () => {
    // Regression: the first Stop's give-up timer fires seconds after a second
    // Stop began, and used to clear the second Stop's state.
    const tracker = new StopRequestTracker();
    const first = tracker.claim(['a']);
    const second = tracker.claim(['a']);

    expect(tracker.owned(['a'], first)).toEqual([]);
    expect(tracker.owned(['a'], second)).toEqual(['a']);
  });

  it('leaves sessions the newer Stop did not claim with their original owner', () => {
    const tracker = new StopRequestTracker();
    const first = tracker.claim(['a', 'b']);
    tracker.claim(['b']);

    expect(tracker.owned(['a', 'b'], first)).toEqual(['a']);
  });

  it('retires a session once the stop is acknowledged', () => {
    const tracker = new StopRequestTracker();
    const gen = tracker.claim(['a']);
    tracker.release('a');
    expect(tracker.owned(['a'], gen)).toEqual([]);
  });

  it('never reuses a generation, so a released session cannot be reclaimed by an old timer', () => {
    const tracker = new StopRequestTracker();
    const first = tracker.claim(['a']);
    tracker.release('a');
    const second = tracker.claim(['a']);

    expect(second).not.toBe(first);
    expect(tracker.owned(['a'], first)).toEqual([]);
    expect(tracker.owned(['a'], second)).toEqual(['a']);
  });
});

describe('confirmsStop', () => {
  it('rejects a human message', () => {
    // Regression: the background poll can see the user's own just-sent message
    // first, which used to clear the latch with nothing actually stopped.
    expect(confirmsStop({ isAgent: false, isStatus: false, content: 'do the thing' })).toBe(false);
  });

  it('rejects a message with no known sender kind', () => {
    expect(confirmsStop({ isStatus: false, content: 'anything' })).toBe(false);
  });

  it('accepts an agent reply', () => {
    expect(confirmsStop({ isAgent: true, isStatus: false, content: 'Execution stopped by user.' })).toBe(true);
  });

  it('accepts an agent status only when it reports a terminal stop', () => {
    expect(confirmsStop({ isAgent: true, isStatus: true, content: 'Bash > ls' })).toBe(false);
    expect(confirmsStop({ isAgent: true, isStatus: true, content: 'stopped' })).toBe(true);
    expect(confirmsStop({ isAgent: true, isStatus: true, content: 'stopping failed' })).toBe(true);
  });
});
