/**
 * Client for the owner page of an OpenAgents Jam workspace
 * (`/jam/own/<slug>?token=…`): the jam, its messages, the guest link and
 * keeping the conversation. Every jam call sends the owner link's workspace
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

export interface ShareJam {
  workspace: { id: string; slug: string; name: string };
  thread: { name: string; title: string | null };
  owner: { name: string };
  agents: GuestThreadAgent[];
  link: GuestLink | null;
  /** `claimed`: saved to someone's jams; `keptAsWorkspace`: made a full workspace. */
  share: { claimed: boolean; movedTo: MovedTo | null; keptAsWorkspace?: boolean };
  pinnedArtifact?: PinnedArtifact | null;
}

/**
 * How the owner page authenticates: the owner link's workspace token, the
 * signed-in owner's bearer, or both. `idToken` may be a getter so a refreshed
 * sign-in token doesn't change the credentials' identity (and restart polling).
 */
export interface JamCredentials {
  slug: string;
  token?: string | null;
  idToken?: string | null | (() => string | null);
}

function bearerOf(creds: { idToken?: JamCredentials['idToken'] }): string | null {
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

/** The jam in the shape the shared thread view renders. */
export function jamToThreadInfo(jam: ShareJam): GuestThreadInfo {
  return {
    thread: jam.thread,
    workspace: { name: jam.workspace.name },
    owner: jam.owner,
    agents: jam.agents || [],
    expiresAt: jam.link?.expiresAt ?? null,
    canPost: true,
    approvalMode: jam.link?.approvalMode ?? 'none',
    guestsCanPost: jam.link?.canPost ?? true,
    pinnedArtifact: jam.pinnedArtifact ?? null,
    allowGuestAgents: jam.link?.allowGuestAgents ?? false,
    guest: null,
  };
}

/** `movedTo` from a 410 body (or a jam), when it's well formed. */
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

/** Jam request headers: the owner token when present, and the bearer (given or from the credentials). */
export function jamHeaders(creds: { token?: string | null; idToken?: JamCredentials['idToken'] }, idToken?: string | null, json = false): Record<string, string> {
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

// ── Jam ──

export function fetchJam(creds: JamCredentials, options: GuestApiOptions = {}): Promise<ShareJam> {
  return request<ShareJam>(url(`/v1/guest-links/jam?${q({ network: creds.slug })}`, options), { method: 'GET', headers: jamHeaders(creds) }, options);
}

export function fetchJamMessages(creds: JamCredentials, after?: string | null, options: GuestApiOptions & { limit?: number } = {}): Promise<GuestMessagesPage> {
  const params: Record<string, string> = { network: creds.slug, limit: String(options.limit ?? 100) };
  if (after) params.after = after;
  return request<GuestMessagesPage>(url(`/v1/guest-links/jam/messages?${q(params)}`, options), { method: 'GET', headers: jamHeaders(creds) }, options);
}

export function fetchEarlierJamMessages(creds: JamCredentials, before: string, options: GuestApiOptions & { limit?: number } = {}): Promise<GuestMessagesPage> {
  const params = { network: creds.slug, limit: String(options.limit ?? 100), before };
  return request<GuestMessagesPage>(url(`/v1/guest-links/jam/messages?${q(params)}`, options), { method: 'GET', headers: jamHeaders(creds) }, options);
}

export function postJamMessage(creds: JamCredentials, content: string, idempotencyKey: string, options: GuestApiOptions = {}): Promise<ONMEvent> {
  return request<ONMEvent>(url(`/v1/guest-links/jam/messages?${q({ network: creds.slug })}`, options), {
    method: 'POST',
    headers: jamHeaders(creds, null, true),
    body: JSON.stringify({ content, idempotency_key: idempotencyKey }),
  }, options);
}

// ── Guest link (owner token) ──

export function jamGuestLinksClient(creds: JamCredentials, options: GuestApiOptions = {}): GuestLinksClient {
  const linkPath = (id: string) => `/v1/guest-links/${encodeURIComponent(id)}?${q({ network: creds.slug })}`;
  return {
    async list(channel) {
      const data = await request<{ links?: GuestLink[] }>(url(`/v1/guest-links?${q({ network: creds.slug, channel })}`, options), { method: 'GET', headers: jamHeaders(creds) }, options);
      return data?.links || [];
    },
    async create(channel, expiresAt) {
      const data = await request<{ link: GuestLink }>(url('/v1/guest-links', options), {
        method: 'POST', headers: jamHeaders(creds, null, true), body: JSON.stringify({ network: creds.slug, channel, expires_at: expiresAt }),
      }, options);
      return data.link;
    },
    async updateExpiry(id, expiresAt) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: jamHeaders(creds, null, true), body: JSON.stringify({ expires_at: expiresAt }),
      }, options);
      return data.link;
    },
    async revoke(id) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), { method: 'DELETE', headers: jamHeaders(creds) }, options);
      return data.link;
    },
    async updateCanPost(id, canPost) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: jamHeaders(creds, null, true), body: JSON.stringify({ can_post: canPost }),
      }, options);
      return data.link;
    },
    async listGuests() {
      const data = await request<{ guests?: ThreadGuestRecord[] }>(url(`/v1/guest-links/jam/guests?${q({ network: creds.slug })}`, options), { method: 'GET', headers: jamHeaders(creds) }, options);
      return data?.guests || [];
    },
    async removeGuest(_channel, guestId) {
      const data = await request<{ guest: ThreadGuestRecord }>(url(`/v1/guest-links/jam/guests/${encodeURIComponent(guestId)}?${q({ network: creds.slug })}`, options), { method: 'DELETE', headers: jamHeaders(creds) }, options);
      return data.guest;
    },
    async updateAllowGuestAgents(id, allow) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: jamHeaders(creds, null, true), body: JSON.stringify({ allow_guest_agents: allow }),
      }, options);
      return data.link;
    },
    async updateAccess(id, access) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: jamHeaders(creds, null, true), body: JSON.stringify({ access }),
      }, options);
      return data.link;
    },
    async addInvites(id, emails) {
      const data = await request<{ link: GuestLink; added?: string[] }>(url(`/v1/guest-links/${encodeURIComponent(id)}/invites?${q({ network: creds.slug })}`, options), {
        method: 'POST', headers: jamHeaders(creds, null, true), body: JSON.stringify({ emails }),
      }, options);
      return { link: data.link, added: data.added || [] };
    },
    async removeInvite(id, email) {
      const data = await request<{ link: GuestLink }>(url(`/v1/guest-links/${encodeURIComponent(id)}/invites?${q({ network: creds.slug, email })}`, options), {
        method: 'DELETE', headers: jamHeaders(creds),
      }, options);
      return data.link;
    },
    async updateApprovalMode(id, mode) {
      const data = await request<{ link: GuestLink }>(url(linkPath(id), options), {
        method: 'PATCH', headers: jamHeaders(creds, null, true), body: JSON.stringify({ approval_mode: mode }),
      }, options);
      return data.link;
    },
  };
}

