import { expect, it } from 'vitest';
import { canAdminister, canAccessSettingsSection } from './admin-context';
import type { WorkspaceMe } from '@/lib/types';
const me = (role: WorkspaceMe['role'], effectiveRole = role) => ({ authenticated: !!role, role, effectiveRole, tokenAccess: true }) as WorkspaceMe;
it.each(['member', 'viewer'] as const)('does not elevate a signed-in %s with an owner-equivalent token', (role) => {
  const person = me(role, 'owner');
  expect(canAdminister(person)).toBe(false);
  for (const section of ['general', 'members', 'security', 'approvals', 'private-threads', 'devices', 'model-access', 'integrations']) {
    expect(canAccessSettingsSection(person, section)).toBe(false);
  }
  for (const section of ['profile', 'preferences', 'api-credits']) expect(canAccessSettingsSection(person, section)).toBe(true);
});
it('allows administrators and legacy token-only access, and denies an unresolved identity', () => {
  expect(canAdminister(me('admin'))).toBe(true);
  expect(canAdminister(me('owner'))).toBe(true);
  expect(canAdminister(me(null, 'owner'))).toBe(true);
  expect(canAdminister(null)).toBe(false);
  expect(canAccessSettingsSection(null, 'general')).toBe(false);
});
