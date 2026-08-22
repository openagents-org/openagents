// Membership Home API — the signed-in user's workspaces, keyed to their
// verified identity (Firebase/Apple bearer), served by the workspace backend's
// GET /v1/account/workspaces. That endpoint also reconciles legacy email-based
// access into memberships and auto-provisions an empty workspace for brand-new
// users, so a freshly signed-in user always has at least one entry.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

export interface AccountWorkspace {
  workspaceId: string;
  slug: string;
  name: string;
  token: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  lastActivityAt: string | null;
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
export function listAccountWorkspaces(idToken: string): Promise<AccountWorkspace[]> {
  return bearerFetch<AccountWorkspace[]>('/v1/account/workspaces', idToken);
}

/** The signed-in user's cross-workspace profile (name + avatar). */
export interface AccountProfile {
  email: string;
  displayName: string | null;
  /** https:// URL or a small data:image/... URL; null = no custom avatar. */
  avatarUrl: string | null;
}

export function getAccountProfile(idToken: string): Promise<AccountProfile> {
  return bearerFetch<AccountProfile>('/v1/account/profile', idToken);
}

/** Omitted fields are left untouched; an empty-string avatarUrl clears it. */
export function updateAccountProfile(
  idToken: string,
  updates: { displayName?: string; avatarUrl?: string },
): Promise<AccountProfile> {
  return bearerFetch<AccountProfile>('/v1/account/profile', idToken, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(updates.displayName !== undefined ? { display_name: updates.displayName } : {}),
      ...(updates.avatarUrl !== undefined ? { avatar_url: updates.avatarUrl } : {}),
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

/**
 * API credits campaign — the signed-in user's milestone checklist. Returns
 * {enabled:false} on self-hosted deployments (campaign off), in which case the
 * UI renders nothing. The first call provisions the user's gateway key (the
 * signup milestone).
 */
export interface CampaignStatus {
  enabled: boolean;
  apiKey?: string | null;
  gatewayUrl?: string;
  capUsd?: number;
  totalGrantedUsd?: number;
  milestones?: { key: string; amountUsd: number; grantedAt: string | null }[];
  daily?: { grantUsd: number; daysGranted: number; todayGranted: boolean };
  usage?: {
    costUsdUsed: number;
    costLimitUsd: number;
    isActive: boolean;
    inputTokens?: number | null;
    outputTokens?: number | null;
  } | null;
}

export function getCampaignStatus(idToken: string): Promise<CampaignStatus> {
  return bearerFetch<CampaignStatus>('/v1/campaign/status', idToken);
}

/** Model ids available on the campaign gateway (proxied by the backend). */
export function getCampaignModels(idToken: string): Promise<{ models: string[] }> {
  return bearerFetch<{ models: string[] }>('/v1/campaign/models', idToken);
}
