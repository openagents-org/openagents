import { describe, expect, it } from 'vitest';
import { canActOnApproval, agentPresence, approvalBlockedReason, approvalFromMetadata, canDecideApproval } from './approvals';

const me = (role: 'owner' | 'admin' | 'member' | 'viewer' | null, tokenAccess = false) => ({ role, tokenAccess });

describe('canDecideApproval', () => {
  it('lets any member (but not a viewer) resolve an `any` request', () => {
    expect(canDecideApproval(me('member'), 'any', true)).toBe(true);
    expect(canDecideApproval(me('viewer'), 'any', true)).toBe(false);
  });

  it('requires admin+ for admin gates and owner for owner gates', () => {
    expect(canDecideApproval(me('member'), 'admin', true)).toBe(false);
    expect(canDecideApproval(me('admin'), 'admin', true)).toBe(true);
    expect(canDecideApproval(me('owner'), 'admin', true)).toBe(true);
    expect(canDecideApproval(me('admin'), 'owner', true)).toBe(false);
    expect(canDecideApproval(me('owner'), 'owner', true)).toBe(true);
  });

  it('accepts a bare token only on a legacy workspace that does not enforce login', () => {
    // Agents hold the token — on an enforced-login workspace it must never approve.
    expect(canDecideApproval(me(null, true), 'admin', true)).toBe(false);
    expect(canDecideApproval(me(null, true), 'admin', false)).toBe(true);
    expect(canDecideApproval(me(null, false), 'any', false)).toBe(false);
  });

  it('handles a missing identity', () => {
    expect(canDecideApproval(null, 'any', false)).toBe(false);
    expect(canDecideApproval(undefined, 'any', false)).toBe(false);
  });
});

describe('approvalBlockedReason', () => {
  it('says why the buttons are hidden', () => {
    expect(approvalBlockedReason(me('member'), 'any', true)).toBeNull();
    expect(approvalBlockedReason(me(null, true), 'any', true)).toBe('signIn');
    expect(approvalBlockedReason(me('member'), 'admin', true)).toBe('role');
  });
});

describe('approvalFromMetadata', () => {
  it('maps the snake_case payload the backend embeds in the event', () => {
    const a = approvalFromMetadata({
      approval: {
        id: 'a1', channel_name: 'release-2.4', requested_by: 'claude-dev', kind: 'deploy',
        action: 'Deploy hotfix', details: 'db:migrate', risk: 'high', required_role: 'admin',
        status: 'pending', resolved_by: null, note: null,
      },
    });
    expect(a).toMatchObject({
      id: 'a1', channelName: 'release-2.4', requestedBy: 'claude-dev', kind: 'deploy',
      requiredRole: 'admin', status: 'pending', risk: 'high',
    });
  });

  it('returns null when the message carries no approval', () => {
    expect(approvalFromMetadata({})).toBeNull();
    expect(approvalFromMetadata(undefined)).toBeNull();
    expect(approvalFromMetadata({ approval: 'nope' })).toBeNull();
  });
});

describe('agentPresence', () => {
  it('turns a pending request into "waiting", otherwise mirrors online/offline', () => {
    expect(agentPresence('online', { 'claude-dev': 1 }, 'claude-dev')).toBe('waiting');
    expect(agentPresence('offline', { 'claude-dev': 1 }, 'claude-dev')).toBe('waiting');
    expect(agentPresence('online', {}, 'claude-dev')).toBe('online');
    expect(agentPresence('offline', undefined, 'claude-dev')).toBe('offline');
  });
});

 it('does not use a saved token to elevate an identified member for approval', () => {
  expect(canDecideApproval(me('member', true), 'owner', false)).toBe(false);
  expect(canDecideApproval(me('viewer', true), 'any', false)).toBe(false);
 });

it('requires the named reviewer, retaining independent role requirements', () => {
  const approval = { requiredRole: 'any' as const, assigneeEmail: 'sam@example.com', policyRequirements: {
    members: ['sam@example.com'], approved_by: [] as string[], role_required: null as 'owner' | null, role_approved: false,
  } };
  expect(canActOnApproval({ ...me('member'), email: 'sam@example.com' }, approval, true)).toBe(true);
  expect(canActOnApproval({ ...me('owner'), email: 'owner@example.com' }, approval, true)).toBe(false);
  expect(canActOnApproval({ ...me(null, true), email: null }, approval, false)).toBe(false);
  approval.policyRequirements.role_required = 'owner';
  expect(canActOnApproval({ ...me('owner'), email: 'owner@example.com' }, approval, true)).toBe(true);
  approval.policyRequirements.approved_by = ['sam@example.com'];
  expect(canActOnApproval({ ...me('member'), email: 'sam@example.com' }, approval, true)).toBe(false);
});
