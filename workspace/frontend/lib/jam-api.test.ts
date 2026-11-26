import { describe, expect, it, vi } from 'vitest';
import { GuestThreadError } from '@/lib/guest-thread-api';
import {
  claimShare,
  fetchJam,
  fetchJamMessages,
  importShare,
  listMyWorkspaces,
  movedToOf,
  postJamMessage,
  jamGuestLinksClient,
  jamToThreadInfo,
  threadPath,
  type ShareJam,
} from './jam-api';
import { optimisticOwnerMessage, senderIdentity, threadPeople, guestEventToMessage, newPendingSend } from './guest-thread';
import type { ONMEvent } from './types';

const JAM: ShareJam = {
  workspace: { id: 'ws-1', slug: 'alex-share', name: 'Alex’s shared workspace' },
  thread: { name: 'share-abc', title: 'PR reviewer' },
  owner: { name: 'Alex' },
  agents: [{ name: 'claude-code', displayName: 'Claude Code', type: 'claude', online: true, acceptsGuests: true }],
  link: { id: 'l1', channel: 'share-abc', url: 'https://app.test/jam/tok', canPost: true, expiresAt: '2026-12-01T00:00:00Z', revokedAt: null, createdAt: '2026-11-20T00:00:00Z' },
  share: { claimed: false, movedTo: null },
};

const opts = (fetchImpl: typeof fetch) => ({ fetchImpl, baseUrl: 'https://api.test' });
const creds = { slug: 'alex-share', token: 'ws-token' };

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), { status: 200 });
}
function headersOf(fetchMock: ReturnType<typeof vi.fn>, i = 0): Record<string, string> {
  return (fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>;
}

describe('jam data mapping', () => {
  it('maps the jam to the shared thread view info', () => {
    expect(jamToThreadInfo(JAM)).toEqual({
      thread: { name: 'share-abc', title: 'PR reviewer' },
      workspace: { name: 'Alex’s shared workspace' },
      owner: { name: 'Alex' },
      agents: JAM.agents,
      expiresAt: '2026-12-01T00:00:00Z',
      canPost: true,
      approvalMode: 'none',
      guestsCanPost: true,
      pinnedArtifact: null,
      allowGuestAgents: false,
      guest: null,
    });
    expect(jamToThreadInfo({ ...JAM, link: null }).expiresAt).toBeNull();
    expect(jamToThreadInfo({ ...JAM, link: { ...JAM.link!, approvalMode: 'owner' } }).approvalMode).toBe('owner');
  });

  it('reads movedTo only when it is complete', () => {
    expect(movedToOf({ movedTo: { slug: 'team', channel: 'share-abc' } })).toEqual({ slug: 'team', channel: 'share-abc' });
    expect(movedToOf({ movedTo: { slug: 'team' } })).toBeNull();
    expect(movedToOf(null)).toBeNull();
    expect(threadPath('team', 'share-abc')).toBe('/team/threads/share-abc');
  });
});

describe('owner page transport', () => {
  it('sends the owner token on jam calls', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => (url.includes('/messages') ? ok({ messages: [], hasMore: false }) : ok(JAM)));
    await fetchJam(creds, opts(fetchMock as unknown as typeof fetch));
    await fetchJamMessages(creds, 'e5', opts(fetchMock as unknown as typeof fetch));
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/v1/guest-links/jam?network=alex-share');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/v1/guest-links/jam/messages?network=alex-share&limit=100&after=e5');
    expect(headersOf(fetchMock, 0)['X-Workspace-Token']).toBe('ws-token');
    expect(headersOf(fetchMock, 1)['X-Workspace-Token']).toBe('ws-token');
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe('omit');
  });

  it('posts a message with the idempotency key', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok({ id: 'e9' }));
    await postJamMessage(creds, 'hi', 'key-1234567890abcdef', opts(fetchMock as unknown as typeof fetch));
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/v1/guest-links/jam/messages?network=alex-share');
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ content: 'hi', idempotency_key: 'key-1234567890abcdef' });
  });

  it('carries movedTo on a 410', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 410, message: 'moved', data: { movedTo: { slug: 'team', channel: 'share-abc' } } }), { status: 410 }));
    const error = await fetchJam(creds, opts(fetchMock as unknown as typeof fetch)).catch((e) => e);
    expect(error).toBeInstanceOf(GuestThreadError);
    expect(error.status).toBe(410);
    expect(movedToOf(error.data)).toEqual({ slug: 'team', channel: 'share-abc' });
  });

  it('manages the guest link with the owner token', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (init?.method !== 'GET' ? ok({ link: JAM.link }) : ok({ links: [JAM.link] })));
    const client = jamGuestLinksClient(creds, opts(fetchMock as unknown as typeof fetch));
    expect(await client.list('share-abc')).toEqual([JAM.link]);
    await client.updateExpiry('l1', null);
    await client.revoke('l1');
    await client.create('share-abc', null);
    expect(fetchMock.mock.calls.map((c) => [(c[1] as RequestInit).method, c[0]])).toEqual([
      ['GET', 'https://api.test/v1/guest-links?network=alex-share&channel=share-abc'],
      ['PATCH', 'https://api.test/v1/guest-links/l1?network=alex-share'],
      ['DELETE', 'https://api.test/v1/guest-links/l1?network=alex-share'],
      ['POST', 'https://api.test/v1/guest-links'],
    ]);
    for (let i = 0; i < 4; i++) expect(headersOf(fetchMock, i)['X-Workspace-Token']).toBe('ws-token');
  });

  it('keeps with the owner token and the bearer; lists workspaces with the bearer only', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/workspaces')) return ok([{ workspaceId: 'w1', slug: 'team', name: 'Team' }, { slug: 'broken' }]);
      if (url.endsWith('/import')) return ok({ workspace: { id: 'w1', slug: 'team', name: 'Team' }, channel: { name: 'share-abc', title: null } });
      return ok({ claimed: true, already: false });
    });
    const o = opts(fetchMock as unknown as typeof fetch);
    await claimShare(creds, 'id-tok', o);
    await importShare(creds, 'w1', 'id-tok', o);
    expect(await listMyWorkspaces('id-tok', o)).toEqual([{ workspaceId: 'w1', slug: 'team', name: 'Team' }]);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ network: 'alex-share' });
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ network: 'alex-share', target: 'w1' });
    expect(headersOf(fetchMock, 0)).toMatchObject({ 'X-Workspace-Token': 'ws-token', Authorization: 'Bearer id-tok' });
    expect(headersOf(fetchMock, 1)).toMatchObject({ 'X-Workspace-Token': 'ws-token', Authorization: 'Bearer id-tok' });
    expect(headersOf(fetchMock, 2)).toEqual({ Authorization: 'Bearer id-tok' });
  });
});

