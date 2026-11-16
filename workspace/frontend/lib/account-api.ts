import { getApiBaseUrl } from '@/lib/api-base';
// Membership Home API — the signed-in user's workspaces, keyed to their
// verified identity (Firebase/Apple bearer), served by the workspace backend's
// GET /v1/account/workspaces. That endpoint also reconciles legacy email-based
// access into memberships and auto-provisions an empty workspace for brand-new
// users, so a freshly signed-in user always has at least one entry.

const API_URL = getApiBaseUrl();

export interface AccountWorkspace {
  workspaceId: string;
  slug: string;
  name: string;
  token: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  lastActivityAt: string | null;
  /** The first-run workspace created for the user without being asked for. */
  autoProvisioned?: boolean;
  /** Created by the request that listed it: the user has only just been given it. */
  justCreated?: boolean;
  /** For an auto-provisioned workspace next to one the user was invited to:
   *  true while nobody has written in it. null when not asked. */
  untouched?: boolean | null;
}

async function bearerFetch<T>(path: string, idToken: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.detail || `API error (${res.status})`);
  }
  const json = await res.json();
  return json.data as T;
}

/** List the signed-in user's workspaces (Membership Home). */
export function listAccountWorkspaces(idToken: string, signal?: AbortSignal): Promise<AccountWorkspace[]> {
  return bearerFetch<AccountWorkspace[]>('/v1/account/workspaces', idToken, { signal });
}

/** Email the caller a "finish setup on your computer" link for a workspace —
    the async bridge for phone users who can't install the launcher here. */
export function sendSetupEmail(idToken: string, workspaceIdOrSlug: string): Promise<{ emailSent: boolean }> {
  return bearerFetch<{ emailSent: boolean }>(`/v1/workspaces/${workspaceIdOrSlug}/setup-email`, idToken, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** The signed-in user's cross-workspace profile (name + avatar). */
export interface AccountProfile {
  email: string;
  displayName: string | null;
  /** https:// URL or a small data:image/... URL; null = no custom avatar. */
  avatarUrl: string | null;
  /** Whether this account has watched (or skipped) the welcome intro. */
  welcomeSeen?: boolean;
}

export function getAccountProfile(idToken: string): Promise<AccountProfile> {
  return bearerFetch<AccountProfile>('/v1/account/profile', idToken);
}

/** Omitted fields are left untouched; an empty-string avatarUrl clears it. */
export function updateAccountProfile(
  idToken: string,
  updates: { displayName?: string; avatarUrl?: string; welcomeSeen?: boolean },
): Promise<AccountProfile> {
  return bearerFetch<AccountProfile>('/v1/account/profile', idToken, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(updates.displayName !== undefined ? { display_name: updates.displayName } : {}),
      ...(updates.avatarUrl !== undefined ? { avatar_url: updates.avatarUrl } : {}),
      ...(updates.welcomeSeen !== undefined ? { welcome_seen: updates.welcomeSeen } : {}),
    }),
  });
}

/**
 * Create a new workspace owned by the signed-in user. No agent is seeded — the
 * user adds agents/threads from inside the workspace. Returns enough to open it.
 */
export function createAccountWorkspace(
  idToken: string,
  name: string,
): Promise<{ workspaceId: string; slug: string; name: string; token: string }> {
  return bearerFetch('/v1/workspaces', idToken, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/**
 * "Add this workspace to my account" — when a signed-in user opens a workspace
 * via a shared ?token= link, persist them as a member so it appears on their
 * Membership Home next time. Idempotent and best-effort; failures are ignored.
 */
export async function joinWorkspaceSelf(
  workspaceId: string,
  idToken: string,
  workspaceToken: string,
): Promise<void> {
  try {
    await fetch(`${API_URL}/v1/workspaces/${workspaceId}/team/self`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'X-Workspace-Token': workspaceToken,
      },
    });
  } catch {
    /* best-effort */
  }
}

// ── Agent hub: personal API keys and connected apps (OAuth) ────────────────

export interface HubApiKey { id: string; name: string; prefix: string; created_at: string | null; last_used_at: string | null }
export interface HubConnectedApp { id: string; client_id: string; name: string; connected_at: string | null; last_used_at: string | null }
export interface HubCredentials { api_keys: HubApiKey[]; connected_apps: HubConnectedApp[]; mcp_url: string; docs_url: string; skill_url: string }

export function listHubCredentials(idToken: string): Promise<HubCredentials> {
  return bearerFetch<HubCredentials>('/v1/account/hub-credentials', idToken);
}

/** The raw key is returned once, here, and never again. `replace` regenerates: older keys stop working. */
export function createHubApiKey(idToken: string, options: { name?: string; replace?: boolean } = {}): Promise<HubApiKey & { key: string }> {
  return bearerFetch('/v1/account/api-keys', idToken, { method: 'POST', body: JSON.stringify(options) });
}

/** Revoke a key, or disconnect an app (every token it holds). */
export function revokeHubCredential(idToken: string, id: string): Promise<{ revoked: boolean }> {
  return bearerFetch(`/v1/account/hub-credentials/${encodeURIComponent(id)}`, idToken, { method: 'DELETE' });
}

export interface OAuthApproval { client_id: string; redirect_uri: string; code_challenge: string; code_challenge_method: string; state?: string; approve: boolean }

/** The consent page's answer; returns where to send the browser back to. */
export function approveOAuth(idToken: string, approval: OAuthApproval): Promise<{ redirect: string; client_name: string }> {
  return bearerFetch('/v1/oauth/approve', idToken, { method: 'POST', body: JSON.stringify(approval) });
}
