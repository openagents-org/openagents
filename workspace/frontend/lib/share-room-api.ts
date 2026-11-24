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
import { request, type AddedAgent, type GuestApiOptions, type GuestMessagesPage, type GuestThreadAgent, type GuestThreadInfo, type PinnedArtifact } from '@/lib/guest-thread-api';

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
  /** `claimed`: saved to someone's rooms; `keptAsWorkspace`: made a full workspace. */
  share: { claimed: boolean; movedTo: MovedTo | null; keptAsWorkspace?: boolean };
  pinnedArtifact?: PinnedArtifact | null;
}

/**
 * How the owner room authenticates: the owner link's workspace token, the
 * signed-in owner's bearer, or both. `idToken` may be a getter so a refreshed
 * sign-in token doesn't change the credentials' identity (and restart polling).
 */
export interface RoomCredentials {
  slug: string;
  token?: string | null;
  idToken?: string | null | (() => string | null);
}

function bearerOf(creds: { idToken?: RoomCredentials['idToken'] }): string | null {
  const value = typeof creds.idToken === 'function' ? creds.idToken() : creds.idToken;
  return value || null;
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
    pinnedArtifact: room.pinnedArtifact ?? null,
    allowGuestAgents: room.link?.allowGuestAgents ?? false,
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

/** Room request headers: the owner token when present, and the bearer (given or from the credentials). */
export function roomHeaders(creds: { token?: string | null; idToken?: RoomCredentials['idToken'] }, idToken?: string | null, json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (creds.token) h['X-Workspace-Token'] = creds.token;
  const bearer = idToken || bearerOf(creds);
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  return h;
}

function q(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ── Room ──

export function fetchRoom(creds: RoomCredentials, options: GuestApiOptions = {}): Promise<ShareRoom> {
  return request<ShareRoom>(url(`/v1/guest-links/room?${q({ network: creds.slug })}`, options), { method: 'GET', headers: roomHeaders(creds) }, options);
}

export function fetchRoomMessages(creds: RoomCredentials, after?: string | null, options: GuestApiOptions & { limit?: number } = {}): Promise<GuestMessagesPage> {
  const params: Record<string, string> = { network: creds.slug, limit: String(options.limit ?? 100) };
  if (after) params.after = after;
  return request<GuestMessagesPage>(url(`/v1/guest-links/room/messages?${q(params)}`, options), { method: 'GET', headers: roomHeaders(creds) }, options);
}

export function fetchEarlierRoomMessages(creds: RoomCredentials, before: string, options: GuestApiOptions & { limit?: number } = {}): Promise<GuestMessagesPage> {
  const params = { network: creds.slug, limit: String(options.limit ?? 100), before };
  return request<GuestMessagesPage>(url(`/v1/guest-links/room/messages?${q(params)}`, options), { method: 'GET', headers: roomHeaders(creds) }, options);
}

export function postRoomMessage(creds: RoomCredentials, content: string, idempotencyKey: string, options: GuestApiOptions = {}): Promise<ONMEvent> {
  return request<ONMEvent>(url(`/v1/guest-links/room/messages?${q({ network: creds.slug })}`, options), {
    method: 'POST',
    headers: roomHeaders(creds, null, true),
    body: JSON.stringify({ content, idempotency_key: idempotencyKey }),
  }, options);
}

// ── Guest link (owner token) ──

export function roomGuestLinksClient(creds: RoomCredentials, options: GuestApiOptions = {}): GuestLinksClient {
  const linkPath = (id: string) => `/v1/guest-links/${encodeURIComponent(id)}?${q({ network: creds.slug })}`;
  return {
    async list(channel) {
      const data = await request<{ links?: GuestLink[] }>(url(`/v1/guest-links?${q({ network: creds.slug, channel })}`, options), { method: 'GET', headers: roomHeaders(creds) }, options);
      return data?.links || [];
    },
    async create(channel, expiresAt) {
      const data = await request<{ link: GuestLink }>(url('/v1/guest-links', options), {
        method: 'POST', headers: roomHeaders(creds, null, true), body: JSON.stringify({ network: creds.slug, channel, expires_at: expiresAt }),
      }, options);
      return data.link;
    },
    async updateExpiry(id, expiresAt) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: roomHeaders(creds, null, true), body: JSON.stringify({ expires_at: expiresAt }),
      }, options);
      return data.link;
    },
    async revoke(id) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), { method: 'DELETE', headers: roomHeaders(creds) }, options);
      return data.link;
    },
    async updateCanPost(id, canPost) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: roomHeaders(creds, null, true), body: JSON.stringify({ can_post: canPost }),
      }, options);
      return data.link;
    },
    async listGuests() {
      const data = await request<{ guests?: ThreadGuestRecord[] }>(url(`/v1/guest-links/room/guests?${q({ network: creds.slug })}`, options), { method: 'GET', headers: roomHeaders(creds) }, options);
      return data?.guests || [];
    },
    async removeGuest(_channel, guestId) {
      const data = await request<{ guest: ThreadGuestRecord }>(url(`/v1/guest-links/room/guests/${encodeURIComponent(guestId)}?${q({ network: creds.slug })}`, options), { method: 'DELETE', headers: roomHeaders(creds) }, options);
      return data.guest;
    },
    async updateAllowGuestAgents(id, allow) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: roomHeaders(creds, null, true), body: JSON.stringify({ allow_guest_agents: allow }),
      }, options);
      return data.link;
    },
    async updateAccess(id, access) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: roomHeaders(creds, null, true), body: JSON.stringify({ access }),
      }, options);
      return data.link;
    },
    async addInvites(id, emails) {
      const data = await request<{ link: GuestLink; added?: string[] }>(url(`/v1/guest-links/${encodeURIComponent(id)}/invites?${q({ network: creds.slug })}`, options), {
        method: 'POST', headers: roomHeaders(creds, null, true), body: JSON.stringify({ emails }),
      }, options);
      return { link: data.link, added: data.added || [] };
    },
    async removeInvite(id, email) {
      const data = await request<{ link: GuestLink }>(url(`/v1/guest-links/${encodeURIComponent(id)}/invites?${q({ network: creds.slug, email })}`, options), {
        method: 'DELETE', headers: roomHeaders(creds),
      }, options);
      return data.link;
    },
    async updateApprovalMode(id, mode) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: roomHeaders(creds, null, true), body: JSON.stringify({ approval_mode: mode }),
      }, options);
      return data.link;
    },
  };
}

