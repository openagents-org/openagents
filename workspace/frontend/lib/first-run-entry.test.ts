import { expect, it } from 'vitest';
import { hasAddedWorkspaceAgent, shouldOpenFirstRunOnboarding } from './first-run-entry';

const freshWorkspace = {
  needsFirstDevice: true,
  hasAgents: false,
  hasUserSessions: false,
  isDirectMessage: false,
  isWorkspaceLanding: true,
  viewMode: 'threads',
};

it('keeps Welcome available with only Yumi, hides it for added agents even offline, and restores it after removal', () => {
  const yumi = { builtin: true, status: 'online' };
  const addedAgent = { builtin: false, status: 'online' };
  expect(hasAddedWorkspaceAgent([])).toBe(false);
  expect(hasAddedWorkspaceAgent([yumi])).toBe(false);
  expect(hasAddedWorkspaceAgent([yumi, addedAgent])).toBe(true);
  expect(hasAddedWorkspaceAgent([yumi, { ...addedAgent, status: 'offline' }])).toBe(true);
  expect(hasAddedWorkspaceAgent([yumi])).toBe(false);
});

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
