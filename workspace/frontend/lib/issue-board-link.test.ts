import { expect, it } from 'vitest';
import { issueBoardPath, requestedIssueBoard, withIssueBoard } from './issue-board-link';

it.each([
  'https://workspace.example/ws/issues/issue-1?token=session&board=old',
  'https://workspace.example/#/ws/issues/issue-1?token=session&board=old',
  'openagents://workspace/#/ws/issues/issue-1?token=session&board=old',
])('preserves the issue and credentials while changing boards at %s', (location) => {
  const updated = withIssueBoard(location, 'marketing');
  expect(requestedIssueBoard(updated.href)).toBe('marketing');
  expect(updated.href).toContain('/ws/issues/issue-1');
  expect(updated.href).toContain('token=session');
});

it('creates a shareable board path without a selected issue or credentials', () => {
  expect(issueBoardPath('shared workspace', 'board & one')).toBe('/shared%20workspace/issues?board=board+%26+one');
});
