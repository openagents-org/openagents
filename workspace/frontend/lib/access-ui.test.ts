import { describe, expect, it } from 'vitest';
import {
  canInviteToThread,
  canManageThread,
  expiryDateToIso,
  granteeChipLabel,
  granteeFromGrant,
  granteeFromMember,
  granteeKey,
  isExcludedGrantee,
  isGrantExpired,
  isThreadParticipant,
  mergeGrantees,
  normalizeThreadVisibility,
  removeGrantee,
  showJoinButton,
  threadOwnerEmail,
  threadVisibilityLabelKey,
} from './access-ui';
import type { Grantee } from './types';

const admin = { email: 'admin@x.com', effectiveRole: 'admin' as const };
const owner = { email: 'Owner@X.com', effectiveRole: 'member' as const };
const member = { email: 'someone@x.com', effectiveRole: 'member' as const };
const viewer = { email: 'v@x.com', effectiveRole: 'viewer' as const };

describe('thread visibility wording', () => {
  it("maps 'private' to Private and everything else to Public", () => {
    expect(normalizeThreadVisibility('private')).toBe('private');
    expect(normalizeThreadVisibility('public')).toBe('public');
    expect(normalizeThreadVisibility(undefined)).toBe('public');
    expect(normalizeThreadVisibility(null)).toBe('public');
  });

  it("reads the legacy 'workspace' value as Public", () => {
    expect(normalizeThreadVisibility('workspace')).toBe('public');
    expect(threadVisibilityLabelKey('workspace')).toBe('threadAccess.public');
    expect(threadVisibilityLabelKey('private')).toBe('threadAccess.private');
  });
});

describe('threadOwnerEmail', () => {
  it('prefers owner_email, falls back to the wave-1 director, lower-cased', () => {
    expect(threadOwnerEmail({ ownerEmail: 'A@X.com', directorEmail: 'b@x.com' })).toBe('a@x.com');
    expect(threadOwnerEmail({ ownerEmail: null, directorEmail: 'B@x.com' })).toBe('b@x.com');
    expect(threadOwnerEmail({ ownerEmail: '', directorEmail: null })).toBeNull();
    expect(threadOwnerEmail(null)).toBeNull();
  });
});

describe('canManageThread', () => {
  it('allows the owner (case-insensitive) and admins, nobody else', () => {
    expect(canManageThread(owner, 'owner@x.com')).toBe(true);
    expect(canManageThread(admin, 'owner@x.com')).toBe(true);
    expect(canManageThread({ email: 'o@x.com', effectiveRole: 'owner' }, 'owner@x.com')).toBe(true);
    expect(canManageThread(member, 'owner@x.com')).toBe(false);
    expect(canManageThread(viewer, 'owner@x.com')).toBe(false);
    expect(canManageThread(null, 'owner@x.com')).toBe(false);
  });

  it('does not treat an unowned thread as manageable by a plain member', () => {
    expect(canManageThread(member, null)).toBe(false);
    expect(canManageThread({ email: null, effectiveRole: 'member' }, null)).toBe(false);
    expect(canManageThread(admin, null)).toBe(true);
  });
});

describe('canInviteToThread', () => {
  it('lets participants invite only when the owner switched it on', () => {
    const thread = { ownerEmail: 'owner@x.com', participantsCanInvite: true };
    expect(canInviteToThread(member, thread, true)).toBe(true);
    expect(canInviteToThread(member, thread, false)).toBe(false);
    expect(canInviteToThread(member, { ...thread, participantsCanInvite: false }, true)).toBe(false);
    expect(canInviteToThread(owner, { ...thread, participantsCanInvite: false }, false)).toBe(true);
    expect(canInviteToThread(admin, { ...thread, participantsCanInvite: false }, false)).toBe(true);
  });
});