// ── Agents in the room ──

/** The owner adds another agent of theirs to the room. */
export function addRoomAgent(creds: RoomCredentials, agent: { name: string; type: string }, options: GuestApiOptions = {}): Promise<AddedAgent> {
  return request<AddedAgent>(url(`/v1/guest-links/room/agents?${q({ network: creds.slug })}`, options), {
    method: 'POST', headers: roomHeaders(creds, null, true), body: JSON.stringify(agent),
  }, options);
}

/** The owner removes an agent (not the one the room was shared for). */
export function removeRoomAgent(creds: RoomCredentials, name: string, options: GuestApiOptions = {}): Promise<unknown> {
  return request(url(`/v1/guest-links/room/agents/${encodeURIComponent(name)}?${q({ network: creds.slug })}`, options), {
    method: 'DELETE', headers: roomHeaders(creds),
  }, options);
}

// ── The artifact open for guests ──

/** Open an artifact for guests (or close it: null). */
export async function pinRoomArtifact(creds: RoomCredentials, ref: PinnedArtifact | null, options: GuestApiOptions = {}): Promise<PinnedArtifact | null> {
  const data = await request<{ pinnedArtifact: PinnedArtifact | null }>(url(`/v1/guest-links/room/pin?${q({ network: creds.slug })}`, options), {
    method: 'PUT', headers: roomHeaders(creds, null, true), body: JSON.stringify(ref ? { kind: ref.kind, id: ref.id } : { kind: null }),
  }, options);
  return data?.pinnedArtifact ?? null;
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
  const data = await request<{ requests?: ShareRequest[] }>(url(`/v1/guest-links/room/requests?${q({ network: creds.slug })}`, options), { method: 'GET', headers: roomHeaders(creds) }, options);
  return data?.requests || [];
}

/** Approve (the request goes to the agent) or decline it. 409 = already decided. */
export async function decideRoomRequest(creds: RoomCredentials, id: string, decision: 'approve' | 'decline', options: GuestApiOptions = {}): Promise<ShareRequest> {
  const data = await request<{ request: ShareRequest }>(url(`/v1/guest-links/room/requests/${encodeURIComponent(id)}?${q({ network: creds.slug })}`, options), {
    method: 'POST', headers: roomHeaders(creds, null, true), body: JSON.stringify({ decision }),
  }, options);
  return data.request;
}

// ── Keeping the conversation ──

