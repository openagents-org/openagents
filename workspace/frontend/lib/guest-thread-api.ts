/**
 * Client for the public, token-scoped guest thread API
 * (`/v1/thread-links/public/{token}/…`).
 *
 * A guest has no workspace account: nothing here sends workspace auth, and
 * nothing calls workspace-scoped endpoints (`/v1/events`, `/v1/workspaces/…`).
 * The only credential is the guest session secret returned when the guest
 * picks a display name, sent as `X-Guest-Session`.
 */
import { getApiBaseUrl } from '@/lib/api-base';
import type { ONMEvent } from '@/lib/types';

export interface GuestThreadAgent {
  name: string;
  displayName: string | null;
  type: string | null;
  online: boolean;
  /** False when the owner's launcher is too old to run a guest's turn read-only. */
  acceptsGuests?: boolean;
}

export interface GuestIdentity {
  id: string;
  name: string;
}

export interface GuestThreadInfo {
  thread: { name: string; title: string | null };
  workspace: { name: string };
  owner: { name: string };
  agents: GuestThreadAgent[];
  expiresAt: string | null;
  canPost: boolean;
  guest: GuestIdentity | null;
}

export interface GuestMessagesPage {
  messages: ONMEvent[];
  hasMore: boolean;
}

export type GuestThreadErrorKind =
  | 'not_found' // 404 — link unknown or revoked
  | 'expired' // 410
  | 'unauthorized' // 401 — guest session missing or invalid
  | 'forbidden' // 403 — e.g. @mentioning an agent outside this thread
  | 'rate_limited' // 429
  | 'invalid' // 400/422 — e.g. a rejected display name
  | 'network'
  | 'server';

export class GuestThreadError extends Error {
  constructor(public kind: GuestThreadErrorKind, message: string, public status: number | null = null) {
    super(message);
    this.name = 'GuestThreadError';
  }
}

/** The link itself is gone: stop polling and show the matching page. */
export function isTerminalLinkError(error: unknown): error is GuestThreadError {
  return error instanceof GuestThreadError && (error.kind === 'not_found' || error.kind === 'expired');
}

export function errorKindForStatus(status: number): GuestThreadErrorKind {
  if (status === 404) return 'not_found';
  if (status === 410) return 'expired';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'invalid';
  return 'server';
}

// ── Guest session storage ──

export function guestSessionKey(token: string): string {
  return `oa-guest-session:${token}`;
}

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): SessionStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

export function loadGuestSession(token: string, storage: SessionStorage | null = defaultStorage()): string | null {
  try { return storage?.getItem(guestSessionKey(token)) || null; } catch { return null; }
}

export function saveGuestSession(token: string, session: string, storage: SessionStorage | null = defaultStorage()): void {
  try { storage?.setItem(guestSessionKey(token), session); } catch { /* keep it in memory only */ }
}

export function clearGuestSession(token: string, storage: SessionStorage | null = defaultStorage()): void {
  try { storage?.removeItem(guestSessionKey(token)); } catch { /* ignore */ }
}

// ── Transport ──

export interface GuestApiOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

function linkUrl(token: string, path = '', baseUrl = getApiBaseUrl()): string {
  return `${baseUrl}/v1/thread-links/public/${encodeURIComponent(token)}${path}`;
}

async function request<T>(url: string, init: RequestInit, options: GuestApiOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    // `credentials: 'omit'`: a guest page must never ride on a workspace
    // cookie the browser happens to hold for the API origin.
    res = await fetchImpl(url, { ...init, credentials: 'omit' });
  } catch {
    throw new GuestThreadError('network', 'Network error');
  }
  let body: { code?: number; message?: string; data?: T } | null = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    throw new GuestThreadError(errorKindForStatus(res.status), body?.message || `HTTP ${res.status}`, res.status);
  }
  if (!body || (body.code !== undefined && body.code !== 0)) {
    throw new GuestThreadError('server', body?.message || 'Unexpected response', res.status);
  }
  return body.data as T;
}

export function fetchThreadLink(token: string, session: string | null, options: GuestApiOptions = {}): Promise<GuestThreadInfo> {
  return request<GuestThreadInfo>(linkUrl(token, '', options.baseUrl), {
    method: 'GET',
    headers: session ? { 'X-Guest-Session': session } : undefined,
  }, options);
}

export function joinAsGuest(token: string, name: string, options: GuestApiOptions = {}): Promise<{ guest: GuestIdentity; session: string }> {
  return request(linkUrl(token, '/guests', options.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }, options);
}

export function fetchGuestMessages(token: string, after?: string | null, options: GuestApiOptions & { limit?: number } = {}): Promise<GuestMessagesPage> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (after) params.set('after', after);
  return request<GuestMessagesPage>(linkUrl(token, `/messages?${params}`, options.baseUrl), { method: 'GET' }, options);
}

export function postGuestMessage(token: string, session: string, content: string, idempotencyKey: string, options: GuestApiOptions = {}): Promise<ONMEvent> {
  return request<ONMEvent>(linkUrl(token, '/messages', options.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Session': session },
    body: JSON.stringify({ content, idempotency_key: idempotencyKey }),
  }, options);
}