// ── Agents in the jam ──

/** The owner adds another agent of theirs to the jam. */
export function addJamAgent(creds: JamCredentials, agent: { name: string; type: string }, options: GuestApiOptions = {}): Promise<AddedAgent> {
  return request<AddedAgent>(url(`/v1/guest-links/jam/agents?${q({ network: creds.slug })}`, options), {
    method: 'POST', headers: jamHeaders(creds, null, true), body: JSON.stringify(agent),
  }, options);
}

/** The owner removes an agent (not the one the jam was shared for). */
export function removeJamAgent(creds: JamCredentials, name: string, options: GuestApiOptions = {}): Promise<unknown> {
  return request(url(`/v1/guest-links/jam/agents/${encodeURIComponent(name)}?${q({ network: creds.slug })}`, options), {
    method: 'DELETE', headers: jamHeaders(creds),
  }, options);
}

// ── The artifact open for guests ──

/** Open an artifact for guests (or close it: null). */
export async function pinJamArtifact(creds: JamCredentials, ref: PinnedArtifact | null, options: GuestApiOptions = {}): Promise<PinnedArtifact | null> {
  const data = await request<{ pinnedArtifact: PinnedArtifact | null }>(url(`/v1/guest-links/jam/pin?${q({ network: creds.slug })}`, options), {
    method: 'PUT', headers: jamHeaders(creds, null, true), body: JSON.stringify(ref ? { kind: ref.kind, id: ref.id } : { kind: null }),
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

export async function fetchJamRequests(creds: JamCredentials, options: GuestApiOptions = {}): Promise<ShareRequest[]> {
  const data = await request<{ requests?: ShareRequest[] }>(url(`/v1/guest-links/jam/requests?${q({ network: creds.slug })}`, options), { method: 'GET', headers: jamHeaders(creds) }, options);
  return data?.requests || [];
}

/** Approve (the request goes to the agent) or decline it. 409 = already decided. */
export async function decideJamRequest(creds: JamCredentials, id: string, decision: 'approve' | 'decline', options: GuestApiOptions = {}): Promise<ShareRequest> {
  const data = await request<{ request: ShareRequest }>(url(`/v1/guest-links/jam/requests/${encodeURIComponent(id)}?${q({ network: creds.slug })}`, options), {
    method: 'POST', headers: jamHeaders(creds, null, true), body: JSON.stringify({ decision }),
  }, options);
  return data.request;
}

// ── Keeping the conversation ──

export function claimShare(creds: JamCredentials, idToken: string, options: GuestApiOptions = {}): Promise<{ claimed: boolean; already?: boolean }> {
  return request(url('/v1/guest-links/claim', options), {
    method: 'POST', headers: jamHeaders(creds, idToken, true), body: JSON.stringify({ network: creds.slug }),
  }, options);
}

export function importShare(creds: JamCredentials, target: string, idToken: string, options: GuestApiOptions = {}): Promise<ImportResult> {
  return request(url('/v1/guest-links/import', options), {
    method: 'POST', headers: jamHeaders(creds, idToken, true), body: JSON.stringify({ network: creds.slug, target }),
  }, options);
}

// ── My jams (signed in) ──

/** A jam in "My jams": the jam plus its activity, guests and link state. */
export interface MyJam extends ShareJam {
  liveLink: GuestLink | null;
  /** Milliseconds since the epoch, or null. */
  lastActivityAt: number | null;
  guestCount: number;
  pendingRequests: number;
  keptAsWorkspace: boolean;
}

/** One jam from `GET /v1/jams`, with missing fields defaulted. */
export function toMyJam(raw: unknown): MyJam | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ws = (r.workspace || {}) as Partial<ShareJam['workspace']>;
  const thread = (r.thread || {}) as Partial<ShareJam['thread']>;
  if (!ws.slug || !thread.name) return null;
  const share = (r.share || {}) as Partial<ShareJam['share']>;
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

export async function listMyJams(idToken: string, options: GuestApiOptions = {}): Promise<MyJam[]> {
  const data = await request<{ jams?: unknown[] }>(url('/v1/jams', options), { method: 'GET', headers: jamHeaders({}, idToken) }, options);
  return (data?.jams || []).map(toMyJam).filter((r): r is MyJam => !!r);
}

/** Make the jam a full workspace of the signed-in owner (claims it first if needed). */
export function keepAsWorkspace(creds: JamCredentials, options: GuestApiOptions = {}): Promise<ImportResult> {
  return request(url(`/v1/jams/${encodeURIComponent(creds.slug)}/keep-as-workspace`, options), {
    method: 'POST', headers: jamHeaders(creds, null, true), body: '{}',
  }, options);
}

/** Delete the jam: its links stop working. */
export function deleteJam(creds: JamCredentials, options: GuestApiOptions = {}): Promise<{ deleted: boolean }> {
  return request(url(`/v1/jams/${encodeURIComponent(creds.slug)}`, options), { method: 'DELETE', headers: jamHeaders(creds) }, options);
}

/** The signed-in account's workspaces (bearer only — no owner token). */
export async function listMyWorkspaces(idToken: string, options: GuestApiOptions = {}): Promise<MyWorkspace[]> {
  const data = await request<unknown>(url('/v1/workspaces', options), { method: 'GET', headers: jamHeaders({}, idToken) }, options);
  const list = Array.isArray(data) ? data : Array.isArray((data as { workspaces?: unknown[] } | null)?.workspaces) ? (data as { workspaces: unknown[] }).workspaces : [];
  return list
    .map((w) => w as Partial<MyWorkspace> & { workspace_id?: string; id?: string })
    .map((w) => ({ workspaceId: w.workspaceId || w.workspace_id || w.id || '', slug: w.slug || '', name: w.name || w.slug || '' }))
    .filter((w) => w.workspaceId && w.slug);
}
