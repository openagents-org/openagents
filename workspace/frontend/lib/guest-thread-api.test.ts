import { describe, expect, it, vi } from 'vitest';
import {
  GuestThreadError,
  clearGuestSession,
  fetchEarlierGuestMessages,
  fetchGuestMessages,
  fetchThreadLink,
  guestSessionKey,
  isTerminalLinkError,
  joinAsGuest,
  loadGuestSession,
  postGuestMessage,
  saveGuestSession,
} from './guest-thread-api';

const BASE = 'https://api.test';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('thread link errors', () => {
  it('maps 404 to not_found and 410 to expired, both terminal', async () => {
    const notFound = await fetchThreadLink('tok', null, { baseUrl: BASE, fetchImpl: respond(404, { code: 404, message: 'Not found' }) }).catch((e) => e);
    expect(notFound).toBeInstanceOf(GuestThreadError);
    expect(notFound.kind).toBe('not_found');
    expect(isTerminalLinkError(notFound)).toBe(true);

    const expired = await fetchGuestMessages('tok', 'e1', { baseUrl: BASE, fetchImpl: respond(410, { code: 410, message: 'Gone' }) }).catch((e) => e);
    expect(expired.kind).toBe('expired');
    expect(isTerminalLinkError(expired)).toBe(true);
  });

  it('maps 401 and 429 on posting, which are not terminal', async () => {
    const unauthorized = await postGuestMessage('tok', 's', 'hi', 'k', { baseUrl: BASE, fetchImpl: respond(401, { code: 401, message: 'bad session' }) }).catch((e) => e);
    expect(unauthorized.kind).toBe('unauthorized');
    expect(isTerminalLinkError(unauthorized)).toBe(false);
    const limited = await postGuestMessage('tok', 's', 'hi', 'k', { baseUrl: BASE, fetchImpl: respond(429, {}) }).catch((e) => e);
    expect(limited.kind).toBe('rate_limited');
  });

  it('treats a non-zero envelope code as a server error and a thrown fetch as network', async () => {
    const env = await fetchThreadLink('tok', null, { baseUrl: BASE, fetchImpl: respond(200, { code: 1, message: 'nope', data: null }) }).catch((e) => e);
    expect(env.kind).toBe('server');
    const net = await fetchThreadLink('tok', null, { baseUrl: BASE, fetchImpl: vi.fn(async () => { throw new TypeError('offline'); }) }).catch((e) => e);
    expect(net.kind).toBe('network');
  });
});

describe('requests', () => {
  it('calls only the public thread-link endpoints, without cookies', async () => {
    const fetchImpl = respond(200, { code: 0, message: 'ok', data: { messages: [], hasMore: false } });
    await fetchGuestMessages('a/b', 'evt-9', { baseUrl: BASE, fetchImpl });
    await fetchGuestMessages('a/b', null, { baseUrl: BASE, fetchImpl });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe(`${BASE}/v1/guest-links/public/a%2Fb/messages?limit=100&after=evt-9`);
    expect(calls[1][0]).toBe(`${BASE}/v1/guest-links/public/a%2Fb/messages?limit=100`);
    expect(calls[0][1].credentials).toBe('omit');
    for (const [url] of calls) {
      expect(url).not.toMatch(/\/v1\/events|\/v1\/workspaces/);
    }
  });

  it('asks for earlier messages with a before cursor', async () => {
    const fetchImpl = respond(200, { code: 0, message: 'ok', data: { messages: [], hasMore: true } });
    await expect(fetchEarlierGuestMessages('tok', 'evt-1', { baseUrl: BASE, fetchImpl })).resolves.toEqual({ messages: [], hasMore: true });
    const [url, init] = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe(`${BASE}/v1/guest-links/public/tok/messages?limit=100&before=evt-1`);
    expect(init.credentials).toBe('omit');
  });

  it('sends the guest session header and idempotency key when posting', async () => {
    const fetchImpl = respond(200, { code: 0, message: 'ok', data: { id: 'e1' } });
    await postGuestMessage('tok', 'secret', 'hello', 'key-1', { baseUrl: BASE, fetchImpl });
    const [url, init] = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toBe(`${BASE}/v1/guest-links/public/tok/messages`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Guest-Session']).toBe('secret');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hello', idempotency_key: 'key-1' });
  });

  it('joins with a name and passes the optional session on the info request', async () => {
    const join = respond(200, { code: 0, message: 'ok', data: { guest: { id: 'g', name: 'Maya' }, session: 's' } });
    await expect(joinAsGuest('tok', 'Maya', { baseUrl: BASE, fetchImpl: join })).resolves.toEqual({ guest: { id: 'g', name: 'Maya' }, session: 's' });
    expect(JSON.parse((join.mock.calls as unknown as [string, RequestInit][])[0][1].body as string)).toEqual({ name: 'Maya' });

    const info = respond(200, { code: 0, message: 'ok', data: {} });
    await fetchThreadLink('tok', 'sess', { baseUrl: BASE, fetchImpl: info });
    await fetchThreadLink('tok', null, { baseUrl: BASE, fetchImpl: info });
    const calls = info.mock.calls as unknown as [string, RequestInit][];
    expect((calls[0][1].headers as Record<string, string>)['X-Guest-Session']).toBe('sess');
    expect(calls[1][1].headers).toBeUndefined();
  });
});

describe('guest session storage', () => {
  it('stores the session per token', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    expect(guestSessionKey('abc')).toBe('oa-guest-session:abc');
    saveGuestSession('abc', 's1', storage);
    expect(loadGuestSession('abc', storage)).toBe('s1');
    expect(loadGuestSession('other', storage)).toBeNull();
    clearGuestSession('abc', storage);
    expect(loadGuestSession('abc', storage)).toBeNull();
  });
});

describe('403 on posting', () => {
  it('is forbidden, not an invalid session (the session must survive)', async () => {
    const err = await postGuestMessage('tok', 's', '@other hi', 'k'.repeat(16), { baseUrl: BASE, fetchImpl: respond(403, { message: 'Guests can only ask the agents in this thread' }) }).catch((e) => e);
    expect(err.kind).toBe('forbidden');
  });
});
