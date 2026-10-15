import { describe, expect, it } from 'vitest';
import { handoffFromMessage } from './handoff';

const full = {
  from: 'deploy-bot',
  to: 'experiment-agent',
  request: 'Re-run the ablation with seed 7',
  context: 'Branch feat/ablation, config in configs/ab.yaml',
  output: 'Seeds 1–6 done; results in runs/',
  next_owner: 'experiment-agent',
};

describe('handoffFromMessage', () => {
  it('reads the record from metadata first', () => {
    const h = handoffFromMessage({ handoff: full }, { handoff: { ...full, request: 'stale' } });
    expect(h).toEqual({
      from: 'deploy-bot',
      to: 'experiment-agent',
      request: 'Re-run the ablation with seed 7',
      context: 'Branch feat/ablation, config in configs/ab.yaml',
      output: 'Seeds 1–6 done; results in runs/',
      nextOwner: 'experiment-agent',
    });
  });

  it('falls back to payload when metadata has no record', () => {
    expect(handoffFromMessage({ explicit_targets: ['x'] }, { handoff: full })?.to).toBe('experiment-agent');
    expect(handoffFromMessage(undefined, { handoff: full })?.from).toBe('deploy-bot');
  });

  it('returns null for plain messages and malformed records', () => {
    expect(handoffFromMessage({})).toBeNull();
    expect(handoffFromMessage(null)).toBeNull();
    expect(handoffFromMessage({ handoff: 'yes' })).toBeNull();
    expect(handoffFromMessage({ handoff: ['a'] })).toBeNull();
    expect(handoffFromMessage({ handoff: { from: 'a', to: 'b' } })).toBeNull();
    expect(handoffFromMessage({ handoff: { from: 'a', request: 'r' } })).toBeNull();
    expect(handoffFromMessage({ handoff: { to: 'b', request: 'r' } })).toBeNull();
  });

  it('normalises agent names and optional sections', () => {
    const h = handoffFromMessage({
      handoff: { from: 'openagents:alpha', to: '@beta', request: '  do it  ', context: '   ', output: '' },
    });
    expect(h).toEqual({
      from: 'alpha',
      to: 'beta',
      request: 'do it',
      context: null,
      output: null,
      nextOwner: 'beta',
    });
  });

  it('accepts camelCase nextOwner and keeps an explicit one', () => {
    expect(handoffFromMessage({ handoff: { ...full, next_owner: undefined, nextOwner: 'reviewer' } })?.nextOwner).toBe('reviewer');
    expect(handoffFromMessage({ handoff: { ...full, next_owner: 'openagents:reviewer' } })?.nextOwner).toBe('reviewer');
  });
});
