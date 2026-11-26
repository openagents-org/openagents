import { describe, expect, it } from 'vitest';
import {
  expiryForChoice,
  guestLinkState,
  isLive,
  liveLink,
  showGuestLinkPanel,
  upsertLink,
  type GuestLink,
} from './guest-links';

const NOW = Date.parse('2026-11-22T12:00:00Z');
function link(partial: Partial<GuestLink> & { id: string }): GuestLink {
  return {
    channel: 'share-abc',
    url: `https://app.test/jam/${partial.id}`,
    canPost: true,
    expiresAt: null,
    revokedAt: null,
    createdAt: '2026-11-20T00:00:00Z',
    ...partial,
  };
}

describe('guest link state', () => {
  it('is live when neither revoked nor expired', () => {
    expect(isLive(link({ id: 'a' }), NOW)).toBe(true);
    expect(isLive(link({ id: 'a', expiresAt: '2026-11-23T00:00:00Z' }), NOW)).toBe(true);
    expect(isLive(link({ id: 'a', expiresAt: '2026-11-22T11:59:59Z' }), NOW)).toBe(false);
    expect(isLive(link({ id: 'a', revokedAt: '2026-11-21T00:00:00Z' }), NOW)).toBe(false);
  });

  it('picks the newest live link', () => {
    const links = [
      link({ id: 'old', createdAt: '2026-11-01T00:00:00Z' }),
      link({ id: 'off', createdAt: '2026-11-21T00:00:00Z', revokedAt: '2026-11-21T01:00:00Z' }),
      link({ id: 'new', createdAt: '2026-11-10T00:00:00Z' }),
    ];
    expect(liveLink(links, NOW)?.id).toBe('new');
    expect(guestLinkState(links, NOW)).toMatchObject({ kind: 'live', link: { id: 'new' } });
  });

  it('says why the newest link stopped when none is live', () => {
    expect(guestLinkState([], NOW)).toEqual({ kind: 'none' });
    expect(guestLinkState([link({ id: 'a', revokedAt: '2026-11-21T00:00:00Z' })], NOW).kind).toBe('off');
    expect(guestLinkState([link({ id: 'a', expiresAt: '2026-11-21T00:00:00Z' })], NOW).kind).toBe('expired');
  });

  it('shows the panel for shared threads, or threads that have links', () => {
    expect(showGuestLinkPanel('share-1a2b', null)).toBe(true);
    expect(showGuestLinkPanel('share-1a2b', [])).toBe(true);
    expect(showGuestLinkPanel('channel-1', [])).toBe(false);
    expect(showGuestLinkPanel('channel-1', null)).toBe(false);
    expect(showGuestLinkPanel('channel-1', [link({ id: 'a', revokedAt: '2026-11-21T00:00:00Z' })])).toBe(true);
  });
});

describe('expiry choices', () => {
  it('maps Never to null and days to an ISO time from now', () => {
    expect(expiryForChoice('never', NOW)).toBeNull();
    expect(expiryForChoice('1d', NOW)).toBe('2026-11-23T12:00:00.000Z');
    expect(expiryForChoice('7d', NOW)).toBe('2026-11-29T12:00:00.000Z');
    expect(expiryForChoice('30d', NOW)).toBe('2026-12-22T12:00:00.000Z');
  });

  it('replaces a link by id or adds a new one first', () => {
    const a = link({ id: 'a' });
    const b = link({ id: 'b' });
    expect(upsertLink([a, b], { ...a, expiresAt: 'x' }).map((l) => [l.id, l.expiresAt])).toEqual([['a', 'x'], ['b', null]]);
    expect(upsertLink([a], b).map((l) => l.id)).toEqual(['b', 'a']);
  });
});
