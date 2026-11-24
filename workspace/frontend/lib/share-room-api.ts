/**
 * Client for the owner's light room of an OpenAgents Share workspace
 * (`/share/own/<slug>?token=…`): the room, its messages, the guest link and
 * keeping the conversation. Every room call sends the owner link's workspace
 * token as `X-Workspace-Token`; keeping it also sends the signed-in account's
 * bearer.
 */
import { getApiBaseUrl } from '@/lib/api-base';
import type { ONMEvent } from '@/lib/types';
import type { GuestLink, GuestLinksClient, ThreadGuestRecord } from '@/lib/guest-links';
import { request, type GuestApiOptions, type GuestMessagesPage, type GuestThreadAgent, type GuestThreadInfo } from '@/lib/guest-thread-api';

export interface MovedTo {
  slug: string;
  channel: string;
}

export interface ShareRoom {
  workspace: { id: string; slug: string; name: string };
  thread: { name: string; title: string | null };
  owner: { name: string };
  agents: GuestThreadAgent[];
  link: GuestLink | null;
  share: { claimed: boolean; movedTo: MovedTo | null };
}

export interface RoomCredentials {
  slug: string;
  token: string;
}

/** A workspace the signed-in account can open (subset of `GET /v1/workspaces`). */
export interface MyWorkspace {
  workspaceId: string;
  slug: string;
  name: string;
}

export interface ImportResult {
  workspace: { id: string; slug: string; name: string };
  channel: { name: string; title: string | null };
}

/** The room in the shape the shared thread view renders. */
export function roomToThreadInfo(room: ShareRoom): GuestThreadInfo {
  return {
    thread: room.thread,
    workspace: { name: room.workspace.name },
    owner: room.owner,
    agents: room.agents || [],
    expiresAt: room.link?.expiresAt ?? null,
    canPost: true,
    approvalMode: room.link?.approvalMode ?? 'none',
    guestsCanPost: room.link?.canPost ?? true,
    guest: null,
  };
}

/** `movedTo` from a 410 body (or a room), when it's well formed. */
export function movedToOf(data: unknown): MovedTo | null {
  const moved = (data as { movedTo?: Partial<MovedTo> } | null)?.movedTo;
  if (!moved || typeof moved.slug !== 'string' || typeof moved.channel !== 'string' || !moved.slug || !moved.channel) return null;
  return { slug: moved.slug, channel: moved.channel };
}

/** Full-workspace URL of a thread. */
export function threadPath(slug: string, channel: string): string {
  return `/${encodeURIComponent(slug)}/threads/${encodeURIComponent(channel)}`;
}

function url(path: string, options: GuestApiOptions): string {
  return `${options.baseUrl ?? getApiBaseUrl()}${path}`;
}

function headers(creds: { token?: string | null }, idToken?: string | null, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (creds.token) h['X-Workspace-Token'] = creds.token;
  if (idToken) h.Authorization = `Bearer ${idToken}`;
  return h;
}

