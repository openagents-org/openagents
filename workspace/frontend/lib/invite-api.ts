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
  /** Inviter's display name (or their email's local part) — never the raw
   * email address; this endpoint is unauthenticated. */
  invitedBy: string | null;
  /** Masked (r***@example.com) when the invite is email-bound, else null. */
  invitedEmail: string | null;
  expiresAt: string | null;
  // ── v1.1 M2 — targeted invites (into a thread / an agent / a task) ──
  target_kind?: InviteTargetKind | null;
  target_id?: string | null;
  /** Thread title / agent display name / task title, for the landing copy. */
  target_title?: string | null;
  note?: string | null;
}

export interface InviteAcceptResult {
  workspaceId: string;
  slug: string;
  workspaceName: string;
  role: string;
  // ── v1.1 M2 ──
  target_kind?: InviteTargetKind | null;
  target_id?: string | null;
  /** `"#?thread=<channel>"` | `"#?agent=<name>"` | null — appended to the
   * workspace URL after accepting so the invitee lands on the shared thing. */
  redirect?: string | null;
}

// ── v1.1 M2 ──
export type InviteTargetKind = 'agent' | 'channel' | 'task';

/** The peek/accept endpoints are camelCase elsewhere; the v1.1 target fields
 * are specified snake_case. Accept either spelling so a backend that settles
 * on one does not silently drop the landing redirect. */
function normaliseTargetFields<T extends object>(data: T): T {
  const d = data as unknown as Record<string, unknown>;
  const pick = (snake: string, camel: string) => (d[snake] !== undefined ? d[snake] : d[camel]);
  return {
    ...d,
    target_kind: pick('target_kind', 'targetKind') ?? null,
    target_id: pick('target_id', 'targetId') ?? null,
    target_title: pick('target_title', 'targetTitle') ?? null,
    note: d.note ?? null,
    redirect: d.redirect ?? null,
  } as T;
}

export async function getInvitePeek(token: string): Promise<InvitePeek> {
  const res = await fetch(`${API_URL}/v1/invites/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `API error (${res.status})`);
  }
  return normaliseTargetFields((await res.json()).data as InvitePeek);
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
  return normaliseTargetFields((await res.json()).data as InviteAcceptResult);
}

/** Where to send the invitee after accepting. The redirect is a hash the
 * workspace page already understands (`#?thread=` deep link; `#?agent=` opens
 * the directory). Anything that is not a plain hash is ignored — it came from
 * the network. */
export function inviteLandingPath(result: Pick<InviteAcceptResult, 'slug' | 'redirect'>): string {
  const base = `/${result.slug}`;
  const redirect = (result.redirect || '').trim();
  return redirect.startsWith('#') && !/[\s<>"']/.test(redirect) ? `${base}${redirect}` : base;
}
