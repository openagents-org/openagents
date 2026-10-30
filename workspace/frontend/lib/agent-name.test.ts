import { expect, it } from 'vitest';
import { uniqueAgentName } from './agent-name';

it('keeps a free name and numbers one that is taken', () => {
  expect(uniqueAgentName('cursor', new Set())).toBe('cursor');
  expect(uniqueAgentName('cursor', new Set(['cursor']))).toBe('cursor-2');
  expect(uniqueAgentName('cursor', new Set(['cursor', 'cursor-2']))).toBe('cursor-3');
});
