// Invitation API — the invitee's side of workspace invites, served by the
// public /v1/invites/{token} endpoints. Standalone (not workspaceApi): the
// invitee has no workspace credentials yet — the invite token is the only
// secret, and accepting authenticates with their identity bearer alone.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

/** What the accept page may show before (and without) login. */
export interface InvitePeek {
  workspaceName: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invitedBy: string | null;
  /** Masked (r***@example.com) when the invite is email-bound, else null. */
  invitedEmail: string | null;
  expiresAt: string | null;
}

export interface InviteAcceptResult {
  workspaceId: string;
  slug: string;
  workspaceName: string;
  role: string;
}

export async function getInvitePeek(token: string): Promise<InvitePeek> {
  const res = await fetch(`${API_URL}/v1/invites/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `API error (${res.status})`);
  }
  return (await res.json()).data as InvitePeek;
}

export async function acceptInvite(token: string, idToken: string): Promise<InviteAcceptResult> {
  const res = await fetch(`${API_URL}/v1/invites/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `API error (${res.status})`);
  }
  return (await res.json()).data as InviteAcceptResult;
}
