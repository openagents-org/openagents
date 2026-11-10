import { expect, it } from 'vitest';
import { shouldOpenFirstRunOnboarding } from './first-run-entry';

const freshWorkspace = {
  needsFirstDevice: true,
  hasAgents: false,
  hasUserSessions: false,
  isDirectMessage: false,
  isWorkspaceLanding: true,
  viewMode: 'threads',
};

it('opens setup when the only conversation is the built-in Welcome thread', () => {
  expect(shouldOpenFirstRunOnboarding(freshWorkspace)).toBe(true);
});

it('preserves existing workspaces and explicit navigation', () => {
  expect(shouldOpenFirstRunOnboarding({ ...freshWorkspace, needsFirstDevice: false })).toBe(false);
  expect(shouldOpenFirstRunOnboarding({ ...freshWorkspace, hasAgents: true })).toBe(false);
  expect(shouldOpenFirstRunOnboarding({ ...freshWorkspace, hasUserSessions: true })).toBe(false);
  expect(shouldOpenFirstRunOnboarding({ ...freshWorkspace, isDirectMessage: true })).toBe(false);
  expect(shouldOpenFirstRunOnboarding({ ...freshWorkspace, isWorkspaceLanding: false })).toBe(false);
  expect(shouldOpenFirstRunOnboarding({ ...freshWorkspace, viewMode: 'issues' })).toBe(false);
});