function q(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ── Room ──

export function fetchRoom(creds: RoomCredentials, options: GuestApiOptions = {}): Promise<ShareRoom> {
  return request<ShareRoom>(url(`/v1/guest-links/room?${q({ network: creds.slug })}`, options), { method: 'GET', headers: headers(creds) }, options);
}

export function fetchRoomMessages(creds: RoomCredentials, after?: string | null, options: GuestApiOptions & { limit?: number } = {}): Promise<GuestMessagesPage> {
  const params: Record<string, string> = { network: creds.slug, limit: String(options.limit ?? 100) };
  if (after) params.after = after;
  return request<GuestMessagesPage>(url(`/v1/guest-links/room/messages?${q(params)}`, options), { method: 'GET', headers: headers(creds) }, options);
}

export function fetchEarlierRoomMessages(creds: RoomCredentials, before: string, options: GuestApiOptions & { limit?: number } = {}): Promise<GuestMessagesPage> {
  const params = { network: creds.slug, limit: String(options.limit ?? 100), before };
  return request<GuestMessagesPage>(url(`/v1/guest-links/room/messages?${q(params)}`, options), { method: 'GET', headers: headers(creds) }, options);
}

export function postRoomMessage(creds: RoomCredentials, content: string, idempotencyKey: string, options: GuestApiOptions = {}): Promise<ONMEvent> {
  return request<ONMEvent>(url(`/v1/guest-links/room/messages?${q({ network: creds.slug })}`, options), {
    method: 'POST',
    headers: headers(creds, null, true),
    body: JSON.stringify({ content, idempotency_key: idempotencyKey }),
  }, options);
}

// ── Guest link (owner token) ──

export function roomGuestLinksClient(creds: RoomCredentials, options: GuestApiOptions = {}): GuestLinksClient {
  const linkPath = (id: string) => `/v1/guest-links/${encodeURIComponent(id)}?${q({ network: creds.slug })}`;
  return {
    async list(channel) {
      const data = await request<{ links?: GuestLink[] }>(url(`/v1/guest-links?${q({ network: creds.slug, channel })}`, options), { method: 'GET', headers: headers(creds) }, options);
      return data?.links || [];
    },
    async create(channel, expiresAt) {
      const data = await request<{ link: GuestLink }>(url('/v1/guest-links', options), {
        method: 'POST', headers: headers(creds, null, true), body: JSON.stringify({ network: creds.slug, channel, expires_at: expiresAt }),
      }, options);
      return data.link;
    },
    async updateExpiry(id, expiresAt) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: headers(creds, null, true), body: JSON.stringify({ expires_at: expiresAt }),
      }, options);
      return data.link;
    },
    async revoke(id) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), { method: 'DELETE', headers: headers(creds) }, options);
      return data.link;
    },
    async updateCanPost(id, canPost) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: headers(creds, null, true), body: JSON.stringify({ can_post: canPost }),
      }, options);
      return data.link;
    },
    async listGuests() {
      const data = await request<{ guests?: ThreadGuestRecord[] }>(url(`/v1/guest-links/room/guests?${q({ network: creds.slug })}`, options), { method: 'GET', headers: headers(creds) }, options);
      return data?.guests || [];
    },
    async removeGuest(_channel, guestId) {
      const data = await request<{ guest: ThreadGuestRecord }>(url(`/v1/guest-links/room/guests/${encodeURIComponent(guestId)}?${q({ network: creds.slug })}`, options), { method: 'DELETE', headers: headers(creds) }, options);
      return data.guest;
    },
    async updateApprovalMode(id, mode) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: headers(creds, null, true), body: JSON.stringify({ approval_mode: mode }),
      }, options);
      return data.link;
    },
  };
}

// ── Guests' requests waiting for the owner ──

export type ShareRequestStatus = 'pending' | 'approved' | 'declined';

export interface ShareRequest {
  id: string;
  status: ShareRequestStatus;
  guest: { id: string; name: string };
  /** The held guest message. */
  messageId: string;
  content: string;
  createdAt: string | null;
}

export async function fetchRoomRequests(creds: RoomCredentials, options: GuestApiOptions = {}): Promise<ShareRequest[]> {
  const data = await request<{ requests?: ShareRequest[] }>(url(`/v1/guest-links/room/requests?${q({ network: creds.slug })}`, options), { method: 'GET', headers: headers(creds) }, options);
  return data?.requests || [];
}

/** Approve (the request goes to the agent) or decline it. 409 = already decided. */
export async function decideRoomRequest(creds: RoomCredentials, id: string, decision: 'approve' | 'decline', options: GuestApiOptions = {}): Promise<ShareRequest> {
  const data = await request<{ request: ShareRequest }>(url(`/v1/guest-links/room/requests/${encodeURIComponent(id)}?${q({ network: creds.slug })}`, options), {
    method: 'POST', headers: headers(creds, null, true), body: JSON.stringify({ decision }),
  }, options);
  return data.request;
}

// ── Keeping the conversation ──

export function claimShare(creds: RoomCredentials, idToken: string, options: GuestApiOptions = {}): Promise<{ claimed: boolean; already?: boolean }> {
  return request(url('/v1/guest-links/claim', options), {
    method: 'POST', headers: headers(creds, idToken, true), body: JSON.stringify({ network: creds.slug }),
  }, options);
}

export function importShare(creds: RoomCredentials, target: string, idToken: string, options: GuestApiOptions = {}): Promise<ImportResult> {
  return request(url('/v1/guest-links/import', options), {
    method: 'POST', headers: headers(creds, idToken, true), body: JSON.stringify({ network: creds.slug, target }),
  }, options);
}

/** The signed-in account's workspaces (bearer only — no owner token). */
export async function listMyWorkspaces(idToken: string, options: GuestApiOptions = {}): Promise<MyWorkspace[]> {
  const data = await request<unknown>(url('/v1/workspaces', options), { method: 'GET', headers: headers({}, idToken) }, options);
  const list = Array.isArray(data) ? data : Array.isArray((data as { workspaces?: unknown[] } | null)?.workspaces) ? (data as { workspaces: unknown[] }).workspaces : [];
  return list
    .map((w) => w as Partial<MyWorkspace> & { workspace_id?: string; id?: string })
    .map((w) => ({ workspaceId: w.workspaceId || w.workspace_id || w.id || '', slug: w.slug || '', name: w.name || w.slug || '' }))
    .filter((w) => w.workspaceId && w.slug);
}