export function claimShare(creds: RoomCredentials, idToken: string, options: GuestApiOptions = {}): Promise<{ claimed: boolean; already?: boolean }> {
  return request(url('/v1/guest-links/claim', options), {
    method: 'POST', headers: roomHeaders(creds, idToken, true), body: JSON.stringify({ network: creds.slug }),
  }, options);
}

export function importShare(creds: RoomCredentials, target: string, idToken: string, options: GuestApiOptions = {}): Promise<ImportResult> {
  return request(url('/v1/guest-links/import', options), {
    method: 'POST', headers: roomHeaders(creds, idToken, true), body: JSON.stringify({ network: creds.slug, target }),
  }, options);
}

// ── My rooms (signed in) ──

/** A room in "My rooms": the room plus its activity, guests and link state. */
export interface MyRoom extends ShareRoom {
  liveLink: GuestLink | null;
  /** Milliseconds since the epoch, or null. */
  lastActivityAt: number | null;
  guestCount: number;
  pendingRequests: number;
  keptAsWorkspace: boolean;
}

/** One room from `GET /v1/rooms`, with missing fields defaulted. */
export function toMyRoom(raw: unknown): MyRoom | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ws = (r.workspace || {}) as Partial<ShareRoom['workspace']>;
  const thread = (r.thread || {}) as Partial<ShareRoom['thread']>;
  if (!ws.slug || !thread.name) return null;
  const share = (r.share || {}) as Partial<ShareRoom['share']>;
  const kept = !!(r.keptAsWorkspace ?? share.keptAsWorkspace);
  return {
    workspace: { id: ws.id || '', slug: ws.slug, name: ws.name || ws.slug },
    thread: { name: thread.name, title: thread.title ?? null },
    owner: { name: ((r.owner || {}) as { name?: string }).name || '' },
    agents: Array.isArray(r.agents) ? (r.agents as GuestThreadAgent[]) : [],
    link: (r.link as GuestLink | null) ?? null,
    share: { claimed: !!share.claimed, movedTo: share.movedTo ?? null, keptAsWorkspace: kept },
    liveLink: (r.liveLink as GuestLink | null) ?? null,
    lastActivityAt: typeof r.lastActivityAt === 'number' ? r.lastActivityAt : null,
    guestCount: typeof r.guestCount === 'number' ? r.guestCount : 0,
    pendingRequests: typeof r.pendingRequests === 'number' ? r.pendingRequests : 0,
    keptAsWorkspace: kept,
  };
}

export async function listMyRooms(idToken: string, options: GuestApiOptions = {}): Promise<MyRoom[]> {
  const data = await request<{ rooms?: unknown[] }>(url('/v1/rooms', options), { method: 'GET', headers: roomHeaders({}, idToken) }, options);
  return (data?.rooms || []).map(toMyRoom).filter((r): r is MyRoom => !!r);
}

/** Make the room a full workspace of the signed-in owner (claims it first if needed). */
export function keepAsWorkspace(creds: RoomCredentials, options: GuestApiOptions = {}): Promise<ImportResult> {
  return request(url(`/v1/rooms/${encodeURIComponent(creds.slug)}/keep-as-workspace`, options), {
    method: 'POST', headers: roomHeaders(creds, null, true), body: '{}',
  }, options);
}

/** Delete the room: its links stop working. */
export function deleteRoom(creds: RoomCredentials, options: GuestApiOptions = {}): Promise<{ deleted: boolean }> {
  return request(url(`/v1/rooms/${encodeURIComponent(creds.slug)}`, options), { method: 'DELETE', headers: roomHeaders(creds) }, options);
}

/** The signed-in account's workspaces (bearer only — no owner token). */
export async function listMyWorkspaces(idToken: string, options: GuestApiOptions = {}): Promise<MyWorkspace[]> {
  const data = await request<unknown>(url('/v1/workspaces', options), { method: 'GET', headers: roomHeaders({}, idToken) }, options);
  const list = Array.isArray(data) ? data : Array.isArray((data as { workspaces?: unknown[] } | null)?.workspaces) ? (data as { workspaces: unknown[] }).workspaces : [];
  return list
    .map((w) => w as Partial<MyWorkspace> & { workspace_id?: string; id?: string })
    .map((w) => ({ workspaceId: w.workspaceId || w.workspace_id || w.id || '', slug: w.slug || '', name: w.name || w.slug || '' }))
    .filter((w) => w.workspaceId && w.slug);
}
