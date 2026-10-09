import { describe, expect, it } from 'vitest';
import { dmCounterpart, dmPair, dmSessionId, isMyAddress, myAddress } from './dm';

describe('myAddress', () => {
  it('uses the email for signed-in people', () => {
    expect(myAddress({ id: 'Sam@Demo.io', isAuthenticated: true })).toBe('human:sam@demo.io');
  });
  it('falls back to the legacy address for anonymous users', () => {
    expect(myAddress({ id: 'u-123', isAuthenticated: false })).toBe('human:user');
    expect(myAddress({ id: 'x@y.z', isAuthenticated: false })).toBe('human:user');
    expect(myAddress(null)).toBe('human:user');
  });
});

describe('dmSessionId', () => {
  it('is the sorted pair, same from both sides', () => {
    const a = 'human:alice@x.io';
    const b = 'human:bob@x.io';
    expect(dmSessionId(a, b)).toBe('dm:human:alice@x.io,human:bob@x.io');
    expect(dmSessionId(b, a)).toBe(dmSessionId(a, b));
    expect(dmSessionId('human:user', 'openagents:scout')).toBe('dm:human:user,openagents:scout');
  });
});

describe('dmCounterpart', () => {
  const me = 'human:alice@x.io';
  it('returns the other person', () => {
    expect(dmCounterpart('dm:human:alice@x.io,human:bob@x.io', me)).toBe('human:bob@x.io');
    expect(dmCounterpart(['human:bob@x.io', 'human:alice@x.io'], me)).toBe('human:bob@x.io');
  });
  it('returns the agent for my agent DMs', () => {
    expect(dmCounterpart('dm:human:alice@x.io,openagents:scout', me)).toBe('openagents:scout');
  });
  it('treats legacy human:user as me', () => {
    expect(dmCounterpart('dm:human:user,openagents:scout', me)).toBe('openagents:scout');
    expect(dmCounterpart('dm:human:bob@x.io,human:user', me)).toBe('human:bob@x.io');
    expect(isMyAddress('human:user', me)).toBe(true);
    expect(dmCounterpart('dm:human:user,openagents:scout', 'human:user')).toBe('openagents:scout');
  });
  it('keeps old per-device human ids writable with agents', () => {
    expect(dmCounterpart('dm:human:abc123,openagents:scout', me)).toBe('openagents:scout');
  });
  it('returns null when I am not in the pair', () => {
    expect(dmCounterpart('dm:openagents:a,openagents:b', me)).toBeNull();
    expect(dmCounterpart('dm:human:bob@x.io,human:carol@x.io', me)).toBeNull();
    expect(dmCounterpart('dm:human:bob@x.io,openagents:scout', me)).toBeNull();
    expect(dmCounterpart('thread-1', me)).toBeNull();
  });
  it('dmPair splits only dm ids', () => {
    expect(dmPair('dm:a,b')).toEqual(['a', 'b']);
    expect(dmPair('x')).toEqual([]);
  });
});