describe('join button', () => {
  const humans = [{ email: 'Owner@X.com' }, { email: 'p@x.com' }];

  it('matches participants case-insensitively', () => {
    expect(isThreadParticipant(humans, 'owner@x.com')).toBe(true);
    expect(isThreadParticipant(humans, 'nobody@x.com')).toBe(false);
    expect(isThreadParticipant(null, 'p@x.com')).toBe(false);
  });

  it('shows Join on a public thread the viewer has not joined, and only then', () => {
    expect(showJoinButton('public', humans, 'new@x.com')).toBe(true);
    expect(showJoinButton('workspace', humans, 'new@x.com')).toBe(true); // legacy = public
    expect(showJoinButton('public', humans, 'p@x.com')).toBe(false);
    expect(showJoinButton('private', humans, 'new@x.com')).toBe(false);
    expect(showJoinButton('public', null, 'new@x.com')).toBe(false); // participants unknown yet
    expect(showJoinButton('public', humans, null)).toBe(false); // anonymous
  });
});

describe('grantee chips', () => {
  it('formats people by name or email local part, agents with @, groups by name', () => {
    expect(granteeChipLabel({ kind: 'human', id: 'jane.doe@x.com', label: 'Jane Doe' })).toBe('Jane Doe');
    expect(granteeChipLabel({ kind: 'human', id: 'jane.doe@x.com', label: '' })).toBe('jane.doe');
    expect(granteeChipLabel({ kind: 'agent', id: 'coder', label: 'Coder' })).toBe('@Coder');
    expect(granteeChipLabel({ kind: 'agent', id: 'coder', label: '  ' })).toBe('@coder');
    expect(granteeChipLabel({ kind: 'group', id: 'g1', label: 'Design' })).toBe('Design');
    expect(granteeChipLabel({ kind: 'group', id: 'g1', label: '' })).toBe('g1');
  });

  it('keys by kind:id and de-duplicates on merge', () => {
    const a: Grantee = { kind: 'human', id: 'a@x.com', label: 'A' };
    const b: Grantee = { kind: 'group', id: 'g1', label: 'G' };
    expect(granteeKey(a)).toBe('human:a@x.com');
    const merged = mergeGrantees([a], [b, { ...a, label: 'again' }, b]);
    expect(merged).toHaveLength(2);
    expect(merged[0].label).toBe('A');
    expect(removeGrantee(merged, { kind: 'group', id: 'g1' })).toEqual([a]);
  });

  it('honours exclude lists given as bare ids or kind:id keys', () => {
    const g: Grantee = { kind: 'agent', id: 'coder', label: 'Coder' };
    expect(isExcludedGrantee(g, ['coder'])).toBe(true);
    expect(isExcludedGrantee(g, ['agent:coder'])).toBe(true);
    expect(isExcludedGrantee(g, ['human:coder', 'other'])).toBe(false);
    expect(isExcludedGrantee(g, [])).toBe(false);
    expect(isExcludedGrantee(g, undefined)).toBe(false);
  });

  it('builds grantees from group members and grants', () => {
    expect(granteeFromMember({ principal_kind: 'human', principal_id: 'x@y.com', display_name: null }))
      .toEqual({ kind: 'human', id: 'x@y.com', label: 'x' });
    expect(granteeFromMember({ principal_kind: 'agent', principal_id: 'coder', display_name: 'Coder' }))
      .toEqual({ kind: 'agent', id: 'coder', label: 'Coder' });
    expect(granteeFromGrant({ grantee_kind: 'group', grantee_id: 'g1', grantee_label: null }))
      .toEqual({ kind: 'group', id: 'g1', label: 'g1' });
  });
});

describe('grant expiry', () => {
  it('flags only grants whose expires_at is in the past', () => {
    const now = Date.UTC(2026, 9, 3, 12);
    expect(isGrantExpired({ expires_at: null }, now)).toBe(false);
    expect(isGrantExpired({ expires_at: '2026-10-02T00:00:00Z' }, now)).toBe(true);
    expect(isGrantExpired({ expires_at: '2026-10-04T00:00:00Z' }, now)).toBe(false);
    expect(isGrantExpired({ expires_at: 'not a date' }, now)).toBe(false);
  });

  it('turns a date input into an end-of-day ISO timestamp, or nothing', () => {
    expect(expiryDateToIso('2026-12-31')).toBe('2026-12-31T23:59:59.000Z');
    expect(expiryDateToIso('')).toBeUndefined();
    expect(expiryDateToIso(null)).toBeUndefined();
    expect(expiryDateToIso('31/12/2026')).toBeUndefined();
  });
});
