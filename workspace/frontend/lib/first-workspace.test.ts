// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountWorkspace } from './account-api';
import { landingTarget, markAutoEntered, orderWorkspaces, takeLandingNote } from './first-workspace';

const ws = (over: Partial<AccountWorkspace>): AccountWorkspace => ({
  workspaceId: 'id-' + (over.slug ?? 'x'), slug: 'x', name: 'X', token: null, role: 'owner', lastActivityAt: null, ...over,
});

afterEach(() => sessionStorage.clear());

describe('landingTarget', () => {
  it('says a workspace created just now was created, and an older lone one is the only one', () => {
    expect(landingTarget([ws({ slug: 'mine', justCreated: true, autoProvisioned: true })])?.reason).toBe('created');
    expect(landingTarget([ws({ slug: 'mine' })])?.reason).toBe('only');
  });

  it('opens the invited workspace while the one created for the user is still unused', () => {
    const own = ws({ slug: 'mine', autoProvisioned: true, untouched: true });
    const team = ws({ slug: 'team', role: 'member' });
    expect(landingTarget([own, team])).toEqual({ workspace: team, reason: 'invited' });
    expect(orderWorkspaces([own, team]).map((w) => w.slug)).toEqual(['team', 'mine']);
  });

  it('shows the list once the user has used their own workspace, or has several invites', () => {
    const team = ws({ slug: 'team', role: 'member' });
    expect(landingTarget([ws({ slug: 'mine', autoProvisioned: true, untouched: false }), team])).toBeNull();
    expect(landingTarget([ws({ slug: 'mine', autoProvisioned: true, untouched: true }), team, ws({ slug: 'b', role: 'viewer' })])).toBeNull();
  });

  it('enters once per session, and leaves a single-use note for that workspace', () => {
    const target = landingTarget([ws({ slug: 'mine', name: 'Mia’s workspace' })])!;
    markAutoEntered(target);
    expect(landingTarget([ws({ slug: 'mine' })])).toBeNull();
    expect(takeLandingNote('other')).toBeNull();
    expect(takeLandingNote('mine')).toMatchObject({ reason: 'only', name: 'Mia’s workspace' });
    expect(takeLandingNote('mine')).toBeNull();
  });
});
