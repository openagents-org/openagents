import { describe, expect, it } from 'vitest';
import { initialKeepState } from './keep-workspace-banner';

describe('keep-workspace banner', () => {
  it('offers to keep only an unkept Share workspace opened with its owner link', () => {
    expect(initialKeepState(true, false, 'tok')).toBe('offer');
    expect(initialKeepState(true, true, 'tok')).toBe('hidden');
    expect(initialKeepState(false, false, 'tok')).toBe('hidden');
    expect(initialKeepState(true, false, '')).toBe('hidden');
  });
});
