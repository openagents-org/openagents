import { expect, it } from 'vitest';
import { knowledgeTitle } from './knowledge-title';
it('uses readable names without changing custom titles or exposing opaque ids', () => {
  const sessions = [{ sessionId: 'channel-10fffb12', title: 'Website redesign' }];
  expect(knowledgeTitle('Decisions for channel channel-10fffb12', sessions)).toBe('Decisions · Website redesign');
  expect(knowledgeTitle('Decisions for channel channel-deadbeef', [])).toBe('Decisions');
  expect(knowledgeTitle('My release notes', sessions)).toBe('My release notes');
});