describe('owner identity', () => {
  const ownerEvent: ONMEvent = {
    id: 'e7', type: 'workspace.message', source: 'human:owner', target: 'channel/share-abc',
    payload: { content: 'Thanks all' }, metadata: { share_owner: true }, timestamp: 7, visibility: 'channel',
  } as ONMEvent;
  const guestEvent: ONMEvent = {
    id: 'e8', type: 'workspace.message', source: 'guest-g1@guest.invalid', target: 'channel/share-abc',
    payload: { content: 'Hi', sender_name: 'Maya' }, metadata: { guest: { id: 'g1', name: 'Maya' } }, timestamp: 8, visibility: 'channel',
  } as ONMEvent;

  it('shows the owner as "You" in the owner page and by name to guests', () => {
    const msg = guestEventToMessage(ownerEvent);
    expect(senderIdentity(msg, [], { guestId: null, isOwner: true, ownerName: 'Alex' })).toMatchObject({ kind: 'human', name: 'Alex', isSelf: true });
    expect(senderIdentity(msg, [], { guestId: 'g1', ownerName: 'Alex' })).toMatchObject({ name: 'Alex', isSelf: false });
    // Recognised by source alone, too.
    expect(senderIdentity(guestEventToMessage({ ...ownerEvent, metadata: {} }), [], { guestId: null, isOwner: true, ownerName: 'Alex' }).isSelf).toBe(true);
  });

  it('keeps guests as guests for the owner', () => {
    const who = senderIdentity(guestEventToMessage(guestEvent), [], { guestId: null, isOwner: true, ownerName: 'Alex' });
    expect(who).toMatchObject({ kind: 'guest', name: 'Maya', isSelf: false });
  });

  it('lists the owner once, marked as the viewer', () => {
    const people = threadPeople([guestEventToMessage(ownerEvent), guestEventToMessage(guestEvent)], 'Alex', null, true);
    expect(people.map((p) => [p.name, p.role, p.isSelf])).toEqual([['Alex', 'owner', true], ['Maya', 'guest', false]]);
  });

  it('makes optimistic owner rows that read as the owner', () => {
    const row = optimisticOwnerMessage(newPendingSend('hello', () => 'abcdefgh12345678'), 'Alex');
    expect(row.metadata?.share_owner).toBe(true);
    expect(senderIdentity(row, [], { guestId: null, isOwner: true, ownerName: 'Alex' }).isSelf).toBe(true);
  });
});
