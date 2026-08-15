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
